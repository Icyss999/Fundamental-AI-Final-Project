"use client";

import { useRef, useState } from "react";
import { executeTool } from "@/lib/ai/execute";
import type { ApiMessage, Effort, ToolCall, Usage } from "@/lib/ai/protocol";
import type { AssistantWorkspace } from "@/lib/ai/workspace";
import { streamAssistant } from "./client";

export type ChatMessage =
  /** `content` is what the model gets (app state + text), `text` what the chat shows; `stage` marks an autopilot step. */
  | { id: number; role: "user"; content: string; text: string; stage?: string }
  | { id: number; role: "assistant"; content: string; reasoning: string; toolCalls: ToolCall[]; streaming: boolean; stopped?: boolean; error?: string; usage?: Usage | null }
  | { id: number; role: "tool"; toolCallId: string; name: string; content: string; summary: string; ok: boolean };

export type AssistantMessage = Extract<ChatMessage, { role: "assistant" }>;
export type ToolMessage = Extract<ChatMessage, { role: "tool" }>;

/** Tool rounds per user message before the assistant has to answer (the last few with a wrap-up note). */
const MAX_ROUNDS = 16;
const WRAP_UP_ROUNDS = 4;

export type SendResult = "done" | "stopped" | "error" | "busy";

export interface SendOptions {
  /** Shown in the chat instead of the prompt (autopilot stages). */
  stage?: string;
  maxRounds?: number;
}
const CANCELLED = JSON.stringify({ error: "Cancelled by the user." });

/** The conversation as the API takes it: every tool call answered, empty replies dropped. */
export function toApiMessages(messages: readonly ChatMessage[]): ApiMessage[] {
  const out: ApiMessage[] = [];
  const answered = new Set(messages.filter((m): m is ToolMessage => m.role === "tool").map((m) => m.toolCallId));
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "tool") out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    else {
      if (!m.content && m.toolCalls.length === 0) continue;
      out.push({
        role: "assistant",
        content: m.content || null,
        ...(m.reasoning ? { reasoning_content: m.reasoning } : {}),
        ...(m.toolCalls.length ? { tool_calls: m.toolCalls } : {}),
      });
      for (const c of m.toolCalls) if (!answered.has(c.id)) out.push({ role: "tool", tool_call_id: c.id, content: CANCELLED });
    }
  }
  return out;
}

export function useAssistant({ context, getWorkspace, getAppState }: { context: string; getWorkspace: () => AssistantWorkspace; getAppState: () => string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [effort, setEffort] = useState<Effort>("low");
  const abortRef = useRef<AbortController | null>(null);
  const historyRef = useRef<ChatMessage[]>([]);
  const nextId = useRef(1);
  /** Bumped by "New chat", so a reply still in flight cannot write into the new conversation. */
  const generation = useRef(0);

  const commit = (next: ChatMessage[]) => {
    historyRef.current = next;
    setMessages(next);
  };

  const send = async (text: string, options: SendOptions = {}): Promise<SendResult> => {
    const trimmed = text.trim();
    if (!trimmed || abortRef.current) return "busy";
    const maxRounds = options.maxRounds ?? MAX_ROUNDS;
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    const gen = generation.current;
    const alive = () => generation.current === gen;
    const append = (m: ChatMessage) => alive() && commit([...historyRef.current, m]);
    const patch = (id: number, change: Partial<AssistantMessage>) =>
      alive() && commit(historyRef.current.map((m) => (m.id === id && m.role === "assistant" ? { ...m, ...change } : m)));

    setBusy(true);
    append({ id: nextId.current++, role: "user", text: options.stage ?? trimmed, stage: options.stage, content: `${getAppState()}\n\n${trimmed}` });

    let current: number | null = null;
    try {
      for (let round = 0; round < maxRounds; round++) {
        const id = nextId.current++;
        current = id;
        const request = { messages: toApiMessages(historyRef.current), context, effort, round, wrapUp: round >= maxRounds - WRAP_UP_ROUNDS };
        append({ id, role: "assistant", content: "", reasoning: "", toolCalls: [], streaming: true });
        let reasoning = "";
        let content = "";
        const done = await streamAssistant(request, signal, (e) => {
          if (e.type === "reasoning") reasoning += e.text;
          else if (e.type === "text") content += e.text;
          patch(id, { reasoning, content });
        });
        patch(id, { reasoning, content, toolCalls: done.toolCalls, streaming: false, usage: done.usage });
        if (done.toolCalls.length === 0) return "done";

        // Run this round's tools in order against one snapshot, so later calls see earlier changes.
        const ws = getWorkspace();
        for (const call of done.toolCalls) {
          if (signal.aborted || !alive()) return "stopped";
          const out = await executeTool(ws, call.function.name, call.function.arguments);
          append({ id: nextId.current++, role: "tool", toolCallId: call.id, name: call.function.name, content: out.content, summary: out.summary, ok: out.ok });
        }
        if (signal.aborted) return "stopped";
      }
      if (current !== null) patch(current, { error: `Stopped after ${maxRounds} rounds of tool calls. Ask again to let it continue.` });
      return "done";
    } catch (err) {
      if (signal.aborted) {
        if (current !== null) patch(current, { streaming: false, stopped: true });
        return "stopped";
      }
      if (current !== null) patch(current, { streaming: false, error: err instanceof Error ? err.message : String(err) });
      return "error";
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  };

  const stop = () => abortRef.current?.abort();

  const reset = () => {
    generation.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    commit([]);
  };

  return { messages, busy, send, stop, reset, effort, setEffort };
}

export type Assistant = ReturnType<typeof useAssistant>;
