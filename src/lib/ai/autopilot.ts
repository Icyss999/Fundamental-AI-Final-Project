/**
 * The autopilot: the assistant works through the three layers on its own, one stage per message,
 * changing the app as it goes (diagram grouping, review findings, rules, plan, patches).
 */

export type StageId = "organize" | "bugs" | "refactor";

export interface AutopilotStage {
  id: StageId;
  title: string;
  /** Tool rounds the stage may use. */
  rounds: number;
  prompt: string;
}

export const AUTOPILOT_STAGES: AutopilotStage[] = [
  {
    id: "organize",
    title: "Organize the diagram",
    rounds: 12,
    prompt: `Autopilot, stage 1 of 3 — rearrange the diagram into this project's real architecture.
Run cluster_modules (annealing) for the structural clusters. Then call set_architecture with 3–12 modules a developer would recognise, built from those clusters (merge, split, move misfits; read a file only if its role is unclear), each with a short name, a one-line purpose and a tier (0 = entry points/UI at the top, increasing towards shared foundations). Every source file must land in a module.
Then reply in 2–4 sentences: how the codebase is organised, and how your modules' MQ compares with the clusters and the folders.`,
  },
  {
    id: "bugs",
    title: "Find bugs",
    rounds: 14,
    prompt: `Autopilot, stage 2 of 3 — find bugs.
If test outcomes or a report are loaded, use them (get_test_failures); if the project ships an example report, load it. Run rank_suspects, then read the 3–5 riskiest source files and the tests that reach them. Call report_findings with the concrete problems you found (file, line, severity, what is wrong and why, and a fix as a unified diff when you can) and list every file you read in reviewed. Report real problems only — an empty list is a valid review. Highlight the files with findings in the diagram.
Then reply with a few bullets: the findings and how the ranking moved.`,
  },
  {
    id: "refactor",
    title: "Plan the refactoring",
    rounds: 18,
    prompt: `Autopilot, stage 3 of 3 — refactor towards the architecture.
Write rules in the rules DSL that encode the architecture you designed in stage 1 and its tiers (rule paths are folders or files, not module names) and call set_rules; fix any errors and unmatched paths. If there are violations, run plan_refactoring, then show_plan_step with play, and for each plan step (at most 5) read the files involved and attach_patch with a unified diff. If nothing breaks the rules, say the code already follows the architecture.
Then reply with a short summary of the plan.`,
  },
];
