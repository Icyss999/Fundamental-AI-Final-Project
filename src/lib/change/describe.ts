/** Plain-text views of plans, shared by the Refactor panel and the assistant (client-safe). */

import { findCycles } from "@/lib/graph/analysis";
import type { DepGraph } from "@/lib/graph/types";
import { DEFAULT_PLAN_OPTIONS, edgesAfter, planRefactoring, type Heuristic, type PlanProblem, type PlanResult, type PlanStep, type StateDelta } from "./planner";

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const rel = (path: string, prefix: string) => (prefix && path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : path);
const folder = (dir: string, prefix: string) => `${rel(dir, prefix) || "/"}/`.replace(/^\/\/$/, "/");

/** Where `file` is in a plan state (its original path if the plan has not moved it). */
export function pathAfter(delta: StateDelta | null, file: string): string {
  const moved = delta?.moves.find(([f]) => f === file);
  return moved ? `${moved[1] ? `${moved[1]}/` : ""}${baseName(file)}` : file;
}

export interface StructureMetrics {
  violations: number;
  cycles: number;
  /** Imports between files in different folders. */
  crossFolder: number;
}

/** Structure of the graph after a plan state (null = the current code). */
export function structureMetrics(graph: DepGraph, delta: StateDelta | null, violations: number): StructureMetrics {
  const edges = delta ? edgesAfter(graph.edges, delta) : graph.edges;
  const dir = (f: string) => {
    const moved = delta?.moves.find(([x]) => x === f);
    return moved ? moved[1] : f.slice(0, Math.max(0, f.lastIndexOf("/")));
  };
  return {
    violations,
    cycles: findCycles({ ...graph, edges }).length,
    crossFolder: edges.filter((e) => dir(e.source) !== dir(e.target)).length,
  };
}

/** Import paths a move rewrites (its rewrite cost over the per-rewrite price). */
export function rewrites(step: PlanStep): number {
  return Math.round(step.costParts.rewrites / DEFAULT_PLAN_OPTIONS.rewriteCost);
}

/** One plan step as a sentence. */
export function describeStep(step: PlanStep, prefix = ""): string {
  const a = step.action;
  if (a.kind === "move") {
    return `Move ${rel(a.file, prefix)} from ${folder(a.from, prefix)} to ${folder(a.to, prefix)} (rewrites ${rewrites(step)} import paths)`;
  }
  return `${rel(a.file, prefix)} imports ${rel(a.to, prefix)} instead of ${rel(a.from, prefix)} (${baseName(a.to)} already imports ${baseName(a.from)}; expose what ${baseName(a.file)} needs there)`;
}

export interface SearchComparison {
  heuristic: Heuristic;
  status: PlanResult["status"];
  cost: number;
  steps: number;
  expanded: number;
  generated: number;
  hStart: number;
  ms: number;
}

/** Runs every search on the same problem (the evaluation of the heuristic). */
export function compareSearches(problem: PlanProblem, riskWeight: number, timeLimitMs = 4000): SearchComparison[] {
  return (["matching", "count", "zero"] as Heuristic[]).map((heuristic) => {
    const r = planRefactoring(problem, { heuristic, riskWeight, timeLimitMs });
    return { heuristic, status: r.status, cost: r.cost, steps: r.steps.length, expanded: r.stats.expanded, generated: r.stats.generated, hStart: r.stats.hStart, ms: r.stats.ms };
  });
}
