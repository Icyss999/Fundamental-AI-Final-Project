"use client";

import { useEffect, useState } from "react";
import type { ChatMessage } from "@/components/assistant/useAssistant";
import type { StageStatus } from "@/components/assistant/useAutopilot";
import type { StageId } from "@/lib/ai/autopilot";
import { describeCall } from "@/lib/ai/execute";
import { Icon, Spinner } from "./ui";

/** Pieces of the AI's progress, shared by the waiting screen and the "Analyzing…" panels. */

export type PanelState = "done" | "active" | "todo" | "failed";

export const AI_STEPS: Record<StageId, string> = { organize: "Sort into parts", bugs: "Hunt for bugs", refactor: "Plan a tidy-up" };

/** One numbered panel of the strip: dashed while waiting, yellow with drifting dots while working, inked when done. */
export function StepPanel({ n, label, state }: { n: number; label: string; state: PanelState }) {
  return (
    <li
      className={`flex aspect-[4/3] min-w-0 flex-col justify-between rounded-[6px] p-2.5 transition-colors duration-300 ${
        state === "done"
          ? "border-[2.5px] border-[var(--ink)] bg-[var(--paper)]"
          : state === "active"
            ? "k-halftone-live border-[2.5px] border-[var(--on-yel)] bg-[var(--yel)] text-[var(--on-yel)]"
            : state === "failed"
              ? "border-[2.5px] border-[var(--danger)] text-[var(--danger)]"
              : "border-2 border-dashed border-[var(--border)] text-[var(--muted)]"
      }`}
    >
      <span className="font-letter text-[15px] font-extrabold tabular-nums">{n}</span>
      <span className="flex items-end justify-between gap-1">
        <span className="text-[13.5px] font-bold leading-tight">{label}</span>
        {state === "done" ? <Icon.Check className="h-4 w-4 shrink-0" /> : state === "active" ? <Spinner className="h-4 w-4 shrink-0" /> : state === "failed" ? <Icon.Alert className="h-4 w-4 shrink-0" /> : null}
      </span>
      <span className="sr-only">: {state === "active" ? "working" : state === "todo" ? "waiting" : state}</span>
    </li>
  );
}

export const aiState = (s?: StageStatus): PanelState => (s === "done" ? "done" : s === "running" ? "active" : s === "error" || s === "stopped" ? "failed" : "todo");

/** What the AI is doing right now, in a few words: its latest tool call, or thinking. */
export function activity(messages: readonly ChatMessage[]): string | null {
  const results = new Map(messages.filter((m) => m.role === "tool").map((m) => [m.toolCallId, m]));
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const pending = m.toolCalls.find((c) => !results.has(c.id));
    if (pending) return `${describeCall(pending.function.name, pending.function.arguments)}…`;
    if (m.streaming) return m.content ? "Writing down what it found…" : "Thinking…";
    const last = m.toolCalls[m.toolCalls.length - 1];
    const done = last && results.get(last.id);
    return done && done.role === "tool" ? done.summary : null;
  }
  return null;
}

/** The last error the AI ran into, for the "it stopped" message. */
export function lastError(messages: readonly ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && m.error) return m.error;
  }
  return null;
}

export function useElapsed(running: boolean): number {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return Math.max(0, Math.floor((now - start) / 1000));
}

