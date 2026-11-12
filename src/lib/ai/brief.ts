/**
 * Text the assistant gets about the project (client-safe): a brief that goes into the system
 * prompt once per conversation, and the app state prefixed to each user message.
 */

import type { AnalysisResult } from "@/lib/analyze";
import type { ProjectAnalysis } from "@/lib/graph/project-analysis";
import type { WorkspaceSnapshot } from "./workspace";

const MAX_FILES = 250;
const MAX_CHARS = 50_000;

export function projectBrief(data: AnalysisResult, a: ProjectAnalysis): string {
  const o = data.overview;
  const src = o.source;
  const label = (m: string) => a.labels[m] ?? m;
  const lines: string[] = ["# Project brief"];

  lines.push(`Name: ${o.name}${o.description ? ` — ${o.description}` : ""}`);
  if (src.kind === "github") {
    lines.push(`Source: github.com/${src.owner}/${src.repo}${src.subdir ? ` (folder ${src.subdir})` : ""}, branch ${src.branch}, commit ${src.commit.slice(0, 7)}${src.private ? ", private" : ""}`);
  } else {
    lines.push(`Source: ${src.path === "samples/restaurant-app" ? "the bundled sample project (samples/restaurant-app, with planted smells)" : `local folder ${src.path}`}`);
  }
  if (o.readme?.summary) lines.push(`README: ${o.readme.title ? `${o.readme.title} — ` : ""}${o.readme.summary.slice(0, 400)}`);
  if (o.techStack.length) lines.push(`Stack: ${o.techStack.map((t) => t.name).join(", ")}`);
  if (o.languages.length) lines.push(`Languages: ${o.languages.slice(0, 5).map((l) => `${l.name} ${l.files}`).join(", ")}`);

  const hidden: Record<string, number> = {};
  for (const n of data.graph.nodes) if (n.role !== "source") hidden[n.role] = (hidden[n.role] ?? 0) + 1;
  const hiddenText = Object.entries(hidden)
    .map(([role, n]) => `${n} ${role}`)
    .join(", ");
  lines.push(`Source files: ${a.graph.nodes.length} (${a.totalLoc.toLocaleString("en")} lines) in ${a.modules.size} modules${hiddenText ? `; hidden in the diagram by default: ${hiddenText}` : ""}`);
  if (a.prefix) lines.push(`Shared folder prefix: "${a.prefix}" — rule paths and file names may leave it out.`);
  const h = data.history;
  lines.push(h ? `Git history: ${h.commits.length} commits read${h.source === "fixture" ? " (recorded fixture)" : ""}${h.truncated ? ", older ones not read" : ""}.` : "Git history: unavailable — the bug-risk prior uses file size only.");
  const tests = data.graph.nodes.filter((n) => n.role === "test").length;
  lines.push(`Test files: ${tests}${data.exampleReport ? `; an example test report (${data.exampleReport.name}) can be loaded with load_example_report` : ""}.`);

  lines.push("", "## Modules (label: files, lines → modules it imports, with import counts)");
  const out = new Map<string, string[]>();
  for (const e of [...a.moduleEdges].sort((x, y) => y.weight - x.weight)) out.set(e.source, [...(out.get(e.source) ?? []), `${label(e.target)} ${e.weight}`]);
  for (const s of a.stats) lines.push(`- ${label(s.id)}: ${s.files} files, ${s.loc} lines${out.get(s.id) ? ` → ${out.get(s.id)!.join(", ")}` : ""}`);

  lines.push("", `## Files (path · lines · imported by · imports)${a.graph.nodes.length > MAX_FILES ? ` — the ${MAX_FILES} most imported; use list_files for the rest` : ""}`);
  const nodes = a.graph.nodes.length > MAX_FILES ? [...a.graph.nodes].sort((x, y) => (a.degree.get(y.id)?.fanIn ?? 0) - (a.degree.get(x.id)?.fanIn ?? 0)).slice(0, MAX_FILES) : a.graph.nodes;
  for (const n of [...nodes].sort((x, y) => x.id.localeCompare(y.id))) {
    const d = a.degree.get(n.id);
    lines.push(`${n.id} · ${n.loc} · ${d?.fanIn ?? 0} · ${d?.fanOut ?? 0}`);
  }

  lines.push("", "## Flags");
  lines.push(a.cycles.length ? `Import cycles (${a.cycles.length}): ${a.cycles.slice(0, 5).map((c) => c.join(" ↔ ")).join(" | ")}` : "Import cycles: none");
  lines.push(a.godFiles.length ? `God files: ${a.godFiles.map((g) => `${g.id} (imported by ${g.fanIn})`).join(", ")}` : "God files: none");

  const text = lines.join("\n");
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…(brief truncated)` : text;
}

const MODE_LABEL = { structure: "Structure (Layer 1)", risk: "Bug risk (Layer 2)", refactor: "Refactor (Layer 3)" } as const;

/** What the user sees right now, prefixed to their message. */
export function appState(s: WorkspaceSnapshot, highlighted: number): string {
  const v = s.view;
  const d = s.diagnosis;
  const lines = [`Mode: ${MODE_LABEL[v.mode]}`];
  if (v.selection) lines.push(`Selected ${v.selection.type}: ${v.selection.type === "module" ? (s.diagram.labels[v.selection.id] ?? v.selection.id) : v.selection.id}`);
  if (highlighted > 0) lines.push(`Files you highlighted: ${highlighted}`);
  const g = s.grouping;
  const ai = g.ai ? Object.keys(g.ai.labels).length : 0;
  lines.push(`Diagram modules: ${g.ai ? `your architecture (${ai} modules)` : "folders (until you design an architecture)"}`);
  if (s.review) lines.push(`Your code review: ${s.review.findings.length} findings, ${s.review.reviewed.length} files reviewed${s.useReview ? " (counted as evidence)" : " (not counted)"}`);
  lines.push(d.tests.length ? `Test outcomes: ${d.failing} failing, ${d.passing} passing, ${d.tests.length - d.failing - d.passing} unknown` : "Test outcomes: the project has no test files");
  const rules = s.policy.errors.length
    ? `${s.policy.errors.length} parse errors`
    : s.policy.active
      ? `${s.policy.rules.length} rules${s.rulesText === s.suggestedRules ? " (the folder-name suggestion)" : ""}, ${s.violations.length} violations`
      : "none";
  lines.push(`Rules: ${rules}`);
  const p = s.plan;
  lines.push(p ? `Plan: ${p.status}, ${p.steps.length} steps, cost ${p.cost.toFixed(2)}; showing step ${s.step}` : "Plan: none");
  return `<app_state>\n${lines.join("\n")}\n</app_state>`;
}
