"use client";

import { useState } from "react";
import { AUTOPILOT_STAGES, type StageId } from "@/lib/ai/autopilot";
import type { Assistant } from "./useAssistant";

export type StageStatus = "pending" | "running" | "done" | "stopped" | "error";

/** Runs the autopilot's stages one after another through the assistant, stopping at the first that does not finish. */
export function useAutopilot(assistant: Assistant) {
  const [stages, setStages] = useState<Record<StageId, StageStatus> | null>(null);
  const running = !!stages && Object.values(stages).includes("running");

  const start = async () => {
    if (assistant.busy) return;
    setStages({ organize: "pending", bugs: "pending", refactor: "pending" });
    for (const stage of AUTOPILOT_STAGES) {
      setStages((s) => s && { ...s, [stage.id]: "running" });
      const result = await assistant.send(stage.prompt, { stage: `Autopilot · ${stage.title}`, maxRounds: stage.rounds });
      const status: StageStatus = result === "done" ? "done" : result === "stopped" ? "stopped" : "error";
      setStages((s) => s && { ...s, [stage.id]: status });
      if (status !== "done") return;
    }
  };

  return { stages, running, start, clear: () => setStages(null) };
}

export type Autopilot = ReturnType<typeof useAutopilot>;
