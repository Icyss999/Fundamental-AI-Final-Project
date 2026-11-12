import { mainLinks } from "./organize";
import { modulesOf } from "./partition";
import type { ModuleKind } from "./kinds";
import { importKey, type DepGraph, type Partition } from "./types";

/**
 * What the diagram currently shows. Collapsed modules are single boxes; expanded
 * modules become a group box containing their files. Imports between two modules merge into
 * one weighted module-level edge whether the modules are open or not (so opening a part keeps
 * the map's arrows); imports between files of one open module are file-level edges, of which
 * the ones told by a detour through other files (`mainLinks`) are `detail`; and a file's own
 * imports across modules, when one end is open, are `detail` edges too.
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
  /** What kind of part the module is (lib/graph/kinds): its shape on the map. */
  part?: ModuleKind;
  /** On a shelf: a module most others use, drawn as a full-width bar under the map. */
  shelf?: boolean;
  /** The shelves this module uses, drawn as coloured markers instead of arrows. */
  uses?: { label: string; color: number }[];
  /** A shelf's users, as labels ("Used by pages and services"). */
  usedBy?: string[];
  /** A collapsed shelf's file names, to list on the bar. */
  files?: string[];
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
  /** Points at a shelf: drawn only when one of its ends is in focus. */
  toShelf?: boolean;
  /** Between the two modules of a loop pair: drawn as one two-way loop arrow. */
  pair?: boolean;
  /** Told by the map another way (lib/graph/organize `mainLinks`): drawn only when one of its ends is in focus. */
  minor?: boolean;
  /**
   * Told another way inside an opened part: a file's own imports across modules (the module-level edge tells
   * them), or an import between two of its files that a detour through its other files tells. Also `minor`;
   * drawn only while one of its own two boxes is in focus (not just its part).
   */
  detail?: boolean;
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
  meta: {
    descriptions?: Record<string, string>;
    tiers?: Record<string, number>;
    kinds?: Record<string, ModuleKind>;
    /** The organiser's decisions (lib/graph/organize). */
    organization?: {
      shelves: readonly string[];
      pairs: readonly (readonly [string, string])[];
      uses: ReadonlyMap<string, string[]>;
      usedBy: ReadonlyMap<string, string[]>;
      minor?: ReadonlySet<string>;
    };
  } = {},
): { nodes: ViewNode[]; edges: ViewEdge[] } {
  const org = meta.organization;
  const shelves = new Set(org?.shelves ?? []);
  const pairKey = new Set((org?.pairs ?? []).flatMap(([a, b]) => [`${a}\0${b}`, `${b}\0${a}`]));
  const label = (m: string) => labels[m] ?? m;
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
      part: meta.kinds?.[module],
      ...(shelves.has(module)
        ? { shelf: true, usedBy: (org?.usedBy.get(module) ?? []).map(label), files: files.map((f) => f.slice(f.lastIndexOf("/") + 1)) }
        : { uses: (org?.uses.get(module) ?? []).map((s) => ({ label: label(s), color: colors.get(s) ?? 0 })) }),
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
        ...(shelves.has(module) ? { shelf: true } : {}),
      });
    }
  }

  const visibleId = (file: string) =>
    expanded.has(partition[file]) ? fileNodeId(file) : moduleNodeId(partition[file]);

  const edges = new Map<string, ViewEdge>();
  const add = (source: string, target: string, e: DepGraph["edges"][number], flags: Partial<ViewEdge>) => {
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
      edges.set(id, { id, source, target, weight: 1, inCycle, typeOnly: e.typeOnly, members: [member], ...flags });
    }
  };
  for (const e of graph.edges) {
    const a = partition[e.source];
    const b = partition[e.target];
    if (a === b) {
      if (expanded.has(a)) add(fileNodeId(e.source), fileNodeId(e.target), e, {});
      continue; // otherwise: an import inside a closed module
    }
    add(moduleNodeId(a), moduleNodeId(b), e, {
      ...(shelves.has(b) ? { toShelf: true } : {}),
      ...(pairKey.has(`${a}\0${b}`) ? { pair: true } : {}),
      ...(org?.minor?.has(`${a}\0${b}`) ? { minor: true } : {}),
    });
    if (expanded.has(a) || expanded.has(b)) add(visibleId(e.source), visibleId(e.target), e, { minor: true, detail: true });
  }

  // Inside an opened part, an import the files already tell through each other waits for focus too.
  const inside = [...edges.values()].filter((e) => !e.detail && e.source.startsWith("f:") && e.target.startsWith("f:"));
  const told = mainLinks(inside);
  for (const e of inside) if (told.has(`${e.source}\0${e.target}`)) Object.assign(e, { minor: true, detail: true });

  return { nodes, edges: [...edges.values()] };
}
