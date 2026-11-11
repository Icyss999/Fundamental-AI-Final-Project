import ELK, { type ElkNode, type LayoutOptions } from "elkjs/lib/elk.bundled.js";
import type { ViewEdge, ViewNode } from "@/lib/graph/view";

const elk = new ELK();

export const FILE_HEIGHT = 36;
export const MODULE_HEIGHT = 64;
export const GROUP_HEADER = 40;

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

const ROOT_OPTIONS: LayoutOptions = {
  "elk.algorithm": "layered",
  // Imports point downwards: pages near the top, data and utilities near the bottom.
  "elk.direction": "DOWN",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.edgeRouting": "ORTHOGONAL",
  // Return edge bend points in absolute coordinates, whatever group the edge lives in.
  "elk.json.edgeCoords": "ROOT",
  "elk.spacing.nodeNode": "36",
  "elk.layered.spacing.nodeNodeBetweenLayers": "64",
  "elk.spacing.edgeNode": "20",
  "elk.spacing.edgeEdge": "12",
  "elk.layered.spacing.edgeNodeBetweenLayers": "20",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  // Edges into the same box share one entry point instead of fanning in as a comb.
  "elk.layered.mergeEdges": "true",
};

function widthFor(text: string, charPx: number, padding: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, text.length * charPx + padding)));
}

export function formatLoc(loc: number): string {
  return loc >= 1000 ? `${(loc / 1000).toFixed(loc >= 10_000 ? 0 : 1)}k` : String(loc);
}

export function nodeSize(node: ViewNode): { width: number; height: number } {
  // Leave room for the "cycle" / "god" badges next to the label.
  const badges = (node.inCycle ? 46 : 0) + (node.god ? 38 : 0);
  if (node.kind === "file") {
    // +24 leaves room for the "view on GitHub" icon that appears on hover.
    return { width: widthFor(node.label, 7.6, 108 + badges, 170, 380), height: FILE_HEIGHT };
  }
  const subtitle = `${node.fileCount} files · ${formatLoc(node.loc)} lines`;
  return {
    width: Math.max(widthFor(node.label, 7.8, 56 + badges, 190, 380), widthFor(subtitle, 6.6, 56, 190, 380)),
    height: MODULE_HEIGHT,
  };
}

/** Wide enough for the group header: dot, label, "N files · X lines" and the Collapse button. */
function groupMinWidth(node: ViewNode): number {
  const stats = `${node.fileCount} files · ${formatLoc(node.loc)} lines`;
  return Math.round(Math.min(580, 28 + node.label.length * 7.6 + 12 + stats.length * 6.2 + 128));
}

/** Computes positions for every view node, and routes for every edge, with ELK's layered algorithm. */
export async function layoutView(nodes: ViewNode[], edges: ViewEdge[]): Promise<Layout> {
  const children = new Map<string, ElkNode[]>();
  for (const n of nodes) {
    if (n.parent) {
      const list = children.get(n.parent) ?? [];
      list.push({ id: n.id, ...nodeSize(n) });
      children.set(n.parent, list);
    }
  }

  // AI architecture: each module's tier fixes its band, top to bottom (ELK partitioning).
  const tiered = nodes.some((n) => !n.parent && n.tier !== undefined);
  const tier = (n: ViewNode): LayoutOptions => (tiered ? { "elk.partitioning.partition": String(n.tier ?? 0) } : {});

  const graph: ElkNode = {
    id: "root",
    layoutOptions: tiered ? { ...ROOT_OPTIONS, "elk.partitioning.activate": "true" } : ROOT_OPTIONS,
    children: nodes
      .filter((n) => !n.parent)
      .map((n): ElkNode => {
        if (n.kind !== "group") return { id: n.id, ...nodeSize(n), layoutOptions: tier(n) };
        return {
          id: n.id,
          layoutOptions: {
            ...tier(n),
            "elk.padding": `[top=${GROUP_HEADER + 16},left=20,bottom=20,right=20]`,
            "elk.nodeSize.constraints": "MINIMUM_SIZE",
            // ELK swaps width/height of a compound node's minimum size when direction is DOWN
            // (verified with elkjs 0.12), so the pair is given as (height, width).
            "elk.nodeSize.minimum": `(${GROUP_HEADER + 56},${groupMinWidth(n)})`,
          },
          children: children.get(n.id) ?? [],
        };
      }),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  const result = await elk.layout(graph);
  const boxes = new Map<string, Box>();
  const absolute = new Map<string, Point>();
  const visit = (node: ElkNode, origin: Point) => {
    for (const child of node.children ?? []) {
      const box = { x: child.x ?? 0, y: child.y ?? 0, width: child.width ?? 0, height: child.height ?? 0 };
      boxes.set(child.id, box);
      const abs = { x: origin.x + box.x, y: origin.y + box.y };
      absolute.set(child.id, abs);
      visit(child, abs);
    }
  };
  visit(result, { x: 0, y: 0 });

  const routes = new Map<string, Point[]>();
  const collect = (node: ElkNode) => {
    for (const e of node.edges ?? []) {
      const s = e.sections?.[0];
      if (s) routes.set(e.id, [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]);
    }
    node.children?.forEach(collect);
  };
  collect(result);

  return { boxes, absolute, routes };
}

// ---------------------------------------------------------------------------------------------
// Keeping user-dragged positions across re-layouts

const GROUP_PADDING = 20;
const GAP = 28;

interface Placed {
  id: string;
  parentId?: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
}

function overlaps(a: Placed, b: Placed): boolean {
  return (
    a.position.x < b.position.x + (b.width ?? 0) + GAP &&
    b.position.x < a.position.x + (a.width ?? 0) + GAP &&
    a.position.y < b.position.y + (b.height ?? 0) + GAP &&
    b.position.y < a.position.y + (a.height ?? 0) + GAP
  );
}

/**
 * Pushes auto-placed siblings to the right until they clear every pinned sibling and every
 * sibling already settled. Moving only sideways keeps each node in its ELK layer, so imports
 * still read top-to-bottom. Each push strictly increases x, so this terminates.
 */
function separate(siblings: Placed[], isPinned: (n: Placed) => boolean): void {
  const settled = siblings.filter(isPinned);
  const free = siblings
    .filter((n) => !isPinned(n))
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  for (const n of free) {
    for (let moved = true; moved; ) {
      moved = false;
      for (const s of settled) {
        if (overlaps(n, s)) {
          n.position = { x: s.position.x + (s.width ?? 0) + GAP, y: n.position.y };
          moved = true;
        }
      }
    }
    settled.push(n);
  }
}

/**
 * Merges the user's dragged positions into a fresh auto-layout:
 * 1. pinned nodes go back where the user left them;
 * 2. auto-placed nodes that now collide with them are pushed clear (inside each group, then at top level);
 * 3. groups grow so all their children fit (ELK sized them without knowing about the pins).
 * Child positions are relative to their group, exactly as React Flow reports them while dragging.
 */
export function applyPins<T extends Placed>(nodes: T[], pins: ReadonlyMap<string, { x: number; y: number }>): T[] {
  if (pins.size === 0) return nodes;
  const placed = nodes.map((n) => ({ ...n, position: pins.get(n.id) ?? n.position }));
  const isPinned = (n: Placed) => pins.has(n.id);

  const childrenOf = new Map<string, T[]>();
  for (const n of placed) {
    if (n.parentId) childrenOf.set(n.parentId, [...(childrenOf.get(n.parentId) ?? []), n]);
  }
  const byId = new Map(placed.map((n) => [n.id, n]));
  for (const [parentId, kids] of childrenOf) {
    separate(kids, isPinned);
    const parent = byId.get(parentId);
    if (!parent) continue;
    for (const child of kids) {
      parent.width = Math.max(parent.width ?? 0, child.position.x + (child.width ?? 0) + GROUP_PADDING);
      parent.height = Math.max(parent.height ?? 0, child.position.y + (child.height ?? 0) + GROUP_PADDING);
    }
  }
  separate(placed.filter((n) => !n.parentId), isPinned);
  return placed;
}
