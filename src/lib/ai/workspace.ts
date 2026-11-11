/**
 * The assistant's view of one analysed project: a snapshot of Layer 2/3 state taken from the UI,
 * which tools read and change. Changes are applied to the snapshot at once (so the next tool in
 * the same turn sees them — React state only catches up after a render) and pushed to the UI
 * through `effects`. Client-safe and free of React, so tools can be tested without a browser.
 */

import type { AnalysisResult } from "@/lib/analyze";
import { clusterProject, type ClusterRun, type Grouping, type GroupingKind } from "@/lib/cluster/grouping";
import type { SearchOptions } from "@/lib/cluster/search";
import { compareSearches, type SearchComparison } from "@/lib/change/describe";
import { planRefactoring, type Heuristic, type PlanProblem, type PlanResult } from "@/lib/change/planner";
import { Policy, type Violation } from "@/lib/change/rules";
import type { Outcome } from "@/lib/diagnose/bayes";
import { scoreDiagnosis, type Diagnosis, type DiagnosisBasis, type DiagnosisParams } from "@/lib/diagnose/diagnose";
import { reviewEvidence, type Review } from "@/lib/diagnose/review";
import type { ProjectAnalysis } from "@/lib/graph/project-analysis";
import type { Partition } from "@/lib/graph/types";

export type ViewMode = "structure" | "risk" | "refactor";
export type ViewTarget = { type: "file" | "module"; id: string };

export interface PlanSettings {
  heuristic: Heuristic;
  riskWeight: number;
}

export interface WorkspaceSnapshot {
  data: AnalysisResult;
  /** Source files only: what Layers 2 and 3 work on. */
  analysis: ProjectAnalysis;
  basis: DiagnosisBasis;
  diagnosis: Diagnosis;
  outcomes: ReadonlyMap<string, Outcome>;
  /** The last test report loaded, if any. */
  report: { name: string; text: string } | null;
  params: DiagnosisParams;
  /** The AI's code review, and whether it counts as evidence. */
  review: Review | null;
  useReview: boolean;
  rulesText: string;
  suggestedRules: string;
  policy: Policy;
  violations: readonly Violation[];
  planOptions: PlanSettings;
  /** The plan made for `rulesText`, if any. */
  plan: PlanResult | null;
  step: number;
  view: { tab: "overview" | "diagram"; mode: ViewMode; selection: ViewTarget | null; includeAll: boolean };
  /** What the diagram draws right now (tests too when they are shown). */
  diagram: { partition: Partition; labels: Record<string, string> };
  /** How the diagram groups files, and the groupings available. */
  grouping: { kind: GroupingKind; folderMQ: number; clusters: ClusterRun | null; ai: Grouping | null };
  /** Code the AI wrote for steps of `plan` (1-based). */
  patches: ReadonlyMap<number, { diff: string; note?: string }> | null;
}

/** How tools change what the user sees. */
export interface WorkspaceEffects {
  setOutcomes(outcomes: ReadonlyMap<string, Outcome>): void;
  loadReport(text: string, name: string): void;
  setRulesText(text: string): void;
  setPlanOptions(options: PlanSettings): void;
  adoptPlan(plan: PlanResult, rulesText: string): void;
  adoptComparison(rows: SearchComparison[], rulesText: string): void;
  setStep(step: number): void;
  play(): void;
  /** Switches to the diagram; `highlight` replaces the highlighted files ([] clears them). */
  show(options: { mode?: ViewMode; focus?: ViewTarget; highlight?: string[] }): void;
  /** Changes the diagram's grouping, storing new clusters or a new AI architecture first. */
  setGrouping(kind: GroupingKind, update?: { clusters?: ClusterRun; ai?: Grouping }): void;
  setReview(review: Review | null): void;
  attachPatch(plan: PlanResult, step: number, diff: string, note?: string): void;
  /** Source text of a project file. */
  readSource(path: string): Promise<string>;
}

export class AssistantWorkspace {
  private readonly s: WorkspaceSnapshot;

  constructor(
    snapshot: WorkspaceSnapshot,
    readonly effects: WorkspaceEffects,
  ) {
    this.s = { ...snapshot, view: { ...snapshot.view }, grouping: { ...snapshot.grouping }, patches: snapshot.patches && new Map(snapshot.patches) };
  }

  get state(): Readonly<WorkspaceSnapshot> {
    return this.s;
  }

  get prefix(): string {
    return this.s.analysis.prefix;
  }

  private files() {
    return this.s.analysis.graph.nodes.map((n) => ({ id: n.id, dir: n.dir, name: n.name, path: n.id }));
  }

  // ---- Layer 2

  private rescore() {
    const { review, useReview } = this.s;
    this.s.diagnosis = scoreDiagnosis(this.s.basis, this.s.outcomes, this.s.params, review && useReview ? reviewEvidence(review) : null);
  }

  setOutcomes(outcomes: ReadonlyMap<string, Outcome>, report?: { text: string; name: string }) {
    this.s.outcomes = outcomes;
    this.rescore();
    if (report) {
      this.s.report = report;
      this.effects.loadReport(report.text, report.name);
    } else {
      this.effects.setOutcomes(outcomes);
    }
    this.setMode("risk");
  }

  setReview(review: Review) {
    this.s.review = review;
    this.rescore();
    this.effects.setReview(review);
    this.setMode("risk");
  }

  // ---- Layer 1

  /** Runs the clustering search on the source files; `show` puts the clusters on the diagram. */
  cluster(options: Partial<SearchOptions>, show: boolean): ClusterRun {
    const run = clusterProject(this.s.analysis.graph, this.s.analysis, options);
    this.s.grouping.clusters = run;
    if (show) this.setGrouping("clusters", { clusters: run });
    return run;
  }

  setGrouping(kind: GroupingKind, update?: { clusters?: ClusterRun; ai?: Grouping }) {
    if (update?.ai) this.s.grouping.ai = update.ai;
    if (update?.clusters) this.s.grouping.clusters = update.clusters;
    this.s.grouping.kind = kind;
    const g = kind === "clusters" ? this.s.grouping.clusters?.grouping : kind === "ai" ? this.s.grouping.ai : null;
    // Tests and config shown in the diagram keep their folder module.
    const partition = { ...this.s.diagram.partition };
    for (const n of this.s.analysis.graph.nodes) partition[n.id] = g ? g.partition[n.id] : this.s.analysis.partition[n.id];
    this.s.diagram = { partition, labels: { ...this.s.analysis.labels, ...(g?.labels ?? {}) } };
    this.effects.setGrouping(kind, update);
    this.s.view.mode = "structure";
    this.s.view.tab = "diagram";
  }

  // ---- Layer 3

  /** Applies rules unless they have errors; returns the new policy either way. */
  setRules(text: string): Policy {
    const policy = new Policy(text, this.prefix);
    if (policy.errors.length > 0) return policy;
    this.s.rulesText = text;
    this.s.policy = policy;
    this.s.violations = policy.evaluate(this.files(), this.s.analysis.graph.edges).violations;
    this.s.plan = null;
    this.s.step = 0;
    this.effects.setRulesText(text);
    this.setMode("refactor");
    return policy;
  }

  problem(): PlanProblem {
    const d = this.s.diagnosis;
    return {
      files: this.files(),
      edges: this.s.analysis.graph.edges,
      policy: this.s.policy,
      risk: new Map(d.files.map((f) => [f.id, d.maxPosterior > 0 ? f.posterior / d.maxPosterior : 0])),
    };
  }

  plan(options: PlanSettings): PlanResult {
    if (options.heuristic !== this.s.planOptions.heuristic || options.riskWeight !== this.s.planOptions.riskWeight) {
      this.s.planOptions = options;
      this.effects.setPlanOptions(options);
    }
    const result = planRefactoring(this.problem(), { ...options, timeLimitMs: 4000 });
    this.s.plan = result;
    this.s.patches = null;
    this.s.step = 0;
    this.effects.adoptPlan(result, this.s.rulesText);
    this.setMode("refactor");
    return result;
  }

  compare(): SearchComparison[] {
    const rows = compareSearches(this.problem(), this.s.planOptions.riskWeight);
    this.effects.adoptComparison(rows, this.s.rulesText);
    this.setMode("refactor");
    return rows;
  }

  attachPatch(step: number, diff: string, note?: string) {
    const plan = this.s.plan!;
    this.s.patches = new Map(this.s.patches ?? []).set(step, { diff, note });
    this.effects.attachPatch(plan, step, diff, note);
  }

  showStep(step: number, play: boolean) {
    this.setMode("refactor");
    if (play) {
      this.s.step = 0;
      this.effects.play();
    } else {
      this.s.step = step;
      this.effects.setStep(step);
    }
  }

  // ---- View

  setMode(mode: ViewMode) {
    if (this.s.view.mode === mode && this.s.view.tab === "diagram") return;
    this.s.view.mode = mode;
    this.s.view.tab = "diagram";
    this.effects.show({ mode });
  }

  show(options: { mode?: ViewMode; focus?: ViewTarget; highlight?: string[] }) {
    if (options.mode) this.s.view.mode = options.mode;
    this.s.view.tab = "diagram";
    this.effects.show(options);
  }

  // ---- Names

  /** A file id from what the model wrote: a full path, a path below the prefix, or a unique name. */
  resolveFile(input: string, scope: "all" | "source" = "all"): string {
    const ids = (scope === "all" ? this.s.data.graph.nodes : this.s.analysis.graph.nodes).map((n) => n.id);
    return resolvePath(ids, input, this.prefix);
  }

  /** A module id from its label or id (in the diagram's current grouping). */
  resolveModule(input: string): string | null {
    const q = input.trim().replace(/^\.?\//, "").replace(/\/+$/, "");
    const { labels } = this.s.diagram;
    const ids = Object.keys(labels);
    return ids.find((m) => m === q) ?? ids.find((m) => labels[m] === q) ?? ids.find((m) => labels[m].toLowerCase() === q.toLowerCase()) ?? null;
  }

  label(module: string): string {
    return this.s.diagram.labels[module] ?? this.s.analysis.labels[module] ?? module;
  }
}

export class ToolError extends Error {}

const stripExt = (p: string) => p.replace(/\.[^./]+$/, "");

/** Resolves a path the way people write them; throws a ToolError with suggestions when it can't. */
export function resolvePath(ids: readonly string[], input: string, prefix: string): string {
  const q = input.trim().replace(/\\/g, "/").replace(/^\.?\//, "");
  if (!q) throw new ToolError("Give a file path.");
  const set = new Set(ids);
  if (set.has(q)) return q;
  if (prefix && set.has(`${prefix}/${q}`)) return `${prefix}/${q}`;
  const bySuffix = ids.filter((id) => id.endsWith(`/${q}`));
  if (bySuffix.length === 1) return bySuffix[0];
  const byStem = ids.filter((id) => stripExt(id) === q || stripExt(id).endsWith(`/${q}`));
  if (byStem.length === 1) return byStem[0];
  const name = q.slice(q.lastIndexOf("/") + 1).toLowerCase();
  const near = bySuffix.length > 1 ? bySuffix : byStem.length > 1 ? byStem : ids.filter((id) => id.toLowerCase().includes(stripExt(name)));
  if (near.length > 0) throw new ToolError(`"${input}" ${bySuffix.length > 1 || byStem.length > 1 ? "is ambiguous" : "is not a file here"}. Did you mean: ${near.slice(0, 8).join(", ")}?`);
  throw new ToolError(`No file matches "${input}". Use list_files to find it.`);
}
