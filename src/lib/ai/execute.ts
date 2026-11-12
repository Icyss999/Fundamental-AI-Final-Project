/**
 * Runs the assistant's tool calls against an AssistantWorkspace (client-safe). Every tool is a thin
 * adapter over the from-scratch algorithms: it reads or changes Layer 1/2/3 state and returns a
 * compact JSON result for the model plus a one-line summary for the chat.
 */

import { architectureGrouping, type ArchitectureModule, type ClusterRun, type Grouping } from "@/lib/cluster/grouping";
import { isModuleKind } from "@/lib/graph/kinds";
import { describeStep, structureMetrics } from "@/lib/change/describe";
import { formatFact, type Proof } from "@/lib/change/engine";
import type { Heuristic } from "@/lib/change/planner";
import type { Outcome } from "@/lib/diagnose/bayes";
import { parseTestReport, reportFailures } from "@/lib/diagnose/reports";
import type { Severity, Finding } from "@/lib/diagnose/review";
import { degrees } from "@/lib/graph/analysis";
import { moduleGraph } from "@/lib/graph/partition";
import { githubLink } from "@/lib/repo/links";
import { resolvePath, ToolError, type AssistantWorkspace, type ViewMode, type ViewTarget } from "./workspace";

export interface ToolOutcome {
  /** What the model reads. */
  content: string;
  /** One line for the chat. */
  summary: string;
  ok: boolean;
}

type Args = Record<string, unknown>;
interface Result {
  content: unknown;
  summary: string;
  ok?: boolean;
}
type Handler = (ws: AssistantWorkspace, args: Args) => Result | Promise<Result>;

const MAX_RESULT_CHARS = 24_000;
const READ_LINES = 400;
const MODES: readonly ViewMode[] = ["structure", "risk", "refactor"];
const HEURISTICS: readonly Heuristic[] = ["matching", "count", "zero"];
const SEARCH_LABEL: Record<Heuristic, string> = { matching: "A* (matching bound)", count: "A* (violation count)", zero: "uniform-cost search" };

/** What the chat shows while a tool runs. */
export const TOOL_LABELS: Record<string, string> = {
  get_project_overview: "Reading the project overview",
  list_files: "Listing files",
  get_file: "Inspecting",
  cluster_modules: "Clustering (MQ search)",
  set_architecture: "Rearranging the diagram",
  report_findings: "Recording review findings",
  attach_patch: "Attaching a patch",
  read_file: "Reading",
  show_in_diagram: "Updating the diagram",
  list_tests: "Listing tests",
  set_test_outcomes: "Recording test results",
  load_example_report: "Loading the example test report",
  get_test_failures: "Reading test failures",
  rank_suspects: "Ranking suspects (Bayes)",
  explain_suspect: "Explaining",
  get_rules: "Reading the rules",
  set_rules: "Applying rules (rule engine)",
  list_violations: "Listing violations",
  explain_violation: "Proving a violation",
  plan_refactoring: "Planning (A* search)",
  compare_search: "Comparing searches",
  show_plan_step: "Stepping through the plan",
};

/** "Reading pricing.ts" — the label plus the file a call is about, if any. */
export function describeCall(name: string, rawArgs: string): string {
  const label = TOOL_LABELS[name] ?? name;
  try {
    const args = JSON.parse(rawArgs || "{}") as Args;
    const subject = typeof args.path === "string" ? args.path : typeof args.from === "string" ? `${args.from} → ${args.to}` : null;
    return subject ? `${label} ${baseName(subject)}` : label;
  } catch {
    return label;
  }
}

export async function executeTool(ws: AssistantWorkspace, name: string, rawArgs: string): Promise<ToolOutcome> {
  const handler = HANDLERS[name];
  if (!handler) return failure(`There is no tool called ${name}.`);
  let args: Args;
  try {
    const parsed: unknown = rawArgs.trim() ? JSON.parse(rawArgs) : {};
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return failure("Arguments must be a JSON object.");
    args = parsed as Args;
  } catch {
    return failure("Arguments were not valid JSON.");
  }
  try {
    const r = await handler(ws, args);
    let content = typeof r.content === "string" ? r.content : JSON.stringify(r.content);
    if (content.length > MAX_RESULT_CHARS) content = `${content.slice(0, MAX_RESULT_CHARS)}\n…(truncated — ask for less)`;
    return { content, summary: r.summary, ok: r.ok ?? true };
  } catch (err) {
    if (err instanceof ToolError) return failure(err.message);
    console.error(`Tool ${name} failed`, err);
    return failure(`The tool failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function failure(message: string): ToolOutcome {
  return { content: JSON.stringify({ error: message }), summary: message, ok: false };
}

// ---------------------------------------------------------------------------------------------
// Argument readers

function str(args: Args, key: string, required: true): string;
function str(args: Args, key: string, required?: false): string | undefined;
function str(args: Args, key: string, required = false): string | undefined {
  const v = args[key];
  if (v === undefined || v === null || v === "") {
    if (required) throw new ToolError(`${key} is required.`);
    return undefined;
  }
  if (typeof v !== "string") throw new ToolError(`${key} must be a string.`);
  return v;
}

function num(args: Args, key: string, min: number, max: number): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new ToolError(`${key} must be a number.`);
  return Math.min(max, Math.max(min, n));
}

const int = (args: Args, key: string, fallback: number, min: number, max: number) => Math.round(num(args, key, min, max) ?? fallback);

function strs(args: Args, key: string): string[] {
  const v = args[key];
  if (v === undefined || v === null) return [];
  if (typeof v === "string") return [v];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new ToolError(`${key} must be a list of strings.`);
  return v as string[];
}

function oneOf<T extends string>(args: Args, key: string, values: readonly T[]): T | undefined {
  const v = args[key];
  if (v === undefined || v === null || v === "") return undefined;
  if (!values.includes(v as T)) throw new ToolError(`${key} must be one of: ${values.join(", ")}.`);
  return v as T;
}

// ---------------------------------------------------------------------------------------------
// Formatting

const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const round = (x: number, digits = 2) => Number(x.toFixed(digits));
const pct = (p: number) => `${(p * 100).toFixed(p >= 0.1 ? 1 : p >= 0.01 ? 2 : 3)}%`;
const day = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);
const edgeText = (key: string) => key.replace("\0", " -> ");

function ruleText(ws: AssistantWorkspace, id: string): string {
  const r = ws.state.policy.rules.find((x) => x.id === id);
  return r ? `line ${r.line}: ${r.text}` : id;
}

function proofLines(p: Proof, depth = 0): string[] {
  const pad = "  ".repeat(depth);
  const lines = [`${pad}${formatFact(p.fact)} ${p.rule ? `[${p.rule}]` : "(given fact)"}`];
  for (const q of p.premises) lines.push(...proofLines(q, depth + 1));
  for (const a of p.absent) lines.push(`${pad}  not ${formatFact(a)} (absent, negation as failure)`);
  return lines;
}

function failures(ws: AssistantWorkspace, limit: number) {
  const report = ws.state.report;
  if (!report) return [];
  const ids = ws.state.diagnosis.tests.map((t) => t.id);
  return reportFailures(report.text, ids)
    .slice(0, limit)
    .map((f) => ({ test: f.test, case: f.name, message: f.message.length > 600 ? `${f.message.slice(0, 600)}…` : f.message }));
}

function topSuspects(ws: AssistantWorkspace, n = 5): string[] {
  return ws.state.diagnosis.files.slice(0, n).map((f) => `${f.id} ${pct(f.posterior)}`);
}

/** Modules of a grouping as the model sees them: id, label, files (capped), internal imports. */
function describeGrouping(ws: AssistantWorkspace, g: Grouping, fileCap = 30) {
  const graph = ws.state.analysis.graph;
  const { edges, internal } = moduleGraph(graph, g.partition);
  const members = new Map<string, string[]>();
  for (const n of graph.nodes) {
    const m = g.partition[n.id];
    if (m) members.set(m, [...(members.get(m) ?? []), n.id]);
  }
  const label = (m: string) => g.labels[m] ?? m;
  return {
    modules: [...members].map(([id, files]) => ({
      id,
      label: label(id),
      ...(g.descriptions?.[id] ? { purpose: g.descriptions[id], tier: g.tiers?.[id] } : {}),
      files: files.length > fileCap ? [...files.slice(0, fileCap), `…and ${files.length - fileCap} more`] : files,
      internal_imports: internal.get(id) ?? 0,
    })),
    imports_between: [...edges]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 50)
      .map((e) => `${e.source} -> ${e.target} (${e.weight})`),
  };
}

function moduleOf(ws: AssistantWorkspace, file: string): string {
  const { diagram, analysis } = ws.state;
  const mod = diagram.partition[file] ?? analysis.partition[file];
  return mod ? ws.label(mod) : "(hidden: not a source file)";
}

// ---------------------------------------------------------------------------------------------
// Tools

const HANDLERS: Record<string, Handler> = {
  get_project_overview(ws) {
    const { data, analysis: a, diagnosis: d, policy, violations, plan, step } = ws.state;
    const o = data.overview;
    const label = (m: string) => a.labels[m] ?? m;
    const hidden: Record<string, number> = {};
    for (const n of data.graph.nodes) if (n.role !== "source") hidden[n.role] = (hidden[n.role] ?? 0) + 1;
    const src = o.source;
    return {
      summary: `${a.graph.nodes.length} files in ${a.modules.size} modules`,
      content: {
        name: o.name,
        description: o.description,
        readme: o.readme ? { title: o.readme.title, summary: o.readme.summary?.slice(0, 800) ?? null } : null,
        source: src.kind === "github" ? `github.com/${src.owner}/${src.repo}${src.subdir ? `/${src.subdir}` : ""} @ ${src.commit.slice(0, 7)} (${src.branch})` : src.path,
        stack: o.techStack.map((t) => t.name),
        languages: o.languages.slice(0, 6).map((l) => `${l.name} (${l.files} files)`),
        source_files: a.graph.nodes.length,
        lines: a.totalLoc,
        hidden_files: hidden,
        shared_prefix: a.prefix || null,
        summary: a.summary,
        modules: a.stats.map((s) => ({ module: label(s.id), files: s.files, lines: s.loc, depends_on: s.dependsOn, used_by: s.usedBy })),
        module_imports: [...a.moduleEdges]
          .sort((x, y) => y.weight - x.weight)
          .slice(0, 80)
          .map((e) => `${label(e.source)} -> ${label(e.target)} (${e.weight})`),
        entry_points: a.entryPoints.map((e) => `${e.id} (imports ${e.fanOut})`),
        core_files: a.coreFiles.map((c) => `${c.id} (imported by ${c.fanIn})`),
        import_cycles: a.cycles.slice(0, 10).map((c) => (c.length > 15 ? [...c.slice(0, 15), `…+${c.length - 15}`] : c)),
        god_files: a.godFiles.map((g) => ({ file: g.id, imported_by: g.fanIn, z_score: round(g.zScore) })),
        history: d.history ? { commits: d.history.commits, bug_fix_commits: d.history.fixCommits, from: d.history.from ? day(d.history.from) : null, to: d.history.to ? day(d.history.to) : null } : null,
        tests: { test_files: d.tests.length, failing: d.failing, passing: d.passing },
        example_report: data.exampleReport?.name ?? null,
        rules: { active: policy.active, errors: policy.errors.length, violations: violations.length },
        plan: plan ? { status: plan.status, steps: plan.steps.length, cost: round(plan.cost), showing_step: step } : null,
        diagram_grouping: {
          showing: ws.state.grouping.kind,
          mq: { folders: round(ws.state.grouping.folderMQ, 3), clusters: ws.state.grouping.clusters ? round(ws.state.grouping.clusters.grouping.mq, 3) : null, ai: ws.state.grouping.ai ? round(ws.state.grouping.ai.mq, 3) : null },
          ai_modules: ws.state.grouping.ai ? Object.keys(ws.state.grouping.ai.labels).map((m) => `${ws.state.grouping.ai!.labels[m]} (tier ${ws.state.grouping.ai!.tiers?.[m]}): ${ws.state.grouping.ai!.descriptions?.[m]}`) : null,
        },
        ai_review: ws.state.review ? { findings: ws.state.review.findings.length, files_reviewed: ws.state.review.reviewed.length } : null,
      },
    };
  },

  cluster_modules(ws, args) {
    const algorithm = oneOf(args, "algorithm", ["annealing", "hill_climbing"] as const) ?? "annealing";
    const start = oneOf(args, "start", ["singletons", "folders"] as const) ?? "singletons";
    const run = ws.cluster({ algorithm: algorithm === "annealing" ? "annealing" : "hill-climbing", start, seed: int(args, "seed", 42, 0, 2 ** 31) });
    const s = run.stats;
    const clusters = Object.keys(run.grouping.labels).length;
    return {
      summary: `${clusters} clusters, MQ ${run.grouping.mq.toFixed(2)} (folders ${run.folderMQ.toFixed(2)}) · ${s.ms} ms`,
      content: {
        mq: round(run.grouping.mq, 3),
        folder_mq: round(run.folderMQ, 3),
        search: { algorithm, start, iterations: s.iterations, accepted: s.accepted, worse_moves_accepted: algorithm === "annealing" ? s.uphill : undefined, restarts: s.restarts || undefined, ms: s.ms },
        ...describeGrouping(ws, run.grouping),
      },
    };
  },

  set_architecture(ws, args) {
    const raw = args.modules;
    if (!Array.isArray(raw) || raw.length === 0) throw new ToolError("modules must be a non-empty list.");
    if (raw.length > 20) throw new ToolError("Use at most 20 modules.");
    const s = ws.state;
    const source = s.analysis.graph.nodes.map((n) => n.id);
    const clusters: ClusterRun | null = s.grouping.clusters;
    const unknown: string[] = [];
    const owner = new Map<string, number>();
    const explicit = new Map<string, number>();
    const specs = raw.map((m, i) => {
      if (typeof m !== "object" || m === null) throw new ToolError(`modules[${i}] must be an object.`);
      const r = m as Args;
      const name = str(r, "name", true).trim().slice(0, 48);
      const purpose = (str(r, "purpose") ?? "").trim().slice(0, 200);
      const tier = int(r, "tier", i, 0, 9);
      const kind = isModuleKind(r.kind) ? r.kind : undefined;
      for (const c of strs(r, "clusters")) {
        const files = clusters ? Object.entries(clusters.grouping.partition).filter(([, id]) => id === c.trim()).map(([f]) => f) : [];
        if (files.length === 0) unknown.push(clusters ? `cluster ${c}` : `cluster ${c} (run cluster_modules first)`);
        files.forEach((f) => owner.set(f, i));
      }
      for (const folder of strs(r, "folders")) {
        const q = folder.trim().replace(/\/+$/, "");
        const id = Object.keys(s.analysis.labels).find((m2) => m2 === q || s.analysis.labels[m2] === q);
        const files = id ? source.filter((f) => s.analysis.partition[f] === id) : [];
        if (files.length === 0) unknown.push(`folder ${folder}`);
        files.forEach((f) => owner.set(f, i));
      }
      for (const name2 of strs(r, "files")) {
        try {
          explicit.set(ws.resolveFile(name2, "source"), i);
        } catch {
          unknown.push(name2);
        }
      }
      return { name, purpose, tier, kind };
    });
    for (const [f, i] of explicit) owner.set(f, i);
    const unassigned = source.filter((f) => !owner.has(f));
    const modules: ArchitectureModule[] = specs.map((m, i) => ({ ...m, files: source.filter((f) => owner.get(f) === i) })).filter((m) => m.files.length > 0);
    const empty = specs.filter((_, i) => !source.some((f) => owner.get(f) === i)).map((m) => m.name);
    if (unassigned.length > 0) modules.push({ name: "Unsorted", purpose: "Files the architecture did not place yet.", tier: Math.max(0, ...modules.map((m) => m.tier)), files: unassigned });
    if (modules.length === 0) throw new ToolError("No module got any files. Name cluster ids, folders or files.");

    const grouping = architectureGrouping(s.analysis.graph, modules);
    ws.setGrouping("ai", { ai: grouping });
    return {
      ok: unknown.length === 0,
      summary: `Diagram rearranged into ${modules.length} modules · MQ ${grouping.mq.toFixed(2)}${unassigned.length ? ` · ${unassigned.length} unsorted` : ""}`,
      content: {
        applied: true,
        mq: { architecture: round(grouping.mq, 3), clusters: clusters ? round(clusters.grouping.mq, 3) : null, folders: round(s.grouping.folderMQ, 3) },
        modules: modules.map((m) => `${m.name} (tier ${m.tier}${m.kind ? `, ${m.kind}` : ""}): ${m.files.length} files`),
        unsorted: unassigned.length ? unassigned.slice(0, 40) : undefined,
        empty_modules: empty.length ? empty : undefined,
        unknown: unknown.length ? unknown : undefined,
      },
    };
  },

  list_files(ws, args) {
    const { data, analysis: a, diagnosis: d } = ws.state;
    const includeTests = args.include_tests === true;
    const sort = oneOf(args, "sort", ["path", "risk", "fan_in", "loc"] as const) ?? "path";
    const limit = int(args, "limit", 60, 1, 300);
    const query = str(args, "query")?.toLowerCase();
    const moduleArg = str(args, "module");
    const mod = moduleArg ? ws.resolveModule(moduleArg) : null;
    if (moduleArg && !mod) throw new ToolError(`No module "${moduleArg}". Modules: ${Object.values(ws.state.diagram.labels).join(", ")}.`);

    const nodes = includeTests ? data.graph.nodes : a.graph.nodes;
    const deg = includeTests ? degrees(data.graph) : a.degree;
    let files = nodes.filter((n) => {
      if (query && !n.id.toLowerCase().includes(query)) return false;
      if (mod) return (ws.state.diagram.partition[n.id] ?? a.partition[n.id]) === mod || n.id.startsWith(`${mod}/`);
      return true;
    });
    const risk = (id: string) => d.byId.get(id)?.posterior ?? -1;
    const fanIn = (id: string) => deg.get(id)?.fanIn ?? 0;
    if (sort === "risk") files = [...files].sort((x, y) => risk(y.id) - risk(x.id));
    else if (sort === "fan_in") files = [...files].sort((x, y) => fanIn(y.id) - fanIn(x.id));
    else if (sort === "loc") files = [...files].sort((x, y) => y.loc - x.loc);
    return {
      summary: `${files.length} files${mod ? ` in ${ws.label(mod)}` : ""}`,
      content: {
        total: files.length,
        shown: Math.min(limit, files.length),
        files: files.slice(0, limit).map((n) => ({
          path: n.id,
          ...(includeTests ? { role: n.role } : {}),
          module: moduleOf(ws, n.id),
          lines: n.loc,
          imported_by: fanIn(n.id),
          imports: deg.get(n.id)?.fanOut ?? 0,
          bug_risk: d.byId.has(n.id) ? pct(risk(n.id)) : undefined,
        })),
      },
    };
  },

  get_file(ws, args) {
    const { data, analysis: a, diagnosis: d, violations } = ws.state;
    const id = ws.resolveFile(str(args, "path", true));
    const node = data.graph.nodes.find((n) => n.id === id)!;
    const imports = data.graph.edges.filter((e) => e.source === id);
    const importedBy = data.graph.edges.filter((e) => e.target === id);
    const cycle = a.cycles.find((c) => c.includes(id));
    const god = a.godFiles.find((g) => g.id === id);
    const risk = d.byId.get(id);
    return {
      summary: `${baseName(id)}: imports ${imports.length}, imported by ${importedBy.length}`,
      content: {
        path: id,
        role: node.role,
        module: moduleOf(ws, id),
        lines: node.loc,
        imports: imports.slice(0, 60).map((e) => (e.typeOnly ? `${e.target} (types only)` : e.target)),
        imported_by: importedBy.slice(0, 60).map((e) => (e.typeOnly ? `${e.source} (types only)` : e.source)),
        import_cycle: cycle ?? null,
        god_file: god ? { imported_by: god.fanIn, z_score: round(god.zScore) } : null,
        bug_risk: risk ? { probability: pct(risk.posterior), rank: `${risk.rank} of ${d.files.length}`, prior: pct(risk.prior.p), bug_fixes: risk.history?.fixes ?? 0, changes: risk.history?.changes ?? 0 } : null,
        rule_violations: violations
          .filter((v) => v.source === id || v.target === id)
          .slice(0, 30)
          .map((v) => ({ from: v.source, to: v.target, rules: v.rules.map((r) => ruleText(ws, r)) })),
        github: githubLink(data.overview.source, id, "blob"),
      },
    };
  },

  async read_file(ws, args) {
    const id = ws.resolveFile(str(args, "path", true));
    const text = await ws.effects.readSource(id);
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    const total = lines.length;
    const start = int(args, "start_line", 1, 1, Math.max(1, total));
    const end = Math.min(total, start + READ_LINES - 1, int(args, "end_line", start + READ_LINES - 1, start, Number.MAX_SAFE_INTEGER));
    const width = String(end).length;
    const body = lines
      .slice(start - 1, end)
      .map((l, i) => `${String(start + i).padStart(width)}| ${l.length > 400 ? `${l.slice(0, 400)}…` : l}`)
      .join("\n");
    const more = end < total ? ` — more below: start_line=${end + 1}` : "";
    const whole = start === 1 && end === total;
    return {
      summary: whole ? `Read ${baseName(id)} (${total} lines)` : `Read ${baseName(id)} lines ${start}–${end} of ${total}`,
      content: `${id} — lines ${start}-${end} of ${total}${more}\n${body}`,
    };
  },

  show_in_diagram(ws, args) {
    const mode = oneOf(args, "mode", MODES);
    const focusArg = str(args, "focus");
    const { partition } = ws.state.diagram;
    const hidden: string[] = [];
    const unknown: string[] = [];
    let focus: ViewTarget | undefined;
    if (focusArg) {
      const mod = ws.resolveModule(focusArg);
      if (mod) focus = { type: "module", id: mod };
      else {
        const id = ws.resolveFile(focusArg);
        if (partition[id]) focus = { type: "file", id };
        else hidden.push(id);
      }
    }
    let highlight: string[] | undefined;
    if (Array.isArray(args.highlight) || typeof args.highlight === "string") {
      highlight = [];
      for (const name of strs(args, "highlight")) {
        try {
          const id = ws.resolveFile(name);
          if (partition[id]) highlight.push(id);
          else hidden.push(id);
        } catch {
          unknown.push(name);
        }
      }
    }
    ws.show({ mode, focus, highlight });
    const did = [
      mode && `switched to ${mode}`,
      focus && `zoomed to ${focus.type === "file" ? baseName(focus.id) : ws.label(focus.id)}`,
      highlight && (highlight.length ? `highlighted ${highlight.length} ${highlight.length === 1 ? "file" : "files"}` : "cleared highlights"),
    ].filter(Boolean);
    const sentence = did.join(", ");
    return {
      summary: sentence ? sentence[0].toUpperCase() + sentence.slice(1) : "Opened the diagram",
      content: {
        mode: ws.state.view.mode,
        focused: focus ? focus.id : null,
        highlighted: highlight ?? undefined,
        hidden: hidden.length ? { files: hidden, note: "Tests, stories, examples and config are hidden unless the user turns on their toggle." } : undefined,
        unknown: unknown.length ? unknown : undefined,
      },
    };
  },

  list_tests(ws, args) {
    const d = ws.state.diagnosis;
    const limit = int(args, "limit", 100, 1, 500);
    return {
      summary: `${d.tests.length} test files (${d.failing} failing, ${d.passing} passing)`,
      content: {
        total: d.tests.length,
        failing: d.failing,
        passing: d.passing,
        tests: d.tests.slice(0, limit).map((t) => ({ test: t.id, outcome: t.outcome ?? "unknown", reaches_source_files: t.covers })),
      },
    };
  },

  set_test_outcomes(ws, args) {
    const failing = strs(args, "failing");
    const passing = strs(args, "passing");
    const rest = oneOf(args, "rest", ["keep", "pass", "unknown"] as const) ?? "keep";
    const ids = ws.state.diagnosis.tests.map((t) => t.id);
    if (ids.length === 0) throw new ToolError("This project has no test files, so the ranking can only use history and size.");
    if (failing.length === 0 && passing.length === 0 && rest === "keep") throw new ToolError("Name failing or passing test files, or set rest.");

    const next = new Map<string, Outcome>(rest === "keep" ? ws.state.outcomes : []);
    if (rest === "pass") for (const id of ids) next.set(id, "pass");
    const unmatched: string[] = [];
    for (const [list, outcome] of [
      [passing, "pass"],
      [failing, "fail"],
    ] as const) {
      for (const name of list) {
        try {
          next.set(resolvePath(ids, name, ws.prefix), outcome);
        } catch (e) {
          unmatched.push(e instanceof ToolError ? e.message : name);
        }
      }
    }
    ws.setOutcomes(next);
    const d = ws.state.diagnosis;
    return {
      summary: `${d.failing} failing, ${d.passing} passing · top suspect ${baseName(d.files[0]?.id ?? "-")} ${d.files[0] ? pct(d.files[0].posterior) : ""}`,
      ok: unmatched.length === 0,
      content: { failing: d.failing, passing: d.passing, unknown: ids.length - d.failing - d.passing, unmatched: unmatched.length ? unmatched : undefined, top_suspects: topSuspects(ws) },
    };
  },

  load_example_report(ws) {
    const report = ws.state.data.exampleReport;
    if (!report) throw new ToolError("This project ships no test report. Ask the user which tests fail, or for their test output.");
    const parsed = parseTestReport(report.text, ws.state.diagnosis.tests.map((t) => t.id));
    ws.setOutcomes(parsed.outcomes, report);
    const failed = [...parsed.outcomes].filter(([, o]) => o === "fail").map(([t]) => t);
    return {
      summary: `Loaded ${report.name}: ${failed.length} failing of ${parsed.outcomes.size}`,
      content: {
        report: report.name,
        format: parsed.format,
        failing: failed,
        passing: parsed.outcomes.size - failed.length,
        unmatched: parsed.unmatched,
        failure_messages: failures(ws, 5),
        top_suspects: topSuspects(ws),
      },
    };
  },

  get_test_failures(ws, args) {
    if (!ws.state.report) throw new ToolError("No test report has been loaded. Ask the user for the failure output (or to load a report in the Bug risk panel).");
    const list = failures(ws, int(args, "limit", 20, 1, 100));
    return {
      summary: `${list.length} failing ${list.length === 1 ? "case" : "cases"} in ${ws.state.report.name}`,
      content: { report: ws.state.report.name, failures: list },
    };
  },

  report_findings(ws, args) {
    const raw = args.findings;
    if (!Array.isArray(raw)) throw new ToolError("findings must be a list (it may be empty).");
    const unknown: string[] = [];
    const findings: Finding[] = [];
    for (const [i, item] of raw.entries()) {
      if (typeof item !== "object" || item === null) throw new ToolError(`findings[${i}] must be an object.`);
      const r = item as Args;
      let file: string;
      try {
        file = ws.resolveFile(str(r, "file", true));
      } catch {
        unknown.push(String(r.file));
        continue;
      }
      const line = num(r, "line", 1, 1e6);
      const fix = str(r, "fix");
      findings.push({
        file,
        ...(line !== undefined ? { line: Math.round(line) } : {}),
        severity: oneOf(r, "severity", ["high", "medium", "low"] as const) ?? ("medium" as Severity),
        title: str(r, "title", true).slice(0, 160),
        detail: (str(r, "detail") ?? "").slice(0, 2000),
        ...(fix ? { fix: fix.slice(0, 20_000) } : {}),
      });
    }
    const reviewed: string[] = [];
    for (const name of strs(args, "reviewed")) {
      try {
        reviewed.push(ws.resolveFile(name));
      } catch {
        unknown.push(name);
      }
    }
    const before = ws.state.diagnosis.files[0];
    const previous = args.append === true ? ws.state.review : null;
    ws.setReview({
      findings: [...(previous?.findings ?? []), ...findings],
      reviewed: [...new Set([...(previous?.reviewed ?? []), ...reviewed, ...findings.map((f) => f.file)])],
    });
    const d = ws.state.diagnosis;
    const top = d.files[0];
    return {
      ok: unknown.length === 0,
      summary: `${findings.length} ${findings.length === 1 ? "finding" : "findings"} recorded${top ? ` · top suspect ${baseName(top.id)} ${pct(top.posterior)}` : ""}`,
      content: {
        recorded: findings.length,
        files_reviewed: ws.state.review!.reviewed.length,
        counts_as_evidence: ws.state.useReview,
        top_suspect_before: before ? `${before.id} ${pct(before.posterior)}` : null,
        top_suspects_now: topSuspects(ws),
        unknown_files: unknown.length ? unknown : undefined,
      },
    };
  },

  rank_suspects(ws, args) {
    const d = ws.state.diagnosis;
    const limit = int(args, "limit", 10, 1, 50);
    const top = d.files[0];
    const hasEvidence = d.failing + d.passing > 0;
    return {
      summary: top ? `#1 ${baseName(top.id)} ${pct(top.posterior)}${d.files[1] ? ` · #2 ${baseName(d.files[1].id)} ${pct(d.files[1].posterior)}` : ""}` : "No candidate files",
      content: {
        evidence: { failing_tests: d.failing, passing_tests: d.passing, unknown_tests: d.tests.length - d.failing - d.passing },
        history: d.history ? { commits: d.history.commits, bug_fix_commits: d.history.fixCommits } : "none — the prior follows file size only",
        candidates: d.files.length,
        note: hasEvidence ? undefined : "No test outcomes yet: this ranking is only the history/size prior.",
        suspects: d.files.slice(0, limit).map((f) => ({
          rank: f.rank,
          file: f.id,
          probability: pct(f.posterior),
          prior: pct(f.prior.p),
          ochiai_rank: d.failing > 0 ? f.ochiaiRank : undefined,
          bug_fixes: f.history?.fixes ?? 0,
          changes: f.history?.changes ?? 0,
          failing_tests_reaching: f.factors.filter((x) => x.outcome === "fail").length,
          passing_tests_reaching: f.factors.filter((x) => x.outcome === "pass").length,
          strongest_evidence: f.factors[0] ? `${baseName(f.factors[0].test)} ${f.factors[0].outcome === "fail" ? "failed" : "passed"} (×${round(Math.exp(f.factors[0].logBF), 3)})` : undefined,
        })),
      },
    };
  },

  explain_suspect(ws, args) {
    const d = ws.state.diagnosis;
    const id = ws.resolveFile(str(args, "path", true));
    const f = d.byId.get(id);
    if (!f) throw new ToolError(`${id} is not a source file, so it is not ranked (tests, config and declarations are excluded).`);
    const h = f.history;
    return {
      summary: `${baseName(id)}: ${pct(f.posterior)} (#${f.rank}), prior ${pct(f.prior.p)}`,
      content: {
        file: id,
        probability: pct(f.posterior),
        rank: `${f.rank} of ${d.files.length}`,
        prior: { probability: pct(f.prior.p), expected_bugs: round(f.prior.lambda, 3), from_size: round(f.prior.sizePart, 3), from_history: round(f.prior.historyPart, 3), lines: f.loc },
        history: h
          ? {
              changes: h.changes,
              bug_fixes: h.fixes,
              recency_weighted_changes: round(h.weightedChanges),
              recency_weighted_fixes: round(h.weightedFixes),
              recent_fixes: h.recentFixes.map((x) => `${x.sha.slice(0, 7)} ${day(x.time)} ${x.subject}`),
              last_change: h.lastChange ? day(h.lastChange) : null,
            }
          : null,
        test_evidence: f.factors.slice(0, 25).map((x) => ({ test: x.test, outcome: x.outcome, coverage: round(x.coverage, 3), hops: x.depth, bayes_factor: round(Math.exp(x.logBF), 3) })),
        tests_reaching_it: f.coveredBy,
        ochiai: d.failing > 0 ? { score: round(f.ochiai, 3), rank: f.ochiaiRank } : undefined,
        how: "posterior ∝ prior × the product of the Bayes factors, normalised over all files (single fault)",
      },
    };
  },

  get_rules(ws) {
    const { rulesText, suggestedRules, policy, violations, analysis } = ws.state;
    const isSuggestion = rulesText === suggestedRules;
    return {
      summary: `${policy.rules.length} rules, ${violations.length} violations${isSuggestion ? " (folder-name suggestion)" : ""}`,
      content: {
        rules_text: rulesText,
        is_folder_suggestion: isSuggestion,
        rules: policy.rules.map((r) => `line ${r.line}: ${r.text}`),
        errors: policy.errors.map((e) => `line ${e.line}: ${e.message}`),
        violations: violations.length,
        shared_prefix: analysis.prefix || null,
        suggested_rules: isSuggestion ? undefined : suggestedRules,
      },
    };
  },

  set_rules(ws, args) {
    const text = `${str(args, "rules", true).replace(/\r\n/g, "\n").trimEnd()}\n`;
    const policy = ws.setRules(text);
    if (policy.errors.length > 0) {
      return {
        ok: false,
        summary: `Not applied: ${policy.errors.length} ${policy.errors.length === 1 ? "error" : "errors"} in the rules`,
        content: { applied: false, errors: policy.errors.map((e) => `line ${e.line}: ${e.message}`) },
      };
    }
    const files = ws.state.analysis.graph.nodes.map((n) => n.id);
    const keep = policy.rules.filter((r) => r.kind === "keep").flatMap((r) => r.from);
    const unmatched = [...new Set([...policy.patterns, ...keep])].filter((p) => !files.some((f) => policy.matches(f, p)));
    const { violations } = ws.state;
    return {
      summary: `Rules applied · ${violations.length} ${violations.length === 1 ? "violation" : "violations"}${unmatched.length ? ` · ${unmatched.length} unmatched paths` : ""}`,
      content: {
        applied: true,
        rules: policy.rules.length,
        violations: violations.length,
        first_violations: violations.slice(0, 25).map((v) => `${v.source} -> ${v.target} [${v.rules.map((r) => ruleText(ws, r)).join("; ")}]`),
        unmatched_paths: unmatched.length ? unmatched : undefined,
      },
    };
  },

  list_violations(ws, args) {
    const { policy } = ws.state;
    let list = ws.state.violations;
    const fileArg = str(args, "file");
    if (fileArg) {
      const id = ws.resolveFile(fileArg);
      list = list.filter((v) => v.source === id || v.target === id);
    }
    const limit = int(args, "limit", 30, 1, 100);
    return {
      summary: `${list.length} ${list.length === 1 ? "violation" : "violations"}`,
      content: {
        rules_active: policy.active,
        total: list.length,
        violations: list.slice(0, limit).map((v) => ({
          from: v.source,
          to: v.target,
          rules: v.rules.map((r) => ruleText(ws, r)),
          why: policy
            .explain(v.source, v.target)
            .map((r) => r.summary)
            .join(" "),
        })),
      },
    };
  },

  explain_violation(ws, args) {
    const from = ws.resolveFile(str(args, "from", true));
    const to = ws.resolveFile(str(args, "to", true));
    const exists = ws.state.data.graph.edges.some((e) => e.source === from && e.target === to);
    const reasons = ws.state.policy.explain(from, to);
    if (reasons.length === 0) {
      return { summary: `${baseName(from)} → ${baseName(to)} breaks no rule`, content: { from, to, import_exists: exists, violates: false } };
    }
    return {
      summary: `${baseName(from)} → ${baseName(to)} breaks ${reasons.map((r) => `line ${r.rule.line}`).join(", ")}`,
      content: {
        from,
        to,
        import_exists: exists,
        reasons: reasons.map((r) => ({ rule: `line ${r.rule.line}: ${r.rule.text}`, engine_rule: r.kind, summary: r.summary, proof: proofLines(r.proof).join("\n") })),
      },
    };
  },

  plan_refactoring(ws, args) {
    const s = ws.state;
    if (!s.policy.active) throw new ToolError("There are no rules to plan against. Write some with set_rules first.");
    if (s.violations.length === 0) return { summary: "Nothing to fix", content: { status: "nothing-to-do", note: "No import breaks the current rules." } };
    const heuristic = oneOf(args, "heuristic", HEURISTICS) ?? s.planOptions.heuristic;
    const riskWeight = num(args, "risk_weight", 0, 3) ?? s.planOptions.riskWeight;
    const r = ws.plan({ heuristic, riskWeight });
    const prefix = ws.prefix;
    const last = r.steps[r.steps.length - 1];
    const before = structureMetrics(s.analysis.graph, null, r.initialViolations.length);
    const after = last ? structureMetrics(s.analysis.graph, last.state, r.finalViolations.length) : before;
    const n = r.steps.length;
    return {
      summary: r.status === "solved" ? `Plan: ${n} ${n === 1 ? "step" : "steps"}, cost ${r.cost.toFixed(2)} · ${r.stats.expanded} states expanded` : `Plan ${r.status}: fixes ${r.initialViolations.length - r.finalViolations.length} of ${r.initialViolations.length}`,
      content: {
        status: r.status,
        search: SEARCH_LABEL[r.heuristic],
        risk_weight: riskWeight,
        total_cost: round(r.cost),
        steps: r.steps.map((st, i) => ({
          step: i + 1,
          action: st.action.kind === "move" ? "MoveFile" : "RedirectImport",
          what: describeStep(st, prefix),
          file: st.action.file,
          from: st.action.from,
          to: st.action.to,
          cost: round(st.cost),
          cost_parts: { base: st.costParts.base, rewrites: round(st.costParts.rewrites), risk: round(st.costParts.risk) },
          fixes: st.fixed.map(edgeText),
          breaks: st.introduced.length ? st.introduced.map(edgeText) : undefined,
          violations_left: st.remaining,
        })),
        stats: { expanded: r.stats.expanded, generated: r.stats.generated, reopened: r.stats.reopened, max_frontier: r.stats.maxFrontier, ms: r.stats.ms, h_start: round(r.stats.hStart) },
        before,
        after,
        unfixed: r.finalViolations.length ? r.finalViolations.slice(0, 10).map(edgeText) : undefined,
      },
    };
  },

  compare_search(ws) {
    if (!ws.state.policy.active || ws.state.violations.length === 0) throw new ToolError("There are no violations to plan for, so there is nothing to compare.");
    const rows = ws.compare();
    const by = new Map(rows.map((r) => [r.heuristic, r]));
    return {
      summary: `Expanded: matching ${by.get("matching")?.expanded} · count ${by.get("count")?.expanded} · UCS ${by.get("zero")?.expanded}`,
      content: {
        rows: rows.map((r) => ({ search: SEARCH_LABEL[r.heuristic], status: r.status, cost: round(r.cost), steps: r.steps, expanded: r.expanded, generated: r.generated, h_start: round(r.hStart), ms: r.ms })),
        reading: "matching is admissible, so its cost is optimal (equal to uniform-cost search) with fewer expansions; count can overestimate, so its plan may cost more.",
      },
    };
  },

  attach_patch(ws, args) {
    const plan = ws.state.plan;
    if (!plan || plan.steps.length === 0) throw new ToolError("No plan is loaded. Call plan_refactoring first.");
    const step = int(args, "step", 0, 0, 1000);
    if (step < 1 || step > plan.steps.length) throw new ToolError(`step must be 1..${plan.steps.length}.`);
    const diff = str(args, "diff", true);
    if (diff.length > 40_000) throw new ToolError("That diff is too long; attach the essential changes.");
    ws.attachPatch(step, diff, str(args, "note")?.slice(0, 200));
    return { summary: `Patch attached to step ${step}`, content: { attached: step, step: describeStep(plan.steps[step - 1], ws.prefix), lines: diff.split("\n").length } };
  },

  show_plan_step(ws, args) {
    const plan = ws.state.plan;
    if (!plan || plan.steps.length === 0) throw new ToolError("No plan is loaded. Call plan_refactoring first.");
    const n = plan.steps.length;
    const play = args.play === true;
    const step = play ? 0 : int(args, "step", 0, 0, n);
    ws.showStep(step, play);
    const st = step > 0 ? plan.steps[step - 1] : null;
    return {
      summary: play ? `Playing the plan (${n} steps)` : step === 0 ? "Showing the current code" : `Showing step ${step} of ${n}`,
      content: { showing: play ? "animation from step 0" : step, of: n, step: st ? describeStep(st, ws.prefix) : "current code", violations_left: st ? st.remaining : plan.initialViolations.length },
    };
  },
};
