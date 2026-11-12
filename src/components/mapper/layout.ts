import ELK, { type ElkExtendedEdge, type ElkNode, type LayoutOptions } from "elkjs/lib/elk.bundled.js";
import type { ViewEdge, ViewNode } from "@/lib/graph/view";

const elk = new ELK();

export const FILE_HEIGHT = 38;
/** Room for the shapes: a cylinder's lid and a window's title bar sit above the label. */
export const MODULE_HEIGHT = 92;
export const GROUP_HEADER = 44;
/** A collapsed shelf, and an opened shelf's header. */
export const SHELF_HEIGHT = 92;
const SHELF_HEADER = 56;
const SHELF_GAP = 18;
const FILE_GAP = 12;

export interface Box {
  /** Position relative to the parent group (or the canvas for top-level nodes). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Layout {
  boxes: Map<string, Box>;
  /** Absolute canvas position of every node as ELK placed it. */
  absolute: Map<string, Point>;
  /** Orthogonal route per edge id, in absolute canvas coordinates. */
  routes: Map<string, Point[]>;
}

/** What the organiser decided (see lib/graph/organize): shelves in order, pairs to keep side by side, rows. */
export interface LayoutPlan {
  shelves: readonly string[];
  pairs: readonly (readonly [string, string])[];
  /** Row per module, top first; without it the AI's tiers (if any) set the bands. */
  rows?: ReadonlyMap<string, number>;
  /**
   * Where each module's box sits on the map with every part closed. Given, the parts keep that order in
   * their rows when some are opened (ELK's semi-interactive crossing minimisation reads it), so opening a
   * part never reshuffles the map.
   */
  closed?: ReadonlyMap<string, Point>;
}

const ROOT_OPTIONS: LayoutOptions = {
  "elk.algorithm": "layered",
  // Imports point downwards: what people see near the top, what everything shares near the bottom.
  "elk.direction": "DOWN",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.edgeRouting": "ORTHOGONAL",
  // Return edge bend points in absolute coordinates, whatever group the edge lives in.
  "elk.json.edgeCoords": "ROOT",
  // One graph, not one per connected part: otherwise parts without arrows are packed into one long row.
  "elk.separateConnectedComponents": "false",
  "elk.spacing.nodeNode": "48",
  "elk.layered.spacing.nodeNodeBetweenLayers": "72",
  "elk.spacing.edgeNode": "24",
  "elk.spacing.edgeEdge": "14",
  "elk.layered.spacing.edgeNodeBetweenLayers": "24",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "14",
  // Boxes line up in columns and arrows run straight down (Brandes–Köpf staggered the rows into a staircase).
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.layered.thoroughness": "24",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  // Edges out of one box share a trunk and branch, instead of fanning out as separate lines.
  "elk.layered.mergeEdges": "true",
};

function widthFor(text: string, charPx: number, padding: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, text.length * charPx + padding)));
}

export function formatLoc(loc: number): string {
  return loc >= 1000 ? `${(loc / 1000).toFixed(loc >= 10_000 ? 0 : 1)}k` : String(loc);
}

export function nodeSize(node: ViewNode): { width: number; height: number } {
  // Leave room for the "loop" / "busy" badges next to the label.
  const badges = (node.inCycle ? 52 : 0) + (node.god ? 52 : 0);
  if (node.kind === "file") {
    // +24 leaves room for the "view on GitHub" icon that appears on hover.
    return { width: widthFor(node.label, 7.8, 104 + badges, 172, 360), height: FILE_HEIGHT };
  }
  // Label first; the purpose line is clipped to the box. Shapes need extra room at the sides (hexagon points).
  return { width: widthFor(node.label, 9, 84 + badges, 220, 340), height: MODULE_HEIGHT };
}

/** Wide enough for the group header: dot, label, "N files · X lines" and the Collapse button. */
function groupMinWidth(node: ViewNode): number {
  const stats = `${node.fileCount} files · ${formatLoc(node.loc)} lines`;
  return Math.round(Math.min(600, 32 + node.label.length * 8.2 + 12 + stats.length * 6.6 + 132));
}

/**
 * Invisible edges that wrap a wide row of files into a grid: within a group, files in the same
 * dependency level are chained in steps of `columns`, so ELK stacks them into rows instead of
 * laying 20 helpers out in one line.
 */
export function wrapEdges(children: readonly string[], internal: readonly [string, string][], columns: number): [string, string][] {
  const set = new Set(children);
  const level = new Map<string, number>();
  const into = new Map<string, string[]>();
  for (const [a, b] of internal) if (set.has(a) && set.has(b) && a !== b) into.set(b, [...(into.get(b) ?? []), a]);
  // Longest path from the group's sources (cycles cut by a visiting mark).
  const visiting = new Set<string>();
  const depth = (n: string): number => {
    if (level.has(n)) return level.get(n)!;
    if (visiting.has(n)) return 0;
    visiting.add(n);
    const d = Math.max(0, ...(into.get(n) ?? []).map((p) => depth(p) + 1));
    visiting.delete(n);
    level.set(n, d);
    return d;
  };
  const byLevel = new Map<number, string[]>();
  for (const c of children) byLevel.set(depth(c), [...(byLevel.get(depth(c)) ?? []), c]);
  const wraps: [string, string][] = [];
  for (const row of byLevel.values()) {
    if (row.length <= columns) continue;
    const sorted = [...row].sort();
    for (let i = 0; i + columns < sorted.length; i++) wraps.push([sorted[i], sorted[i + columns]]);
  }
  return wraps;
}

/**
 * Computes positions for every view node, and routes for every edge, with ELK's layered algorithm,
 * organised by `plan`: each module sits in its row (ELK partitions), shelf modules leave the layered
 * graph and sit as full-width bars below it, and each pair of modules that import each other is kept
 * side by side (their mutual edges are drawn as one loop arrow by the caller, so they are not routed).
 * Minor edges are drawn only on focus, on a path of their own, so they are not routed either.
 */
export async function layoutView(nodes: ViewNode[], edges: ViewEdge[], plan: LayoutPlan = { shelves: [], pairs: [] }): Promise<Layout> {
  const shelfSet = new Set(plan.shelves);
  const onShelf = (n: ViewNode) => shelfSet.has(n.module);
  const mapNodes = nodes.filter((n) => !onShelf(n));
  const shelfNodes = nodes.filter(onShelf);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // One width per row of boxes: collapsed modules share a width, files share one per group.
  const moduleWidth = Math.min(320, Math.max(200, ...mapNodes.filter((n) => n.kind === "module").map((n) => nodeSize(n).width)));
  const fileWidth = new Map<string, number>();
  for (const n of nodes) {
    if (n.kind === "file" && n.parent) fileWidth.set(n.parent, Math.max(fileWidth.get(n.parent) ?? 0, nodeSize(n).width));
  }
  const sizeOf = (n: ViewNode) =>
    n.kind === "module" ? { width: moduleWidth, height: MODULE_HEIGHT } : n.kind === "file" && n.parent ? { width: fileWidth.get(n.parent)!, height: FILE_HEIGHT } : nodeSize(n);

  const children = new Map<string, ElkNode[]>();
  for (const n of mapNodes) {
    if (n.parent) children.set(n.parent, [...(children.get(n.parent) ?? []), { id: n.id, ...sizeOf(n) }]);
  }
  // A closed part's arrows: one out-port under it (its arrows branch from one connector) and one in-port
  // per arrow on top, so where lines meet it is always one part branching, never two parts merging.
  const routed = edges.filter((e) => !e.minor && !onShelf(byId.get(e.source)!) && !onShelf(byId.get(e.target)!));
  const ported = (id: string) => byId.get(id)?.kind === "module";
  const ports = new Map<string, NonNullable<ElkNode["ports"]>>();
  const addPort = (node: string, id: string, side: "NORTH" | "SOUTH") => {
    const list = ports.get(node) ?? [];
    if (!list.some((p) => p.id === id)) list.push({ id, width: 1, height: 1, layoutOptions: { "elk.port.side": side } });
    ports.set(node, list);
  };
  const outPort = (id: string) => `${id}:out`;
  const inPort = (edge: string, id: string) => `${id}:in:${edge}`;
  for (const e of routed) {
    if (ported(e.source)) addPort(e.source, outPort(e.source), "SOUTH");
    if (ported(e.target)) addPort(e.target, inPort(e.id, e.target), "NORTH");
  }
  // The closed map's spot of a top-level box, as an order hint (`plan.closed`).
  const hint = (n: ViewNode): LayoutOptions => {
    const at = !n.parent ? plan.closed?.get(n.module) : undefined;
    return at ? { "elk.position": `(${at.x},${at.y})` } : {};
  };
  const elkNodeFor = (n: ViewNode): ElkNode => {
    if (n.kind === "module" && ports.has(n.id)) return { id: n.id, ...sizeOf(n), ports: ports.get(n.id), layoutOptions: { "elk.portConstraints": "FIXED_SIDE", ...hint(n) } };
    if (n.kind !== "group") return { id: n.id, ...sizeOf(n), layoutOptions: hint(n) };
    return {
      id: n.id,
      layoutOptions: {
        ...hint(n),
        "elk.padding": `[top=${GROUP_HEADER + 18},left=22,bottom=22,right=22]`,
        "elk.spacing.nodeNode": "14",
        "elk.layered.spacing.nodeNodeBetweenLayers": "34",
        "elk.nodeSize.constraints": "MINIMUM_SIZE",
        // ELK swaps width/height of a compound node's minimum size when direction is DOWN
        // (verified with elkjs 0.12), so the pair is given as (height, width).
        "elk.nodeSize.minimum": `(${GROUP_HEADER + 60},${groupMinWidth(n)})`,
      },
      children: children.get(n.id) ?? [],
    };
  };

  // Pairs that import each other: an invisible container keeps them in one row, side by side.
  const pairOf = new Map<string, string>();
  const pairNodes: ElkNode[] = [];
  for (const [a, b] of plan.pairs) {
    const na = byId.get(`m:${a}`);
    const nb = byId.get(`m:${b}`);
    if (!na || !nb || onShelf(na) || onShelf(nb)) continue;
    const id = `pair:${a}|${b}`;
    pairOf.set(na.id, id).set(nb.id, id);
    const at = [plan.closed?.get(a), plan.closed?.get(b)].filter((p) => !!p).sort((p, q) => p.x - q.x)[0];
    pairNodes.push({
      id,
      layoutOptions: {
        "elk.padding": "[top=0,left=0,bottom=0,right=0]",
        "elk.spacing.nodeNode": "104",
        ...(at ? { "elk.position": `(${at.x},${at.y})`, "elk.layered.crossingMinimization.semiInteractive": "true" } : {}),
      },
      children: [elkNodeFor(na), elkNodeFor(nb)],
    });
  }
  const pairModules = new Set(plan.pairs.flatMap(([a, b]) => [`${a}\0${b}`, `${b}\0${a}`]));

  const mapIds = new Set(mapNodes.map((n) => n.id));
  const elkEdges: ElkExtendedEdge[] = edges
    // Minor connections are drawn only on focus, on a simple path; they must not bend the main ones.
    .filter((e) => !e.minor && mapIds.has(e.source) && mapIds.has(e.target))
    .filter((e) => !pairModules.has(`${byId.get(e.source)!.module}\0${byId.get(e.target)!.module}`))
    .map((e) => ({ id: e.id, sources: [ported(e.source) ? outPort(e.source) : e.source], targets: [ported(e.target) ? inPort(e.id, e.target) : e.target] }));
  // Wrap wide rows of files inside opened modules into a grid.
  for (const g of mapNodes.filter((n) => n.kind === "group")) {
    const kids = mapNodes.filter((n) => n.parent === g.id).map((n) => n.id);
    const internal = edges.filter((e) => byId.get(e.source)?.parent === g.id && byId.get(e.target)?.parent === g.id).map((e) => [e.source, e.target] as [string, string]);
    const columns = Math.max(3, Math.ceil(Math.sqrt(kids.length * 1.5)));
    wrapEdges(kids, internal, columns).forEach(([a, b], i) => elkEdges.push({ id: `wrap:${g.id}:${i}`, sources: [a], targets: [b] }));
  }

  const graph: ElkNode = {
    id: "root",
    layoutOptions: plan.closed ? { ...ROOT_OPTIONS, "elk.layered.crossingMinimization.semiInteractive": "true" } : ROOT_OPTIONS,
    children: [...mapNodes.filter((n) => !n.parent && !pairOf.has(n.id)).map(elkNodeFor), ...pairNodes],
    edges: elkEdges,
  };

  // Each module's row (else the AI's tier) fixes its band, top to bottom (ELK partitioning).
  const bandOf = (n: ViewNode) => plan.rows?.get(n.module) ?? n.tier;
  if (mapNodes.some((n) => !n.parent && bandOf(n) !== undefined)) {
    graph.layoutOptions = { ...graph.layoutOptions, "elk.partitioning.activate": "true" };
    for (const child of graph.children!) {
      const members = child.id.startsWith("pair:") ? child.children!.map((c) => byId.get(c.id)!) : [byId.get(child.id)!];
      const band = Math.min(...members.map((m) => bandOf(m) ?? 0));
      child.layoutOptions = { ...child.layoutOptions, "elk.partitioning.partition": String(band) };
    }
  }

  const result = mapNodes.length > 0 ? await elk.layout(graph) : { id: "root", children: [] };
  const boxes = new Map<string, Box>();
  const absolute = new Map<string, Point>();
  const visit = (node: ElkNode, origin: Point) => {
    for (const child of node.children ?? []) {
      const box = { x: child.x ?? 0, y: child.y ?? 0, width: child.width ?? 0, height: child.height ?? 0 };
      const abs = { x: origin.x + box.x, y: origin.y + box.y };
      if (child.id.startsWith("pair:")) {
        // The container is not drawn: its modules are top-level nodes at absolute positions.
        visit(child, abs);
        continue;
      }
      const parent = node.id.startsWith("pair:") ? { ...box, x: abs.x, y: abs.y } : box;
      boxes.set(child.id, parent);
      absolute.set(child.id, abs);
      visit(child, abs);
    }
  };
  visit(result, { x: 0, y: 0 });

  const routes = new Map<string, Point[]>();
  const collect = (node: ElkNode) => {
    for (const e of node.edges ?? []) {
      if (e.id.startsWith("wrap:")) continue;
      const sec = e.sections?.[0];
      if (sec) routes.set(e.id, [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint]);
    }
    node.children?.forEach(collect);
  };
  collect(result);

  // Shelves: full-width bars under the map, in the organiser's order.
  const top = mapNodes.filter((n) => !n.parent).map((n) => ({ ...boxes.get(n.id)!, ...absolute.get(n.id)! }));
  const minX = top.length ? Math.min(...top.map((b) => b.x)) : 0;
  const maxX = top.length ? Math.max(...top.map((b) => b.x + b.width)) : 760;
  let y = top.length ? Math.max(...top.map((b) => b.y + b.height)) + 72 : 0;
  const width = Math.max(maxX - minX, 680);
  for (const shelfModule of plan.shelves) {
    const shelf = shelfNodes.find((n) => n.module === shelfModule && !n.parent);
    if (!shelf) continue;
    let height = SHELF_HEIGHT;
    if (shelf.kind === "group") {
      const files = shelfNodes.filter((n) => n.parent === shelf.id).sort((a, b) => a.label.localeCompare(b.label));
      const fw = Math.max(172, ...files.map((f) => nodeSize(f).width));
      const columns = Math.max(1, Math.floor((width - 44 + FILE_GAP) / (fw + FILE_GAP)));
      files.forEach((f, i) => {
        const box = { x: 22 + (i % columns) * (fw + FILE_GAP), y: SHELF_HEADER + Math.floor(i / columns) * (FILE_HEIGHT + FILE_GAP), width: fw, height: FILE_HEIGHT };
        boxes.set(f.id, box);
        absolute.set(f.id, { x: minX + box.x, y: y + box.y });
      });
      const rows = Math.ceil(files.length / columns);
      height = SHELF_HEADER + rows * FILE_HEIGHT + Math.max(0, rows - 1) * FILE_GAP + 22;
    }
    boxes.set(shelf.id, { x: minX, y, width, height });
    absolute.set(shelf.id, { x: minX, y });
    y += height + SHELF_GAP;
  }

  return { boxes, absolute, routes };
}
