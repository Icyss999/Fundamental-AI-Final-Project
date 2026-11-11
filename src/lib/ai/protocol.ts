/**
 * Wire format between the assistant panel and /api/assistant (client-safe).
 *
 * Messages are OpenAI-style chat messages, which DeepSeek's API takes as-is. The browser keeps the
 * conversation and runs the tools (all of Layer 2/3's state lives there); the server adds the system
 * prompt and tool definitions, calls the model, and streams back normalised events.
 */

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ApiMessage =
  | { role: "user"; content: string }
  /** `reasoning_content` must be sent back on later requests: DeepSeek requires it when tools are in use. */
  | { role: "assistant"; content: string | null; reasoning_content?: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
}

export type AssistantEvent =
  | { type: "reasoning"; text: string }
  | { type: "text"; text: string }
  /** Ends a successful reply; `toolCalls` is non-empty when the model wants tools run. */
  | { type: "done"; toolCalls: ToolCall[]; finish: string | null; usage: Usage | null }
  | { type: "error"; message: string };

/** GET /api/assistant */
export interface AssistantStatus {
  configured: boolean;
  model: string;
}

export type Effort = "low" | "high";

export interface ChatRequest {
  messages: ApiMessage[];
  /** Project brief built in the browser from the analysis; goes into the system prompt. */
  context: string;
  effort: Effort;
  /** Tool rounds already run for the current user message. */
  round: number;
  /** The reply is near its tool-round budget: the server asks the model to answer now. */
  wrapUp: boolean;
}

export const CHAT_LIMITS = {
  messages: 400,
  /** Total characters over all messages. */
  chars: 900_000,
  context: 60_000,
  toolCalls: 16,
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";

/** Validates a POST body; returns the request or a message saying what is wrong. */
export function parseChatRequest(body: unknown): ChatRequest | string {
  if (!isRecord(body)) return "Body must be a JSON object.";
  const { messages, context = "", effort = "low", round = 0, wrapUp = false } = body;
  if (!Array.isArray(messages) || messages.length === 0) return "messages must be a non-empty array.";
  if (messages.length > CHAT_LIMITS.messages) return "This conversation is too long. Start a new chat.";
  if (!isString(context) || context.length > CHAT_LIMITS.context) return "context must be a string of at most 60k characters.";
  if (effort !== "low" && effort !== "high") return 'effort must be "low" or "high".';
  if (typeof round !== "number" || !Number.isInteger(round) || round < 0) return "round must be a non-negative integer.";
  if (typeof wrapUp !== "boolean") return "wrapUp must be a boolean.";

  const out: ApiMessage[] = [];
  const pending = new Set<string>();
  let chars = context.length;
  for (const [i, m] of messages.entries()) {
    if (!isRecord(m)) return `messages[${i}] must be an object.`;
    if (m.role === "user") {
      if (!isString(m.content) || m.content.trim() === "") return `messages[${i}].content must be a non-empty string.`;
      if (pending.size > 0) return `messages[${i}]: tool results are missing before this message.`;
      chars += m.content.length;
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      if (m.content !== null && m.content !== undefined && !isString(m.content)) return `messages[${i}].content must be a string or null.`;
      if (m.reasoning_content !== undefined && !isString(m.reasoning_content)) return `messages[${i}].reasoning_content must be a string.`;
      if (pending.size > 0) return `messages[${i}]: tool results are missing before this message.`;
      const msg: ApiMessage = { role: "assistant", content: (m.content as string | null | undefined) ?? null };
      if (m.reasoning_content) msg.reasoning_content = m.reasoning_content;
      if (m.tool_calls !== undefined) {
        if (!Array.isArray(m.tool_calls) || m.tool_calls.length > CHAT_LIMITS.toolCalls) return `messages[${i}].tool_calls is malformed.`;
        const calls: ToolCall[] = [];
        for (const c of m.tool_calls) {
          if (!isRecord(c) || !isString(c.id) || !isRecord(c.function) || !isString(c.function.name) || !isString(c.function.arguments)) {
            return `messages[${i}].tool_calls is malformed.`;
          }
          calls.push({ id: c.id, type: "function", function: { name: c.function.name, arguments: c.function.arguments } });
          pending.add(c.id);
          chars += c.function.arguments.length;
        }
        if (calls.length > 0) msg.tool_calls = calls;
      }
      chars += (msg.content?.length ?? 0) + (msg.reasoning_content?.length ?? 0);
      out.push(msg);
    } else if (m.role === "tool") {
      if (!isString(m.tool_call_id) || !pending.has(m.tool_call_id)) return `messages[${i}] answers a tool call that was not made.`;
      if (!isString(m.content)) return `messages[${i}].content must be a string.`;
      pending.delete(m.tool_call_id);
      chars += m.content.length;
      out.push({ role: "tool", tool_call_id: m.tool_call_id, content: m.content });
    } else {
      return `messages[${i}].role must be user, assistant or tool.`;
    }
  }
  if (out[0].role !== "user") return "The conversation must start with a user message.";
  if (pending.size > 0) return "Some tool calls have no result.";
  if (chars > CHAT_LIMITS.chars) return "This conversation is too long. Start a new chat.";
  return { messages: out, context, effort, round, wrapUp };
}
