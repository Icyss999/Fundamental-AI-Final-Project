"use client";

import { useState } from "react";
import { AUTOPILOT_STAGES, type StageId } from "@/lib/ai/autopilot";
import type { Assistant } from "./useAssistant";

/** `skipped`: never ran, because a stage before it did not finish. */
export type StageStatus = "pending" | "running" | "done" | "stopped" | "error" | "skipped";

/** Runs the autopilot's stages one after another through the assistant, stopping at the first that does not finish. */
export function useAutopilot(assistant: Assistant) {
  const [stages, setStages] = useState<Partial<Record<StageId, StageStatus>> | null>(null);
  /** When each stage finished, so the map can mark results the user has not looked at yet. */
  const [doneAt, setDoneAt] = useState<Partial<Record<StageId, number>>>({});
  // A pass is running from its first stage until its last one ends (pending stages count: one is about to start).
  const running = !!stages && Object.values(stages).some((s) => s === "running" || s === "pending");

  /**
   * Runs every stage, or only the given ones (a retry: stages already done keep their status).
   * Resolves with how the last stage it ran ended.
   */
  const start = async (only?: StageId[]): Promise<StageStatus> => {
    if (assistant.busy) return "stopped";
    const run = only ? AUTOPILOT_STAGES.filter((s) => only.includes(s.id)) : AUTOPILOT_STAGES;
    setStages((prev) => ({ ...(only ? (prev ?? {}) : {}), ...Object.fromEntries(run.map((s) => [s.id, "pending" as const])) }));
    for (const stage of run) {
      setStages((s) => s && { ...s, [stage.id]: "running" });
      const result = await assistant.send(stage.prompt, { stage: `Autopilot · ${stage.title}`, maxRounds: stage.rounds });
      const status: StageStatus = result === "done" ? "done" : result === "stopped" ? "stopped" : "error";
      if (status === "done") setDoneAt((d) => ({ ...d, [stage.id]: Date.now() }));
      // A stage that does not finish ends the pass: the ones after it will not run.
      setStages((s) => s && (Object.fromEntries(Object.entries(s).map(([id, st]) => [id, id === stage.id ? status : st === "pending" && status !== "done" ? "skipped" : st])) as Partial<Record<StageId, StageStatus>>));
      if (status !== "done") return status;
    }
    return "done";
  };

  return { stages, running, doneAt, start, clear: () => setStages(null) };
}

export type Autopilot = ReturnType<typeof useAutopilot>;
