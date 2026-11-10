import type { DepGraph, Partition } from "./types";

export const ROOT_MODULE = "(root)";

/**
 * Baseline grouping: every file belongs to the module named after its directory.
 * This is the "folder structure" baseline that MQ-based clustering is evaluated against.
 */
export function folderPartition(graph: DepGraph): Partition {
  const partition: Partition = {};
  for (const n of graph.nodes) partition[n.id] = n.dir || ROOT_MODULE;
  return partition;
}

export interface FolderGrouping {
  partition: Partition;
  /** Short display name per module (path below the shared prefix). */
  labels: Record<string, string>;
  /** Folder path shared by every file (e.g. "src"), "" if none. */
  prefix: string;
  /** How many folder levels below the prefix define a module. */
  depth: number;
}

/**
 * Folder-structure grouping sized for reading: strips the folder prefix every file shares
 * (e.g. `src/`), then uses the deepest folder level that still yields at most `maxModules`
 * modules. Files sitting directly in the prefix folder form their own module.
 */
export function autoFolderPartition(graph: DepGraph, maxModules = 14): FolderGrouping {
  const dirs = graph.nodes.map((n) => (n.dir ? n.dir.split("/") : []));
  let prefixLength = dirs.length > 0 ? Math.min(...dirs.map((d) => d.length)) : 0;
  for (let i = 0; i < prefixLength; i++) {
    if (dirs.some((d) => d[i] !== dirs[0][i])) {
      prefixLength = i;
      break;
    }
  }
  const prefixParts = dirs[0]?.slice(0, prefixLength) ?? [];
  const prefix = prefixParts.join("/");
  const maxDepth = Math.max(0, ...dirs.map((d) => d.length - prefixLength));

  const groupAt = (depth: number): Partition => {
    const partition: Partition = {};
    graph.nodes.forEach((n, i) => {
      const parts = dirs[i].slice(0, prefixLength + depth);
      partition[n.id] = parts.length > 0 ? parts.join("/") : ROOT_MODULE;
    });
    return partition;
  };

  let depth = Math.min(1, maxDepth);
  for (let d = depth + 1; d <= maxDepth; d++) {
    if (new Set(Object.values(groupAt(d))).size > maxModules) break;
    depth = d;
  }

  const partition = groupAt(depth);
  const labels: Record<string, string> = {};
  for (const mod of new Set(Object.values(partition))) {
    const rel = mod === ROOT_MODULE ? "" : mod.split("/").slice(prefixLength).join("/");
    labels[mod] = rel || (prefix ? `${prefixParts[prefixParts.length - 1]} (top level)` : "(root)");
  }
  return { partition, labels, prefix, depth };
}

/** Module id -> the file ids it contains (sorted). */
export function modulesOf(partition: Partition): Map<string, string[]> {
  const modules = new Map<string, string[]>();
  for (const [file, mod] of Object.entries(partition)) {
    const files = modules.get(mod);
    if (files) files.push(file);
    else modules.set(mod, [file]);
  }
  for (const files of modules.values()) files.sort();
  return new Map([...modules.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export interface ModuleEdge {
  source: string;
  target: string;
  /** Number of file-level imports this module edge stands for. */
  weight: number;
}

/**
 * Collapses the file graph into a module graph. Imports inside one module are counted
 * separately as `internal[module]` (MQ needs both intra- and inter-module counts).
 */
export function moduleGraph(
  graph: DepGraph,
  partition: Partition,
): { edges: ModuleEdge[]; internal: Map<string, number> } {
  const external = new Map<string, ModuleEdge>();
  const internal = new Map<string, number>();
  for (const e of graph.edges) {
    const a = partition[e.source];
    const b = partition[e.target];
    if (a === b) {
      internal.set(a, (internal.get(a) ?? 0) + 1);
      continue;
    }
    const key = `${a}\0${b}`;
    const existing = external.get(key);
    if (existing) existing.weight++;
    else external.set(key, { source: a, target: b, weight: 1 });
  }
  return { edges: [...external.values()], internal };
}
