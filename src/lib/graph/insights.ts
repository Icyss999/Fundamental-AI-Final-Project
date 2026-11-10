import type { Degree, GodFile } from "./analysis";
import type { ModuleEdge } from "./partition";
import type { DepGraph, FileRole } from "./types";

/** Sub-graph containing only files with the given roles (and imports between them). */
export function filterGraph(graph: DepGraph, roles: ReadonlySet<FileRole>): DepGraph {
  const nodes = graph.nodes.filter((n) => roles.has(n.role));
  const keep = new Set(nodes.map((n) => n.id));
  return { ...graph, nodes, edges: graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
}

export interface ModuleStat {
  id: string;
  files: number;
  loc: number;
  /** Other modules this one imports from. */
  dependsOn: number;
  /** Other modules that import from this one. */
  usedBy: number;
}

export function moduleStats(
  graph: DepGraph,
  modules: Map<string, string[]>,
  moduleEdges: ModuleEdge[],
): ModuleStat[] {
  const loc = new Map(graph.nodes.map((n) => [n.id, n.loc]));
  return [...modules.entries()]
    .map(([id, files]) => ({
      id,
      files: files.length,
      loc: files.reduce((sum, f) => sum + (loc.get(f) ?? 0), 0),
      dependsOn: moduleEdges.filter((e) => e.source === id).length,
      usedBy: moduleEdges.filter((e) => e.target === id).length,
    }))
    .sort((a, b) => b.loc - a.loc || a.id.localeCompare(b.id));
}

/** Files nothing imports but which import others: pages, CLIs, app entry points. */
export function entryPoints(degree: Map<string, Degree>, limit = 6): { id: string; fanOut: number }[] {
  return [...degree.entries()]
    .filter(([, d]) => d.fanIn === 0 && d.fanOut > 0)
    .map(([id, d]) => ({ id, fanOut: d.fanOut }))
    .sort((a, b) => b.fanOut - a.fanOut || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/** The most imported files: the foundations everything else leans on. */
export function coreFiles(degree: Map<string, Degree>, limit = 6): { id: string; fanIn: number }[] {
  return [...degree.entries()]
    .filter(([, d]) => d.fanIn > 0)
    .map(([id, d]) => ({ id, fanIn: d.fanIn }))
    .sort((a, b) => b.fanIn - a.fanIn || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/** A few plain-language sentences describing the shape of the code. */
export function architectureSummary(input: {
  name: string;
  files: number;
  stats: ModuleStat[];
  labels: Record<string, string>;
  cycles: string[][];
  godFiles: GodFile[];
}): string[] {
  const { name, files, stats, labels, cycles, godFiles } = input;
  if (files === 0) return [`No JavaScript or TypeScript source files were found in ${name}.`];
  const label = (m: string) => labels[m] ?? m;
  const totalLoc = stats.reduce((s, m) => s + m.loc, 0);
  const sentences = [
    `${name} has ${files} source ${files === 1 ? "file" : "files"} organised into ${stats.length} ${stats.length === 1 ? "module" : "modules"}.`,
  ];

  const largest = stats[0];
  if (largest && stats.length > 1 && totalLoc > 0) {
    sentences.push(`The largest module is ${label(largest.id)}, holding ${Math.round((largest.loc / totalLoc) * 100)}% of the code.`);
  }
  const mostUsed = [...stats].sort((a, b) => b.usedBy - a.usedBy)[0];
  if (mostUsed && mostUsed.usedBy > 1) {
    sentences.push(`${label(mostUsed.id)} is the most shared module: ${mostUsed.usedBy} other modules depend on it.`);
  }

  if (cycles.length === 0) sentences.push("There are no import cycles.");
  else sentences.push(`${cycles.length} import ${cycles.length === 1 ? "cycle ties" : "cycles tie"} files together so they cannot change independently.`);
  if (godFiles.length > 0) {
    sentences.push(`${godFiles.length === 1 ? "One file is" : `${godFiles.length} files are`} depended on far more than the rest, so changes there ripple widely.`);
  }
  return sentences;
}
