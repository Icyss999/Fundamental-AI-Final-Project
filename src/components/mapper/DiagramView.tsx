"use client";

import "@xyflow/react/dist/style.css";
import {
  MarkerType,
  Panel,
  ReactFlow,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type FitViewOptions,
  type NodeChange,
  type NodeMouseHandler,
} from "@xyflow/react";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore, type Ref } from "react";
import { Icon } from "@/components/app/ui";
import { findCycles } from "@/lib/graph/analysis";
import { organize } from "@/lib/graph/organize";
import { moduleGraph, modulesOf } from "@/lib/graph/partition";
import type { ProjectAnalysis } from "@/lib/graph/project-analysis";
import type { DepGraph, Partition } from "@/lib/graph/types";
import { KIND_INFO, MODULE_KINDS, type ModuleKind } from "@/lib/graph/kinds";
import { buildView, fileNodeId, moduleNodeId, type ViewEdge } from "@/lib/graph/view";
import { githubLink, githubModuleLink } from "@/lib/repo/links";
import type { ProjectSource } from "@/lib/repo/overview";
import { edgeTypes, type LoopEdgeType, type RoutedEdgeType } from "./edges";
import type { Selection } from "./Inspector";
import { layoutView, type Layout, type Point } from "./layout";
import { KindGlyph, nodeTypeFor, nodeTypes, type MapperNode } from "./nodes";
import { routeAround } from "./route";

/** The three layers share this one diagram; the mode picks what it shows. */
export type DiagramMode = "structure" | "risk" | "refactor";

/** Extra information painted onto the diagram by Layers 2 and 3 (never changes the layout). */
export interface DiagramOverlay {
  /** Bug probability per file; a collapsed module shows the sum over its files. */
  heat?: ReadonlyMap<string, number>;
  /** File-level imports (`importKey`) that break an architecture rule. */
  violations?: ReadonlySet<string>;
  /** Imports a plan has added so far. */
  added?: ReadonlySet<string>;
  /** Files a plan has moved so far. */
  moved?: ReadonlySet<string>;
  /** Files and imports the current plan step touches. */
  focusFiles?: ReadonlySet<string>;
  focusImports?: ReadonlySet<string>;
  /** Files the AI assistant pointed at (any mode). */
  marked?: ReadonlySet<string>;
  /** AI review findings per file (any mode). */
  findings?: ReadonlyMap<string, { count: number; severity: "high" | "medium" | "low" }>;
}

/** The grouping control: which modules the diagram shows (folders, MQ clusters, AI architecture). */
/** How the map groups files: by folder until the AI designs its parts, then only by the AI's parts. */
export interface GroupingControl {
  /** True once the map shows the parts the AI designed. */
  byAI: boolean;
  /** How cleanly the files split into the parts shown (MQ: higher is tidier). */
  mq: number;
}

/** What a side panel needs from the diagram: the selection and how to point at things. */
export interface SidebarContext {
  selection: Selection;
  clear: () => void;
  focusFile: (file: string) => void;
  focusModule: (module: string) => void;
}

export interface Inset {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface DiagramHandle {
  focusFile: (file: string) => void;
  focusModule: (module: string) => void;
  /** Opens these modules (used to follow a plan step). */
  expandModules: (modules: string[]) => void;
  /** Opens the modules of these files and frames them all. */
  frameFiles: (files: string[]) => void;
  clearSelection: () => void;
  /** Frames the whole map. */
  fitAll: () => void;
}

interface LaidOut {
  nodes: MapperNode[];
  edges: ViewEdge[];
  routes: Map<string, Point[]>;
  absolute: Map<string, Point>;
}

/** Ink colours per theme (React Flow builds marker ids from the colour, so they are literal values). */
const INKS = {
  light: { ink: "#17161c", red: "#d62f32", green: "#15803d", label: "#ffffff" },
  dark: { ink: "#efece4", red: "#ff6b6b", green: "#4ade80", label: "#1b1a22" },
};

function useDarkMode(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false,
  );
}

export function DiagramView({
  analysis,
  source,
  includeAll,
  onIncludeAllChange,
  hiddenCount,
  mode = "structure",
  display,
  overlay,
  animate = false,
  forceExpanded,
  onSelectionChange,
  onNodeActivate,
  onClearMarked,
  grouping,
  spotlight,
  getInset,
  ref,
}: {
  analysis: ProjectAnalysis;
  /** Where the code came from, for "view on GitHub" links. */
  source: ProjectSource;
  includeAll: boolean;
  onIncludeAllChange: (v: boolean) => void;
  /** Files hidden while tests/examples/config are excluded. */
  hiddenCount: number;
  mode?: DiagramMode;
  /** The graph as a plan has changed it (same files; imports and modules may differ). */
  display?: { graph: DepGraph; partition: Partition };
  overlay?: DiagramOverlay;
  /** Glide boxes to their new places after a re-layout (plan playback, regrouping). */
  animate?: boolean;
  /** Modules shown open regardless of what the user expanded (those a plan touches). */
  forceExpanded?: readonly string[];
  onSelectionChange?: (selection: Selection) => void;
  /** The user clicked a box (to open its details). */
  onNodeActivate?: (selection: NonNullable<Selection>) => void;
  /** Shown as a button while `overlay.marked` has files. */
  onClearMarked?: () => void;
  grouping?: GroupingControl;
  /** Modules to show while the rest fades (the tour). */
  spotlight?: readonly string[] | null;
  /** Pixels on each side covered by things floating over the map (the story, a panel), measured when the camera moves. */
  getInset?: () => Inset;
  ref?: Ref<DiagramHandle>;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selection, setSelection] = useState<Selection>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  /** Draw every connection between parts, not just the main ones. */
  const [allLinks, setAllLinks] = useState(false);
  const [layout, setLayout] = useState<LaidOut | null>(null);
  /** Bumps each time ELK produces a fresh layout, to re-frame the camera. */
  const [layoutTick, setLayoutTick] = useState(0);
  /** True briefly after an animated re-layout: edges wait for the boxes to arrive. */
  const [settling, setSettling] = useState(false);
  /** Nodes to frame once the next layout lands (null = fit everything). */
  const focusRef = useRef<{ ids: string[]; padding: number } | null>(null);
  const animateRef = useRef(animate);
  /** The map assembles once, on its first layout. */
  const enteredRef = useRef(false);
  // Declared before the layout effect, so a re-layout sees the current value.
  useEffect(() => {
    animateRef.current = animate;
  }, [animate]);
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);
  const insetRef = useRef(getInset);
  useEffect(() => {
    insetRef.current = getInset;
  }, [getInset]);
  /** Camera padding: `ratio` of the map on every side, plus whatever floats over that side. */
  const pad = useCallback((ratio: number): NonNullable<FitViewOptions["padding"]> => {
    const w = wrapRef.current?.clientWidth ?? 1000;
    const h = wrapRef.current?.clientHeight ?? 700;
    const i = insetRef.current?.() ?? {};
    // Never let the overlays squeeze the map below about half of the frame.
    const fit = (a = 0, b = 0, v: number) => {
      const k = a + b > v * 0.55 ? (v * 0.55) / (a + b) : 1;
      return [a * k, b * k];
    };
    const [left, right] = fit(i.left, i.right, w);
    const [top, bottom] = fit(i.top, i.bottom, h);
    const side = (v: number, inset: number) => `${Math.floor((v - v / (1 + ratio)) * 0.5 + inset)}px` as const;
    return { top: side(h, top), right: side(w, right), bottom: side(h, bottom), left: side(w, left) };
  }, []);
  const dark = useDarkMode();
  const inks = dark ? INKS.dark : INKS.light;

  const graph = display?.graph ?? analysis.graph;
  const partition = display?.partition ?? analysis.partition;
  const cycles = useMemo(() => (display ? findCycles(display.graph) : analysis.cycles), [display, analysis.cycles]);
  const forcedKey = forceExpanded?.join("\0") ?? "";
  /** Frame everything after the next layout even while animating (a plan opened modules, or the grouping changed). */
  const refitRef = useRef(false);
  useEffect(() => {
    refitRef.current = true;
  }, [forcedKey, analysis.partition]);
  const shown = useMemo<ReadonlySet<string>>(
    () => (forcedKey ? new Set([...expanded, ...forcedKey.split("\0")]) : expanded),
    [expanded, forcedKey],
  );
  const moduleFiles = useMemo(() => modulesOf(partition), [partition]);
  // How the map is organised (lib/graph/organize): rows, pairs for loops, and which arrows are minor.
  // No shelves: every connection between parts is an arrow. At rest only the main ones are drawn (the user's
  // call: "minimize to the main points"); the rest appear when a part is in focus, or with "Show every connection".
  const organization = useMemo(
    () => organize([...moduleFiles.keys()], moduleGraph(graph, partition).edges, { maxShelves: 0, simplify: !allLinks, tiers: analysis.tiers }),
    [moduleFiles, graph, partition, allLinks, analysis.tiers],
  );
  const meta = useMemo(
    () => ({ descriptions: analysis.descriptions, tiers: analysis.tiers, kinds: analysis.kinds, organization }),
    [analysis.descriptions, analysis.tiers, analysis.kinds, organization],
  );
  /** Every part closed: the main parts only. */
  const closedView = useMemo(
    () => buildView(graph, partition, new Set(), cycles, analysis.godSet, analysis.labels, meta),
    [graph, partition, cycles, analysis.godSet, analysis.labels, meta],
  );
  /** What is on screen: the closed map, or the same map with the opened parts showing their files. */
  const view = useMemo(
    () => (shown.size === 0 ? closedView : buildView(graph, partition, shown, cycles, analysis.godSet, analysis.labels, meta)),
    [closedView, graph, partition, shown, cycles, analysis.godSet, analysis.labels, meta],
  );
  /** The closed map's layout, kept while it stays the same: opened parts are laid out around its spots. */
  const closedLayoutRef = useRef<{ view: typeof closedView; layout: Promise<Layout> } | null>(null);

  // Lay out whenever what is visible changes. Boxes are never dragged: the map has two fixed pictures, every part
  // closed (the main parts), and the same map with the parts the user opened showing their files, where every part
  // keeps its row and its place in the row (the closed map's spots go to ELK as order hints).
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const plan = { shelves: organization.shelves, pairs: organization.pairs, rows: organization.rows };
    if (closedLayoutRef.current?.view !== closedView) {
      const layout = layoutView(closedView.nodes, closedView.edges, plan);
      // A failed layout is not kept: the next change tries again.
      layout.catch(() => {
        if (closedLayoutRef.current?.layout === layout) closedLayoutRef.current = null;
      });
      closedLayoutRef.current = { view: closedView, layout };
    }
    const closedLayout = closedLayoutRef.current.layout;
    const laidOut =
      view === closedView
        ? closedLayout
        : closedLayout.then((c) => {
            const closed = new Map(closedView.nodes.flatMap((n) => (c.absolute.has(n.id) ? [[n.module, c.absolute.get(n.id)!] as const] : [])));
            return layoutView(view.nodes, view.edges, { ...plan, closed });
          });
    laidOut
      .then(({ boxes, routes, absolute }) => {
        if (cancelled) return;
        const first = !enteredRef.current;
        enteredRef.current = true;
        // First appearance: boxes pop in row by row, top first.
        const rows = [...new Set(view.nodes.filter((n) => !n.parent).map((n) => Math.round(absolute.get(n.id)?.y ?? 0)))].sort((a, b) => a - b);
        const nodes: MapperNode[] = view.nodes.map((n) => {
          const b = boxes.get(n.id) ?? { x: 0, y: 0, width: 160, height: 40 };
          const row = rows.indexOf(Math.round(absolute.get(n.parent ?? n.id)?.y ?? 0));
          return {
            id: n.id,
            type: nodeTypeFor(n),
            position: { x: b.x, y: b.y },
            width: b.width,
            height: b.height,
            parentId: n.parent,
            data: { view: n, selected: false, dimmed: false, enter: first, delay: Math.min(640, Math.max(0, row) * 90) },
          };
        });
        setLayout({ nodes, edges: view.edges, routes, absolute });
        setLayoutTick((t) => t + 1);
        if (animateRef.current) {
          setSettling(true);
          timer = setTimeout(() => setSettling(false), 460);
        }
      })
      .catch((e: unknown) => console.error("Layout failed", e));
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [view, closedView, organization]);

  // Re-frame the camera after each new auto-layout (not while a plan is playing: the camera stays put).
  useEffect(() => {
    if (layoutTick === 0) return;
    const focus = focusRef.current;
    if (animateRef.current && !focus && !refitRef.current) return;
    refitRef.current = false;
    const raf = requestAnimationFrame(() => {
      focusRef.current = null;
      void fitView(
        focus
          ? { nodes: focus.ids.map((id) => ({ id })), duration: 450, maxZoom: 1.2, padding: pad(focus.padding) }
          : { duration: 450, padding: pad(0.12), maxZoom: 1.05 },
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [layoutTick, fitView, pad]);

  // Keeps React Flow's measurements of the boxes (nothing moves them: dragging is off).
  const onNodesChange = useCallback((changes: NodeChange<MapperNode>[]) => {
    setLayout((l) => l && { ...l, nodes: applyNodeChanges(changes, l.nodes) });
  }, []);

  const selectedViewId = useMemo(() => {
    if (!selection) return null;
    if (selection.type === "module") return moduleNodeId(selection.id);
    const mod = partition[selection.id];
    return shown.has(mod) ? fileNodeId(selection.id) : moduleNodeId(mod);
  }, [selection, partition, shown]);

  // Focus: the tour's spotlight, else the hovered box, else the selection. Everything else fades.
  const spotKey = spotlight?.join("\0") ?? "";
  const highlight = useMemo(() => {
    if (!layout) return null;
    const members = new Set<string>();
    let focusId: string | null = null;
    if (spotKey) {
      const mods = new Set(spotKey.split("\0"));
      for (const n of layout.nodes) if (mods.has(n.data.view.module)) members.add(n.id);
    } else {
      focusId = hovered ?? selectedViewId;
      if (!focusId) return null;
      members.add(focusId);
      for (const n of layout.nodes) if (n.parentId === focusId) members.add(n.id);
    }
    const nodes = new Set(members);
    const edges = new Set<string>();
    for (const e of layout.edges) {
      // A file's own arrows across parts light up only when that file itself is in focus, not its whole part.
      const touches = e.detail ? e.source === focusId || e.target === focusId : members.has(e.source) || members.has(e.target);
      if (touches) {
        edges.add(e.id);
        nodes.add(e.source).add(e.target);
      }
    }
    // A spotlight shows its parts and what they touch; a hover lights up its neighbours too.
    return { nodes: spotKey ? members : nodes, edges, spot: !!spotKey };
  }, [hovered, selectedViewId, layout, spotKey]);

  // Frame the spotlight when it changes.
  useEffect(() => {
    if (!spotKey || !layout) return;
    const mods = new Set(spotKey.split("\0"));
    const ids = layout.nodes.filter((n) => !n.parentId && mods.has(n.data.view.module)).map((n) => n.id);
    if (ids.length === 0) return;
    const raf = requestAnimationFrame(() => void fitView({ nodes: ids.map((id) => ({ id })), duration: 500, maxZoom: 1.1, padding: pad(0.3) }));
    return () => cancelAnimationFrame(raf);
  }, [spotKey, layout, fitView, pad]);

  // Bug-risk dots per box: a file's probability, or the sum over a module's files — either way, the
  // chance the bug is in that box. Every painted box shares one scale; open groups are not painted.
  const heat = useMemo(() => {
    const fileHeat = mode === "risk" ? overlay?.heat : undefined;
    if (!fileHeat || !layout) return null;
    const value = new Map<string, number>();
    let max = 0;
    for (const n of layout.nodes) {
      const v = n.data.view;
      const p = v.kind === "file" ? (fileHeat.get(v.file!) ?? 0) : (moduleFiles.get(v.module) ?? []).reduce((s, f) => s + (fileHeat.get(f) ?? 0), 0);
      value.set(n.id, p);
      if (v.kind !== "group") max = Math.max(max, p);
    }
    return { value, max };
  }, [mode, overlay?.heat, layout, moduleFiles]);

  const refactor = mode === "refactor";
  const findingsByFile = overlay?.findings;
  const displayNodes = useMemo(
    () =>
      layout?.nodes.map((n) => {
        const v = n.data.view;
        const p = heat?.value.get(n.id);
        const max = heat?.max;
        const files = v.kind === "file" ? [v.file!] : (moduleFiles.get(v.module) ?? []);
        let findings: MapperNode["data"]["findings"];
        if (findingsByFile && v.kind !== "group") {
          for (const f of files) {
            const x = findingsByFile.get(f);
            if (!x) continue;
            const worse = !findings || x.severity === "high" || (x.severity === "medium" && findings.severity === "low");
            findings = { count: (findings?.count ?? 0) + x.count, severity: worse ? x.severity : findings!.severity };
          }
        }
        return {
          ...n,
          data: {
            ...n.data,
            selected: n.id === selectedViewId,
            dimmed: highlight !== null && v.kind !== "group" && !highlight.nodes.has(n.id) && !(highlight.spot && n.parentId && highlight.nodes.has(n.parentId)),
            href: v.kind === "file" ? githubLink(source, v.file!, "blob") : v.kind === "group" && analysis.grouping === "folders" ? githubModuleLink(source, v.module) : null,
            prob: p,
            heat: p !== undefined && v.kind !== "group" && max ? p / max : undefined,
            moved: refactor && v.kind !== "group" && files.some((f) => overlay?.moved?.has(f)),
            focus: refactor && v.kind !== "group" && files.some((f) => overlay?.focusFiles?.has(f)),
            marked: v.kind !== "group" && files.some((f) => overlay?.marked?.has(f)),
            findings,
            bug: mode === "risk" && !!findings && findings.severity !== "low",
          },
        };
      }) ?? [],
    [layout, selectedViewId, highlight, source, heat, moduleFiles, refactor, mode, overlay?.moved, overlay?.focusFiles, overlay?.marked, findingsByFile, analysis.grouping],
  );

  const displayEdges = useMemo<(RoutedEdgeType | LoopEdgeType)[]>(() => {
    if (!layout) return [];
    const any = (members: string[], set?: ReadonlySet<string>) => !!set && members.some((m) => set.has(m));
    const marker = (color: string) => ({ type: MarkerType.ArrowClosed, color, width: 13, height: 13 });
    const out: (RoutedEdgeType | LoopEdgeType)[] = [];
    // Arrows into a shelf are drawn only when they matter (a broken rule, a plan step). They then run
    // down a lane left of the map and enter the shelf from the side, so they never cross a box.
    const boxOf = (id: string) => {
      const n = layout.nodes.find((x) => x.id === id);
      const at = layout.absolute.get(id);
      return n && at ? { x: at.x, y: at.y, w: n.width ?? 0, h: n.height ?? 0, parent: n.parentId, shelf: !!n.data.view.shelf } : null;
    };
    const mainLeft = Math.min(...layout.nodes.filter((n) => !n.parentId && !n.data.view.shelf).map((n) => layout.absolute.get(n.id)?.x ?? Infinity));
    const shelfTops = layout.nodes.filter((n) => !n.parentId && n.data.view.shelf).map((n) => layout.absolute.get(n.id)?.y ?? Infinity);
    const firstShelfTop = Math.min(...shelfTops);
    let lanes = 0;
    const laneRoute = (sourceId: string, targetId: string): Point[] | undefined => {
      const src = boxOf(sourceId);
      const tgt = boxOf(targetId);
      if (!src || !tgt || !Number.isFinite(mainLeft)) return undefined;
      const shelf = tgt.parent ? boxOf(tgt.parent) : tgt;
      if (!shelf) return undefined;
      const i = lanes++;
      const laneX = Math.min(mainLeft, src.x) - 30 - i * 9;
      // Leave from the bottom, then head for the lane below anything in the way (not through a neighbour).
      const cx = src.x + src.w / 2;
      const ancestors = new Set([sourceId]);
      for (let p = src.parent; p; p = boxOf(p)?.parent) ancestors.add(p);
      const obstacles = layout.nodes.filter((n) => !ancestors.has(n.id) && !n.data.view.shelf).map((n) => boxOf(n.id)!).filter(Boolean);
      const blocks = (y: number) => obstacles.find((o) => y > o.y - 4 && y < o.y + o.h + 4 && o.x < cx && o.x + o.w > laneX);
      let startY = src.y + src.h + 10 + i * 3;
      for (let tries = 0, o = blocks(startY); o && tries < 6; tries++, o = blocks(startY)) startY = o.y + o.h + 10 + i * 3;
      const clearDown = !obstacles.some((o) => o.x < cx && o.x + o.w > cx && o.y < startY && o.y + o.h > src.y + src.h);
      const exit: Point[] = clearDown ? [{ x: cx, y: src.y + src.h }, { x: cx, y: startY }] : [{ x: src.x, y: (startY = src.y + src.h / 2) }];
      // A file on the first shelf is entered from above, through the gap over the shelves.
      if (tgt.parent && shelf.y === firstShelfTop) {
        const gapY = firstShelfTop - 24 - i * 7;
        const x = tgt.x + tgt.w / 2;
        return [...exit, { x: laneX, y: startY }, { x: laneX, y: gapY }, { x, y: gapY }, { x, y: tgt.y }];
      }
      const y = shelf.y + 28 + i * 4;
      return [...exit, { x: laneX, y: startY }, { x: laneX, y }, { x: shelf.x, y }];
    };
    // A minor connection shown on focus gets a path of its own around the boxes (ELK routed only the main ones).
    // The ones that share a box leave or enter it side by side, in the order of the boxes at their other ends.
    const shownMinor = layout.edges.filter(
      (e) => e.minor && !e.pair && (highlight?.edges.has(e.id) || (refactor && (any(e.members, overlay?.violations) || any(e.members, overlay?.added) || any(e.members, overlay?.focusImports)))),
    );
    const slots = new Map<string, number>();
    const centre = (id: string) => (boxOf(id)?.x ?? 0) + (boxOf(id)?.w ?? 0) / 2;
    for (const end of ["source", "target"] as const) {
      const other = end === "source" ? "target" : "source";
      const byBox = new Map<string, ViewEdge[]>();
      for (const e of shownMinor) byBox.set(e[end], [...(byBox.get(e[end]) ?? []), e]);
      for (const [id, list] of byBox) {
        const b = boxOf(id);
        if (!b) continue;
        list.sort((x, y) => centre(x[other]) - centre(y[other]));
        list.forEach((e, k) => slots.set(`${end}:${e.id}`, b.x + b.w * (0.1 + (0.8 * (k + 1)) / (list.length + 1))));
      }
    }
    const aroundRoute = (e: ViewEdge): Point[] | undefined => {
      const src = boxOf(e.source);
      const tgt = boxOf(e.target);
      if (!src || !tgt) return undefined;
      const skip = new Set([e.source, e.target]);
      for (const b of [src, tgt]) for (let p = b.parent; p; p = boxOf(p)?.parent) skip.add(p);
      const obstacles = layout.nodes.flatMap((n) => (skip.has(n.id) ? [] : (boxOf(n.id) ?? [])));
      return routeAround(src, tgt, obstacles, { sx: slots.get(`source:${e.id}`), tx: slots.get(`target:${e.id}`) });
    };
    // Loops: the two-way imports of each pair, as one red arrow between the two boxes.
    const loops = new Map<string, { source: string; target: string; members: string[] }>();
    for (const e of layout.edges) {
      if (e.pair) {
        const a = moduleNodeId(partition[splitFirst(e.members[0])]);
        const b = moduleNodeId(partition[splitSecond(e.members[0])]);
        const key = [a, b].sort().join("|");
        const loop = loops.get(key) ?? { source: [a, b].sort()[0], target: [a, b].sort()[1], members: [] };
        loop.members.push(...e.members);
        loops.set(key, loop);
        continue;
      }
      const active = highlight?.edges.has(e.id) ?? false;
      const violation = refactor && any(e.members, overlay?.violations);
      const added = refactor && any(e.members, overlay?.added);
      const stepEdge = refactor && any(e.members, overlay?.focusImports);
      const cycle = mode === "structure" && e.inCycle;
      const emphasised = violation || added || stepEdge;
      // Who uses a shelf is told in words and markers, not arrows; only arrows that matter are drawn.
      // A minor connection shows only while one of its parts is in focus (or it matters), on a simple path.
      const hidden = (!!e.toShelf && !emphasised) || (!!e.minor && !emphasised && !active);
      const color = violation || cycle ? inks.red : stepEdge || added ? inks.green : inks.ink;
      const faded = highlight !== null && !active;
      out.push({
        id: e.id,
        type: "routed",
        source: e.source,
        target: e.target,
        hidden,
        data: { points: hidden ? undefined : e.toShelf ? laneRoute(e.source, e.target) : e.minor ? aroundRoute(e) : layout.routes.get(e.id) },
        zIndex: active || emphasised ? 10 : 0,
        // The import count shows only when the arrow is in focus.
        label: active && e.weight > 1 ? `${e.weight}` : undefined,
        labelStyle: { fontSize: 11, fontWeight: 700, fill: inks.ink },
        labelShowBg: true,
        labelBgStyle: { fill: dark ? "#1b1a22" : "#ffffff", stroke: inks.ink, strokeWidth: 1.5 },
        labelBgPadding: [5, 2] as [number, number],
        labelBgBorderRadius: 8,
        markerEnd: marker(color),
        style: {
          stroke: color,
          strokeWidth: active || emphasised ? 2.6 : 1.8,
          strokeDasharray: e.typeOnly ? "6 5" : undefined,
          opacity: settling ? 0 : faded ? (emphasised ? 0.45 : 0.1) : 0.85,
          transition: "opacity 200ms",
        },
      });
    }
    for (const [key, loop] of loops) {
      const active = highlight?.edges !== undefined && layout.edges.some((e) => e.pair && highlight.edges.has(e.id) && loop.members.includes(e.members[0]));
      const violation = refactor && any(loop.members, overlay?.violations);
      out.push({
        id: `loop:${key}`,
        type: "loop",
        source: loop.source,
        target: loop.target,
        zIndex: 11,
        label: "loop",
        labelStyle: { fontSize: 12, fontWeight: 800, fill: inks.red },
        labelShowBg: true,
        labelBgStyle: { fill: dark ? "#1b1a22" : "#ffffff" },
        labelBgPadding: [4, 1] as [number, number],
        markerStart: marker(inks.red),
        markerEnd: marker(inks.red),
        style: { stroke: inks.red, strokeWidth: 3, opacity: settling ? 0 : highlight && !active && !violation ? 0.2 : 1, transition: "opacity 200ms" },
      } as Edge<Record<string, never>, "loop">);
    }
    return out;
  }, [layout, highlight, mode, refactor, overlay?.violations, overlay?.added, overlay?.focusImports, settling, partition, inks, dark]);

  const expand = (module: string) => setExpanded((prev) => (prev.has(module) ? prev : new Set(prev).add(module)));

  const onNodeClick: NodeMouseHandler<MapperNode> = (event, node) => {
    const v = node.data.view;
    if (v.kind === "module") {
      // Frame the opened module so its files are readable straight away.
      focusRef.current = { ids: [node.id], padding: 0.15 };
      expand(v.module);
      const s = { type: "module" as const, id: v.module };
      setSelection(s);
      onNodeActivate?.(s);
    } else if (v.kind === "group") {
      if ((event.target as HTMLElement).closest('[data-action="collapse"]')) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(v.module);
          return next;
        });
      }
      const s = { type: "module" as const, id: v.module };
      setSelection(s);
      onNodeActivate?.(s);
    } else if (v.file) {
      const s = { type: "file" as const, id: v.file };
      setSelection(s);
      onNodeActivate?.(s);
    }
  };

  /** Zooms to view nodes now if they are all on screen, otherwise after the next layout. */
  const zoomTo = (viewIds: string[], padding = 0.8) => {
    if (viewIds.every((id) => layout?.nodes.some((n) => n.id === id))) {
      void fitView({ nodes: viewIds.map((id) => ({ id })), duration: 450, maxZoom: 1.2, padding: pad(padding) });
    } else {
      focusRef.current = { ids: viewIds, padding };
    }
  };

  const focusFile = (file: string) => {
    if (!partition[file]) return;
    setSelection({ type: "file", id: file });
    zoomTo([fileNodeId(file)]);
    expand(partition[file]);
  };

  const focusModule = (module: string) => {
    if (!moduleFiles.has(module)) return;
    setSelection({ type: "module", id: module });
    zoomTo([moduleNodeId(module)]);
  };

  const expandModules = (modules: string[]) =>
    setExpanded((prev) => (modules.every((m) => prev.has(m)) ? prev : new Set([...prev, ...modules])));

  const frameFiles = (files: string[]) => {
    const known = files.filter((f) => partition[f]);
    if (known.length === 0) return;
    expandModules([...new Set(known.map((f) => partition[f]))]);
    zoomTo(known.map(fileNodeId), known.length === 1 ? 0.8 : 0.25);
  };

  // A big change in the map's size (a phone turned, a window resized) frames everything again.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let width = el.clientWidth;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - width) < 120) return;
      width = el.clientWidth;
      clearTimeout(timer);
      timer = setTimeout(() => void fitView({ duration: 300, padding: pad(0.12), maxZoom: 1.05 }), 150);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [fitView, pad]);

  useImperativeHandle(ref, () => ({
    focusFile,
    focusModule,
    expandModules,
    frameFiles,
    clearSelection: () => setSelection(null),
    fitAll: () => void fitView({ duration: 450, padding: pad(0.12), maxZoom: 1.05 }),
  }));

  useEffect(() => {
    onSelectionChange?.(selection);
  }, [selection, onSelectionChange]);

  const allExpanded = expanded.size >= moduleFiles.size;
  /** The kinds of part on the map, in the key's order. */
  const kindsShown = useMemo(() => {
    const present = new Set(view.nodes.map((n) => n.part).filter((k): k is ModuleKind => !!k && view.nodes.some((m) => m.part === k && m.kind !== "file")));
    return MODULE_KINDS.filter((k) => present.has(k));
  }, [view]);

  return (
    <div ref={wrapRef} className={`relative h-full w-full bg-[var(--canvas)] ${animate ? "rf-animate" : ""}`}>
      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onNodesChange={onNodesChange}
        onNodeMouseEnter={(_, n) => setHovered(n.id)}
        onNodeMouseLeave={() => setHovered(null)}
        onPaneClick={() => setSelection(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.08}
        colorMode={dark ? "dark" : "light"}
        proOptions={{ hideAttribution: true }}
      >
        <Panel position="top-right" className="!m-3">
          <ViewMenu
            allExpanded={allExpanded}
            onToggleAll={() => setExpanded(allExpanded ? new Set() : new Set(moduleFiles.keys()))}
            allLinks={allLinks}
            onAllLinksChange={setAllLinks}
            minorCount={organization.minor.size}
            includeAll={includeAll}
            onIncludeAllChange={onIncludeAllChange}
            hiddenCount={hiddenCount}
            grouping={grouping}
          />
        </Panel>
        {kindsShown.length > 0 && (
          <Panel position="bottom-left" className="!m-3 max-md:hidden">
            <ul className="rounded-xl border-2 border-[var(--ink)] bg-[var(--panel)] px-3 py-2" aria-label="Key: what each shape means">
              {kindsShown.map((k) => (
                <li key={k} className="flex items-center gap-2 py-0.5 text-[13px]" title={KIND_INFO[k].meaning}>
                  <KindGlyph kind={k} className="h-[14px] w-[24px]" />
                  {KIND_INFO[k].label}
                </li>
              ))}
            </ul>
          </Panel>
        )}
        <Panel position="bottom-right" className="!m-3">
          <div className="flex gap-1.5" role="group" aria-label="Zoom">
            <MapButton label="Zoom in" onClick={() => void zoomIn({ duration: 200 })}>
              <path d="M8 3.5v9M3.5 8h9" />
            </MapButton>
            <MapButton label="Zoom out" onClick={() => void zoomOut({ duration: 200 })}>
              <path d="M3.5 8h9" />
            </MapButton>
            <MapButton label="Show the whole map" onClick={() => void fitView({ duration: 450, padding: pad(0.12), maxZoom: 1.05 })}>
              <path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3" />
            </MapButton>
          </div>
        </Panel>
        {overlay?.marked && overlay.marked.size > 0 && onClearMarked && (
          <Panel position="bottom-center" className="!mb-4">
            <button onClick={onClearMarked} title="Clear the files the AI assistant highlighted" className="k-btn k-btn-small !border-[var(--ai)] !text-[var(--ai)]">
              <Icon.Sparkle className="h-3.5 w-3.5" />
              {overlay.marked.size} {overlay.marked.size === 1 ? "file" : "files"} pointed out by AI
              <Icon.Close className="h-3 w-3" />
            </button>
          </Panel>
        )}
      </ReactFlow>
      {analysis.graph.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-[15px] text-[var(--muted)]">No source files to draw.</div>
      )}
    </div>
  );
}

const splitFirst = (key: string) => key.slice(0, key.indexOf("\0"));
const splitSecond = (key: string) => key.slice(key.indexOf("\0") + 1);

function MapButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className="k-btn !h-9 !w-9 !p-0">
      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

/** One quiet menu for everything about how the map is drawn. */
function ViewMenu({
  allExpanded,
  onToggleAll,
  allLinks,
  onAllLinksChange,
  minorCount,
  includeAll,
  onIncludeAllChange,
  hiddenCount,
  grouping,
}: {
  allExpanded: boolean;
  onToggleAll: () => void;
  allLinks: boolean;
  onAllLinksChange: (v: boolean) => void;
  /** Connections left out of the map at rest. */
  minorCount: number;
  includeAll: boolean;
  onIncludeAllChange: (v: boolean) => void;
  hiddenCount: number;
  grouping?: GroupingControl;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>("button, input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div className="relative">
      <button ref={button} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="true" className="k-btn k-btn-small">
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
          <circle cx="5.5" cy="4.5" r="1.6" fill="var(--paper)" />
          <circle cx="10.5" cy="8" r="1.6" fill="var(--paper)" />
          <circle cx="7" cy="11.5" r="1.6" fill="var(--paper)" />
        </svg>
        View
        {grouping?.byAI && <span className="font-normal text-[var(--muted)]">· AI&apos;s parts</span>}
      </button>
      {open && (
        <div ref={menu} role="menu" className="k-fade absolute right-0 top-[calc(100%+8px)] z-20 w-[290px] rounded-xl border-[2.5px] border-[var(--ink)] bg-[var(--panel)] p-2 shadow-[4px_4px_0_var(--ink)]">
          <MenuItem onClick={onToggleAll}>{allExpanded ? "Close all parts" : "Open all parts"}</MenuItem>
          {(minorCount > 0 || allLinks) && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-[14px] hover:bg-[var(--hover)]">
              <input type="checkbox" checked={allLinks} onChange={(e) => onAllLinksChange(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--ink)]" />
              <span>
                Show every connection
                <span className="block text-[12.5px] text-[var(--muted)]">
                  {allLinks ? "Every import between parts is an arrow" : `Main ones only; ${minorCount} more appear when you point at a part`}
                </span>
              </span>
            </label>
          )}
          {(hiddenCount > 0 || includeAll) && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-[14px] hover:bg-[var(--hover)]">
              <input type="checkbox" checked={includeAll} onChange={(e) => onIncludeAllChange(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--ink)]" />
              <span>
                Show tests and config
                {!includeAll && <span className="block text-[12.5px] text-[var(--muted)]">{hiddenCount} files hidden</span>}
              </span>
            </label>
          )}
          {grouping && (
            <div className="mt-1 border-t-2 border-dashed border-[var(--border)] px-2.5 pb-1 pt-2.5 text-[14px]">
              <p className="font-bold">{grouping.byAI ? "Parts designed by the AI" : "Parts are folders"}</p>
              <p className="mt-0.5 text-[13px] leading-snug text-[var(--muted)]">
                {grouping.byAI ? "The AI sorted the files into parts that work together and named them." : "The AI didn't design parts this time, so files sit in their folders."}{" "}
                <span title="MQ: how cleanly the files split into parts. Higher is tidier.">Tidiness {grouping.mq.toFixed(2)}.</span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, onClick, disabled, hint }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; hint?: string }) {
  return (
    <button role="menuitem" onClick={onClick} disabled={disabled} className="flex w-full flex-col items-start rounded-lg px-2.5 py-2 text-left text-[14px] font-bold hover:bg-[var(--hover)] disabled:pointer-events-none disabled:opacity-45">
      {children}
      {hint && <span className="text-[12.5px] font-normal text-[var(--muted)]">{hint}</span>}
    </button>
  );
}
