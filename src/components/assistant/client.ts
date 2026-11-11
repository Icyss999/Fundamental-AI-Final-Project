import type { AssistantEvent, AssistantStatus, ChatRequest } from "@/lib/ai/protocol";
import { ToolError } from "@/lib/ai/workspace";
import type { ProjectSource } from "@/lib/repo/overview";

/** Calls /api/assistant and hands each streamed event to `onEvent` until the reply ends. */
export async function streamAssistant(request: ChatRequest, signal: AbortSignal, onEvent: (event: AssistantEvent) => void): Promise<Extract<AssistantEvent, { type: "done" }>> {
  const res = await fetch("/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `The assistant request failed (${res.status}).`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    for (let nl = buffer.indexOf("\n"); nl !== -1; nl = buffer.indexOf("\n")) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const event = JSON.parse(line) as AssistantEvent;
      if (event.type === "done") return event;
      if (event.type === "error") throw new Error(event.message);
      onEvent(event);
    }
  }
  throw new Error("The reply ended unexpectedly. Please try again.");
}

export async function fetchAssistantStatus(): Promise<AssistantStatus> {
  const res = await fetch("/api/assistant", { cache: "no-store" });
  if (!res.ok) throw new Error(`Status check failed (${res.status})`);
  return res.json();
}

/** Source text of a project file (for the read_file tool). */
export async function fetchSource(source: ProjectSource, path: string): Promise<string> {
  const res = await fetch("/api/source", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, path }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || typeof body?.text !== "string") throw new ToolError(body?.error ?? `Could not read ${path} (${res.status}).`);
  return body.text;
}
