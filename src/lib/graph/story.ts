/**
 * The narration Kosmos tells about a codebase, in plain words, from the analysis alone: the story in
 * the narration box, and the tour that walks the map part by part (top row first, shelves last).
 * Pure and client-safe. Module names are returned as tokens so the UI can make them clickable.
 */

import type { Organization } from "./organize";
import type { ProjectAnalysis } from "./project-analysis";

/** A sentence: plain text with module names (by id) and file paths kept apart. */
export type Part = string | { module: string } | { file: string };
export type Sentence = Part[];

export interface TourStep {
  title: string;
  body: Sentence[];
  /** Modules the map shows while the rest fades. */
  focus: string[];
  /** Files to list under the step (a single module's files). */
  files?: { id: string; loc: number }[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "a", "a and b", "a, b and c" as parts. */
function list(items: Part[]): Part[] {
  if (items.length <= 1) return items;
  const out: Part[] = [];
  items.forEach((it, i) => {
    if (i > 0) out.push(i === items.length - 1 ? " and " : ", ");
    out.push(it);
  });
  return out;
}

/**
 * Rows of the map, top first: longest path from the parts nothing uses, over non-shelf modules,
 * with the two modules of a pair kept in the same row and loops cut.
 */
export function mapRows(analysis: ProjectAnalysis, org: Organization): string[][] {
  const shelves = new Set(org.shelves);
  const modules = [...analysis.modules.keys()].filter((m) => !shelves.has(m));
  const partner = new Map(org.pairs.flatMap(([a, b]) => [[a, b], [b, a]] as [string, string][]));
  const into = new Map<string, string[]>(modules.map((m) => [m, []]));
  for (const e of analysis.moduleEdges) {
    if (!into.has(e.source) || !into.has(e.target) || partner.get(e.source) === e.target) continue;
    into.get(e.target)!.push(e.source);
  }
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const level = (m: string): number => {
    if (depth.has(m)) return depth.get(m)!;
    if (visiting.has(m)) return 0;
    visiting.add(m);
    const d = Math.max(0, ...into.get(m)!.map((p) => level(p) + 1));
    visiting.delete(m);
    depth.set(m, d);
    return d;
  };
  for (const m of modules) level(m);
  // A pair sits in the deeper of its two rows.
  for (const [a, b] of org.pairs) {
    if (!depth.has(a) || !depth.has(b)) continue;
    const d = Math.max(depth.get(a)!, depth.get(b)!);
    depth.set(a, d).set(b, d);
  }
  const rows: string[][] = [];
  for (const [m, d] of depth) (rows[d] ??= []).push(m);
  return rows.filter(Boolean).map((r) => r.sort((x, y) => (analysis.labels[x] ?? x).localeCompare(analysis.labels[y] ?? y)));
}

/** Files of a module, largest first. */
function filesOf(analysis: ProjectAnalysis, module: string, max = 6): { id: string; loc: number }[] {
  const loc = new Map(analysis.graph.nodes.map((n) => [n.id, n.loc]));
  return (analysis.modules.get(module) ?? [])
    .map((id) => ({ id, loc: loc.get(id) ?? 0 }))
    .sort((a, b) => b.loc - a.loc || a.id.localeCompare(b.id))
    .slice(0, max);
}

function usersOf(analysis: ProjectAnalysis, module: string): string[] {
  return [...new Set(analysis.moduleEdges.filter((e) => e.target === module).map((e) => e.source))];
}

function usesOf(analysis: ProjectAnalysis, module: string, exclude: ReadonlySet<string> = new Set()): string[] {
  return [...new Set(analysis.moduleEdges.filter((e) => e.source === module && !exclude.has(e.target)).map((e) => e.target))];
}

/** The narration box: a few plain sentences on how the project fits together. */
export function projectStory(analysis: ProjectAnalysis, org: Organization): Sentence[] {
  const files = analysis.graph.nodes.length;
  const parts = analysis.modules.size;
  if (files === 0) return [["There are no source files to draw yet."]];
  const shelves = new Set(org.shelves);
  const rows = mapRows(analysis, org);
  const out: Sentence[] = [[`${plural(files, "file")} in ${plural(parts, "part")}.`]];
  const top = rows[0] ?? [];
  if (top.length > 0 && rows.length > 1) {
    const leans = [...new Set(top.flatMap((m) => usesOf(analysis, m, shelves)))].filter((m) => !top.includes(m)).slice(0, 3);
    out.push([
      ...list(top.slice(0, 3).map((m) => ({ module: m }))),
      top.length > 3 ? ` and ${top.length - 3} more` : "",
      top.length === 1 ? " sits at the top" : " sit at the top",
      ...(leans.length ? [" and lean", top.length === 1 ? "s" : "", " on ", ...list(leans.map((m) => ({ module: m })))] : []),
      ".",
    ]);
  }
  if (org.shelves.length > 0) {
    const s = org.shelves;
    const everyone = s.length === 1 && (org.usedBy.get(s[0])?.length ?? 0) >= parts - 1;
    out.push(
      everyone
        ? ["Everything shares the helpers in ", { module: s[0] }, ", on the shelf at the bottom."]
        : [...list(s.map((m) => ({ module: m }))), s.length === 1 ? " sits on the shelf at the bottom: most parts use it." : " sit on the shelves at the bottom: most parts use them."],
    );
  }
  const loop = org.pairs[0];
  if (loop) {
    out.push(["One thing to know: ", { module: loop[0] }, " and ", { module: loop[1] }, " need each other, so they sit side by side with a red two-way arrow."]);
  } else if (analysis.cycles.length > 0) {
    const c = analysis.cycles[0];
    out.push(["One thing to know: ", ...list(c.slice(0, 3).map((f) => ({ file: f }))), c.length > 3 ? ` and ${c.length - 3} more files` : "", " need each other (a loop)."]);
  }
  return out;
}

/** The tour: one step per row of the map, then the shelves, then anything to watch out for. */
export function buildTour(analysis: ProjectAnalysis, org: Organization): TourStep[] {
  const steps: TourStep[] = [];
  const shelves = new Set(org.shelves);
  const rows = mapRows(analysis, org);
  if (rows.length === 0 && org.shelves.length === 0) return steps;

  rows.slice(0, 4).forEach((row, i) => {
    const one = row.length === 1;
    const named = list(row.slice(0, 3).map((m) => ({ module: m })));
    if (i === 0) {
      const entry = analysis.entryPoints.filter((e) => row.includes(analysis.partition[e.id])).slice(0, 2);
      steps.push({
        title: one ? `Start here: ${analysis.labels[row[0]] ?? row[0]}.` : "Start here: the top row.",
        body: [
          [...named, row.length > 3 ? ` and ${row.length - 3} more` : "", one ? " is" : " are", " where the code starts: nothing else in the project uses ", one ? "it" : "them", "."],
          ...(entry.length ? [["Good files to open first: ", ...list(entry.map((e) => ({ file: e.id }))), "."] as Sentence] : []),
        ],
        focus: row,
        files: one ? filesOf(analysis, row[0]) : undefined,
      });
    } else {
      const users = [...new Set(row.flatMap((m) => usersOf(analysis, m)))].filter((m) => !row.includes(m) && !shelves.has(m)).slice(0, 3);
      steps.push({
        title: one ? `Next: ${analysis.labels[row[0]] ?? row[0]}.` : `Next: ${row.length} parts the row above uses.`,
        body: [
          [...named, row.length > 3 ? ` and ${row.length - 3} more` : "", one ? " is" : " are", " used by ", ...list(users.map((m) => ({ module: m }))), "."],
          ...(one ? [[`${plural(analysis.modules.get(row[0])?.length ?? 0, "file")} inside.`] as Sentence] : []),
        ],
        focus: row,
        files: one ? filesOf(analysis, row[0]) : undefined,
      });
    }
  });
  if (rows.length > 4) {
    const rest = rows.slice(4).flat();
    steps.push({ title: `And ${plural(rest.length, "more part")} further down.`, body: [["These sit lower on the map: ", ...list(rest.slice(0, 4).map((m) => ({ module: m }))), rest.length > 4 ? ` and ${rest.length - 4} more` : "", "."]], focus: rest });
  }

  if (org.shelves.length > 0) {
    const parts = analysis.modules.size;
    steps.push({
      title: org.shelves.length === 1 ? `Underneath: ${analysis.labels[org.shelves[0]] ?? org.shelves[0]}.` : "Underneath: the shelves.",
      body: [
        ...org.shelves.map((s): Sentence => [{ module: s }, ` is used by ${org.usedBy.get(s)?.length ?? 0} of the other ${parts - 1} parts.`]),
        ["Shared parts sit on shelves so the map doesn't fill with arrows. Click one to see who uses it."],
      ],
      focus: org.shelves,
      files: org.shelves.length === 1 ? filesOf(analysis, org.shelves[0]) : undefined,
    });
  }

  if (org.pairs.length > 0) {
    const [a, b] = org.pairs[0];
    steps.push({
      title: "Watch out: a loop.",
      body: [[{ module: a }, " and ", { module: b }, " import each other. A change to one can ripple into the other, so loops are worth untangling."], ["The Refactor mode can plan how to break it."]],
      focus: [a, b],
    });
  }

  steps.push({
    title: "That's the whole map.",
    body: [["Click any part to open it and see its files. Switch to Bug risk to see where a bug is most likely, or Refactor to plan a tidy-up."]],
    focus: [],
  });
  return steps;
}
