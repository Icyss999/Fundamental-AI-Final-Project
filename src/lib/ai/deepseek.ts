/**
 * DeepSeek chat client (server only: it reads the API key). DeepSeek speaks the OpenAI chat format:
 * POST /chat/completions with `stream: true` returns server-sent events whose deltas carry
 * `reasoning_content` (thinking mode), `content`, and `tool_calls` fragments keyed by index.
 */

import type { ApiMessage, AssistantEvent, Effort, ToolCall, Usage } from "./protocol";
import type { ToolSpec } from "./specs";

export const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-flash";

export interface DeepSeekConfig {
  key: string | null;
  model: string;
  /** Thinking mode (DeepSeek's default). Off: faster, no reasoning stream. */
  thinking: boolean;
}

export function deepseekConfig(): DeepSeekConfig {
  return {
    key: process.env.DEEPSEEK_API_KEY?.trim() || null,
    model: process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL,
    thinking: process.env.DEEPSEEK_THINKING?.trim().toLowerCase() !== "disabled",
  };
}

/** Splits an SSE buffer into complete `data:` payloads and the unfinished rest. */
export function splitSse(buffer: string): { data: string[]; rest: string } {
  const data: string[] = [];
  const events = buffer.split(/\r?\n\r?\n/);
  const rest = events.pop() ?? "";
  for (const event of events) {
    const lines = event.split(/\r?\n/).filter((l) => l.startsWith("data:"));
    if (lines.length > 0) data.push(lines.map((l) => l.slice(5).trimStart()).join("\n"));
  }
  return { data, rest };
}

interface ChunkDelta {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
}

interface Chunk {
  choices?: { delta?: ChunkDelta; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number } | null;
}

/** Folds streamed chunks into text/reasoning deltas and, at the end, whole tool calls. */
export class ChatAccumulator {
  private calls = new Map<number, ToolCall>();
  private finish: string | null = null;
  private usage: Usage | null = null;

  push(chunk: Chunk): AssistantEvent[] {
    const events: AssistantEvent[] = [];
    if (chunk.usage) {
      this.usage = {
        promptTokens: chunk.usage.prompt_tokens ?? 0,
        completionTokens: chunk.usage.completion_tokens ?? 0,
        cachedTokens: chunk.usage.prompt_cache_hit_tokens ?? 0,
      };
    }
    const choice = chunk.choices?.[0];
    if (!choice) return events;
    const d = choice.delta ?? {};
    if (d.reasoning_content) events.push({ type: "reasoning", text: d.reasoning_content });
    if (d.content) events.push({ type: "text", text: d.content });
    for (const t of d.tool_calls ?? []) {
      const call = this.calls.get(t.index) ?? { id: "", type: "function" as const, function: { name: "", arguments: "" } };
      if (t.id) call.id = t.id;
      if (t.function?.name) call.function.name += t.function.name;
      if (t.function?.arguments) call.function.arguments += t.function.arguments;
      this.calls.set(t.index, call);
    }
    if (choice.finish_reason) this.finish = choice.finish_reason;
    return events;
  }

  done(): AssistantEvent {
    const toolCalls = [...this.calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([i, c]) => ({ ...c, id: c.id || `call_${i}` }))
      .filter((c) => c.function.name);
    return { type: "done", toolCalls, finish: this.finish, usage: this.usage };
  }
}

/** A message for the user from a failed API response. */
export function apiErrorMessage(status: number, body: string): string {
  let detail = "";
  try {
    detail = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? "";
  } catch {
    detail = body.slice(0, 200);
  }
  if (status === 401) return "DeepSeek rejected the API key. Check DEEPSEEK_API_KEY in .env.local and restart the server.";
  if (status === 402) return "The DeepSeek account has run out of balance.";
  if (status === 429) return "DeepSeek is rate-limiting requests. Wait a moment and try again.";
  if (status >= 500) return "DeepSeek is busy or unavailable right now. Try again in a moment.";
  return `DeepSeek returned an error (${status})${detail ? `: ${detail}` : "."}`;
}

export interface ChatOptions {
  config: DeepSeekConfig & { key: string };
  messages: readonly ({ role: "system"; content: string } | ApiMessage)[];
  tools: readonly ToolSpec[];
  effort: Effort;
  signal: AbortSignal;
}

/** Calls the model and yields its reply as events, ending with one `done` or `error`. */
export async function* streamChat({ config, messages, tools, effort, signal }: ChatOptions): AsyncGenerator<AssistantEvent> {
  let res: Response;
  try {
    res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages,
        tools,
        tool_choice: "auto",
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: 32_000,
        ...(config.thinking ? { thinking: { type: "enabled" }, reasoning_effort: effort } : { thinking: { type: "disabled" }, temperature: 0.3 }),
      }),
      signal,
    });
  } catch (err) {
    if (signal.aborted) return;
    yield { type: "error", message: `Could not reach DeepSeek: ${(err as Error).message}` };
    return;
  }
  if (!res.ok || !res.body) {
    yield { type: "error", message: apiErrorMessage(res.status, await res.text().catch(() => "")) };
    return;
  }

  const acc = new ChatAccumulator();
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const { data, rest } = splitSse(buffer + value);
      buffer = rest;
      for (const payload of data) {
        if (payload === "[DONE]") {
          yield acc.done();
          return;
        }
        let chunk: Chunk & { error?: { message?: string } };
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }
        if (chunk.error) {
          yield { type: "error", message: `DeepSeek: ${chunk.error.message ?? "the reply failed."}` };
          return;
        }
        yield* acc.push(chunk);
      }
    }
  } catch (err) {
    if (signal.aborted) return;
    yield { type: "error", message: `The reply was cut off: ${(err as Error).message}` };
    return;
  }
  // Stream ended without [DONE]: hand back what arrived.
  yield acc.done();
}
