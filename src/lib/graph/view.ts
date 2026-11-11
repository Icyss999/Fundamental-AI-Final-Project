import { modulesOf } from "./partition";
import { importKey, type DepGraph, type Partition } from "./types";

/**
 * What the diagram currently shows. Collapsed modules are single boxes; expanded
 * modules become a group box containing their files. File imports are re-routed to
 * whatever box currently represents each endpoint and merged into weighted edges.
 */
export interface ViewNode {
  id: string;
  kind: "module" | "group" | "file";
  label: string;
  module: string;
  /** File id, for kind === "file". */
  file?: string;
  /** Group node id, for files inside an expanded module. */
  parent?: string;
  fileCount: number;
  /** Non-blank lines in the file / module. */
  loc: number;
  /** Palette index: modules under the same top-level folder share a colour. */
  color: number;
  god: boolean;
  inCycle: boolean;
  /** AI architecture: what the module is for, and its tier (0 = top of the diagram). */
  description?: string;
  tier?: number;
}

export interface ViewEdge {
  id: string;
  source: string;
  target: string;
  /** Number of file-level imports merged into this edge. */
  weight: number;
  /** True if any merged import is part of an import cycle. */
  inCycle: boolean;
  /** True if every merged import is type-only. */
  typeOnly: boolean;
  /** The file-level imports merged into this edge (`importKey`s). */
  members: string[];
}

export const PALETTE_SIZE = 8;
export const moduleNodeId = (module: string) => `m:${module}`;
export const fileNodeId = (file: string) => `f:${file}`;

/** Colour index per module, keyed by the first segment of its label, in alphabetical order. */
export function moduleColors(modules: Iterable<string>, labels: Record<string, string>): Map<string, number> {
  const list = [...modules];
  const top = (m: string) => (labels[m] ?? m).split("/")[0];
  const families = [...new Set(list.map(top))].sort();
  return new Map(list.map((m) => [m, families.indexOf(top(m)) % PALETTE_SIZE]));
}

export function buildView(
  graph: DepGraph,
  partition: Partition,
  expanded: ReadonlySet<string>,
  cycles: string[][],
  godFiles: ReadonlySet<string>,
  labels: Record<string, string> = {},
  meta: { descriptions?: Record<string, string>; tiers?: Record<string, number> } = {},
): { nodes: ViewNode[]; edges: ViewEdge[] } {
  const cycleOf = new Map<string, number>();
  cycles.forEach((cycle, i) => cycle.forEach((f) => cycleOf.set(f, i)));
  const locOf = new Map(graph.nodes.map((n) => [n.id, n.loc]));
  const modules = modulesOf(partition);
  const colors = moduleColors(modules.keys(), labels);

  const nodes: ViewNode[] = [];
  for (const [module, files] of modules) {
    const base = {
      module,
      label: labels[module] ?? module,
      fileCount: files.length,
      loc: files.reduce((s, f) => s + (locOf.get(f) ?? 0), 0),
      color: colors.get(module) ?? 0,
      god: files.some((f) => godFiles.has(f)),
      inCycle: files.some((f) => cycleOf.has(f)),
      description: meta.descriptions?.[module],
      tier: meta.tiers?.[module],
    };
    if (!expanded.has(module)) {
      nodes.push({ id: moduleNodeId(module), kind: "module", ...base });
      continue;
    }
    // Parents must precede their children for React Flow.
    nodes.push({ id: moduleNodeId(module), kind: "group", ...base });
    const baseName = (f: string) => f.slice(f.lastIndexOf("/") + 1);
    const names = new Map<string, number>();
    for (const f of files) names.set(baseName(f), (names.get(baseName(f)) ?? 0) + 1);
    for (const file of files) {
      // Path inside the module, so lib/auth.ts and lib/validations/auth.ts stay distinguishable;
      // in a module that is not a folder, the name — with its folder when two files share it.
      const name = baseName(file);
      const label = file.startsWith(`${module}/`) ? file.slice(module.length + 1) : names.get(name)! > 1 ? file.split("/").slice(-2).join("/") : name;
      nodes.push({
        id: fileNodeId(file),
        kind: "file",
        label,
        module,
        file,
        parent: moduleNodeId(module),
        fileCount: 1,
        loc: locOf.get(file) ?? 0,
        color: base.color,
        god: godFiles.has(file),
        inCycle: cycleOf.has(file),
      });
    }
  }

  const visibleId = (file: string) =>
    expanded.has(partition[file]) ? fileNodeId(file) : moduleNodeId(partition[file]);

  const edges = new Map<string, ViewEdge>();
  for (const e of graph.edges) {
    const source = visibleId(e.source);
    const target = visibleId(e.target);
    if (source === target) continue; // import inside a collapsed module
    const inCycle = cycleOf.has(e.source) && cycleOf.get(e.source) === cycleOf.get(e.target);
    const id = `${source}->${target}`;
    const existing = edges.get(id);
    const member = importKey(e.source, e.target);
    if (existing) {
      existing.weight++;
      existing.inCycle ||= inCycle;
      existing.typeOnly &&= e.typeOnly;
      existing.members.push(member);
    } else {
      edges.set(id, { id, source, target, weight: 1, inCycle, typeOnly: e.typeOnly, members: [member] });
    }
  }

  return { nodes, edges: [...edges.values()] };
}
