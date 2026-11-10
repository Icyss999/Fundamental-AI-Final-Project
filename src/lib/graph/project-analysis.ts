import { degrees, findCycles, findGodFiles, type Degree, type GodFile } from "./analysis";
import {
  architectureSummary,
  coreFiles,
  entryPoints,
  filterGraph,
  moduleStats,
  type ModuleStat,
} from "./insights";
import { autoFolderPartition, moduleGraph, modulesOf, type ModuleEdge } from "./partition";
import type { DepGraph, FileRole, Partition } from "./types";

/** Everything the Overview and Diagram derive from one import graph. */
export interface ProjectAnalysis {
  /** The graph actually analysed (source files only, unless tests/config are included). */
  graph: DepGraph;
  partition: Partition;
  labels: Record<string, string>;
  /** Folder shared by every file, e.g. "src". */
  prefix: string;
  modules: Map<string, string[]>;
  moduleEdges: ModuleEdge[];
  internalImports: Map<string, number>;
  degree: Map<string, Degree>;
  cycles: string[][];
  godFiles: GodFile[];
  godSet: Set<string>;
  stats: ModuleStat[];
  entryPoints: { id: string; fanOut: number }[];
  coreFiles: { id: string; fanIn: number }[];
  summary: string[];
  totalLoc: number;
}

const SOURCE_ONLY: ReadonlySet<FileRole> = new Set(["source"]);
const ALL_ROLES: ReadonlySet<FileRole> = new Set(["source", "test", "story", "example", "config", "declaration"]);

export function analyzeProject(full: DepGraph, name: string, includeAll: boolean): ProjectAnalysis {
  const graph = filterGraph(full, includeAll ? ALL_ROLES : SOURCE_ONLY);
  const { partition, labels, prefix } = autoFolderPartition(graph);
  const modules = modulesOf(partition);
  const { edges: moduleEdges, internal } = moduleGraph(graph, partition);
  const degree = degrees(graph);
  const cycles = findCycles(graph);
  const godFiles = findGodFiles(graph);
  const stats = moduleStats(graph, modules, moduleEdges);
  return {
    graph,
    partition,
    labels,
    prefix,
    modules,
    moduleEdges,
    internalImports: internal,
    degree,
    cycles,
    godFiles,
    godSet: new Set(godFiles.map((g) => g.id)),
    stats,
    entryPoints: entryPoints(degree),
    coreFiles: coreFiles(degree),
    summary: architectureSummary({ name, files: graph.nodes.length, stats, labels, cycles, godFiles }),
    totalLoc: graph.nodes.reduce((s, n) => s + n.loc, 0),
  };
}

/** How many files of each role the full graph has. */
export function roleCounts(full: DepGraph): Record<FileRole, number> {
  const counts: Record<FileRole, number> = { source: 0, test: 0, story: 0, example: 0, config: 0, declaration: 0 };
  for (const n of full.nodes) counts[n.role]++;
  return counts;
}
