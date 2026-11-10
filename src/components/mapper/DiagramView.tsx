"use client";

import "@xyflow/react/dist/style.css";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  applyNodeChanges,
  useReactFlow,
  type NodeChange,
  type NodeMouseHandler,
  type XYPosition,
} from "@xyflow/react";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { findCycles } from "@/lib/graph/analysis";
import { modulesOf } from "@/lib/graph/partition";
import type { ProjectAnalysis } from "@/lib/graph/project-analysis";
import type { DepGraph, Partition } from "@/lib/graph/types";
import { githubLink, githubModuleLink } from "@/lib/repo/links";
import type { ProjectSource } from "@/lib/repo/overview";
import { buildView, fileNodeId, moduleNodeId, type ViewEdge } from "@/lib/graph/view";
import { edgeTypes, type RoutedEdgeType } from "./edges";
import { Inspector, type Selection } from "./Inspector";
import { applyPins, layoutView, type Point } from "./layout";
import { nodeTypeFor, nodeTypes, type MapperNode } from "./nodes";

// Fixed colours (not CSS variables) because React Flow builds marker ids from them.
const EDGE = "#8b8d98";
const ACCENT = "#3b82f6";
const DANGER = "#e5484d";
const ADDED = "#16a34a";

/** The three layers share this one diagram; the mode picks what it shows. */
export type DiagramMode = "structure" | "risk" | "refactor";

const MODES: { id: DiagramMode; label: string; title: string }[] = [
  { id: "structure", label: "Structure", title: "Layer 1 · See: modules and imports" },
  { id: "risk", label: "Bug risk", title: "Layer 2 · Diagnose: where a bug most likely is" },
  { id: "refactor", label: "Refactor", title: "Layer 3 · Change: rules, violations and a plan to fix them" },
];

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
}

export interface SidebarContext {
  selection: Selection;
  clear: () => void;
  focusFile: (file: string) => void;
  focusModule: (module: string) => void;
}

export interface DiagramHandle {
  focusFile: (file: string) => void;
  focusModule: (module: string) => void;
  /** Opens these modules (used to follow a plan step). */
  expandModules: (modules: string[]) => void;
}

interface LaidOut {
  nodes: MapperNode[];
  edges: ViewEdge[];
  routes: Map<string, Point[]>;
  absolute: Map<string, Point>;
}

export function DiagramView({
  analysis,
  source,
  includeAll,
  onIncludeAllChange,
  hiddenCount,
  mode = "structure",
  onModeChange,
  display,
  overlay,
  sidebar,
  animate = false,
  forceExpanded,
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
  onModeChange?: (mode: DiagramMode) => void;
  /** The graph as a plan has changed it (same files; imports and modules may differ). */
  display?: { graph: DepGraph; partition: Partition };
  overlay?: DiagramOverlay;
  /** Replaces the Inspector on the right. */
  sidebar?: (ctx: SidebarContext) => ReactNode;
  /** Glide boxes to their new places after a re-layout (plan playback). */
  animate?: boolean;
  /** Modules shown open regardless of what the user expanded (those a plan touches). */
  forceExpanded?: readonly string[];
  ref?: Ref<DiagramHandle>;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selection, setSelection] = useState<Selection>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [layout, setLayout] = useState<LaidOut | null>(null);
  /** Bumps each time ELK produces a fresh layout (not when the user drags), to re-frame the camera. */
  const [layoutTick, setLayoutTick] = useState(0);
  /** Bump to force a fresh auto-layout of the same view ("Reset layout"). */
  const [layoutVersion, setLayoutVersion] = useState(0);
  /** True briefly after an animated re-layout: edges wait for the boxes to arrive. */
  const [settling, setSettling] = useState(false);
  /** Positions the user dragged nodes to, by view node id. They survive expand/collapse re-layouts. */
  const pinsRef = useRef(new Map<string, XYPosition>());
  const [hasPins, setHasPins] = useState(false);
  /** Node to frame once the next layout lands (null = fit everything). */
  const focusRef = useRef<{ id: string; padding: number } | null>(null);
  const animateRef = useRef(animate);
  // Declared before the layout effect, so a re-layout sees the current value.
  useEffect(() => {
    animateRef.current = animate;
  }, [animate]);
  const { fitView } = useReactFlow();

  const graph = display?.graph ?? analysis.graph;
  const partition = display?.partition ?? analysis.partition;
  const cycles = useMemo(() => (display ? findCycles(display.graph) : analysis.cycles), [display, analysis.cycles]);
  const forcedKey = forceExpanded?.join("\0") ?? "";
  /** Frame everything after the next layout even while animating (a new plan opened modules). */
  const refitRef = useRef(false);
  useEffect(() => {
    refitRef.current = true;
  }, [forcedKey]);
  const shown = useMemo<ReadonlySet<string>>(
    () => (forcedKey ? new Set([...expanded, ...forcedKey.split("\0")]) : expanded),
    [expanded, forcedKey],
  );
  const view = useMemo(
    () => buildView(graph, partition, shown, cycles, analysis.godSet, analysis.labels),
    [graph, partition, shown, cycles, analysis.godSet, analysis.labels],
  );
  const moduleFiles = useMemo(() => modulesOf(partition), [partition]);

  // Lay out whenever what is visible changes, keeping any boxes the user has dragged where they left them.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    layoutView(view.nodes, view.edges)
      .then(({ boxes, routes, absolute }) => {
        if (cancelled) return;
        const nodes: MapperNode[] = view.nodes.map((n) => {
          const b = boxes.get(n.id) ?? { x: 0, y: 0, width: 160, height: 40 };
          return {
            id: n.id,
            type: nodeTypeFor[n.kind],
            position: { x: b.x, y: b.y },
            width: b.width,
            height: b.height,
            parentId: n.parent,
            // Dragging a file past its module's edge grows the module instead of leaving it.
            expandParent: n.parent ? true : undefined,
            data: { view: n, selected: false, dimmed: false },
          };
        });
        setLayout({ nodes: applyPins(nodes, pinsRef.current), edges: view.edges, routes, absolute });
        setLayoutTick((t) => t + 1);
        if (animateRef.current) {
          setSettling(true);
          timer = setTimeout(() => setSettling(false), 520);
        }
      })
      .catch((e: unknown) => console.error("Layout failed", e));
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [view, layoutVersion]);

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
          ? { nodes: [{ id: focus.id }], duration: 450, maxZoom: 1.2, padding: focus.padding }
          : { duration: 450, padding: 0.15, maxZoom: 1.1 },
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [layoutTick, fitView]);

  // Applies drags (and the parent growth React Flow does for `expandParent`) and remembers the new spots.
  const onNodesChange = useCallback((changes: NodeChange<MapperNode>[]) => {
    let moved = false;
    for (const c of changes) {
      if (c.type === "position" && c.position) {
        pinsRef.current.set(c.id, c.position);
        moved = true;
      }
    }
    if (moved) setHasPins(true);
    setLayout((l) => l && { ...l, nodes: applyNodeChanges(changes, l.nodes) });
  }, []);

  const resetLayout = () => {
    pinsRef.current.clear();
    setHasPins(false);
    setLayoutVersion((v) => v + 1);
  };

  const selectedViewId = useMemo(() => {
    if (!selection) return null;
    if (selection.type === "module") return moduleNodeId(selection.id);
    const mod = partition[selection.id];
    return shown.has(mod) ? fileNodeId(selection.id) : moduleNodeId(mod);
  }, [selection, partition, shown]);

  // Hovering traces a box's imports; otherwise the selection does. Everything else fades.
  const focusId = hovered ?? selectedViewId;
  const highlight = useMemo(() => {
    if (!focusId || !layout) return null;
    const members = new Set([focusId]);
    for (const n of layout.nodes) if (n.parentId === focusId) members.add(n.id);
    const nodes = new Set(members);
    const edges = new Set<string>();
    for (const e of layout.edges) {
      if (members.has(e.source) || members.has(e.target)) {
        edges.add(e.id);
        nodes.add(e.source).add(e.target);
      }
    }
    return { nodes, edges };
  }, [focusId, layout]);

  // Heat per box: a file's probability, or the sum over a module's files — either way, the chance
  // the bug is in that box. Every painted box shares one scale (the likeliest box is darkest);
  // open groups are not painted, so they do not set the scale.
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
  const displayNodes = useMemo(
    () =>
      layout?.nodes.map((n) => {
        const v = n.data.view;
        const p = heat?.value.get(n.id);
        const max = heat?.max;
        const files = v.kind === "file" ? [v.file!] : (moduleFiles.get(v.module) ?? []);
        return {
          ...n,
          data: {
            ...n.data,
            selected: n.id === selectedViewId,
            dimmed: highlight !== null && v.kind !== "group" && !highlight.nodes.has(n.id),
            href: v.kind === "file" ? githubLink(source, v.file!, "blob") : v.kind === "group" ? githubModuleLink(source, v.module) : null,
            prob: p,
            heat: p !== undefined && v.kind !== "group" && max ? p / max : undefined,
            moved: refactor && v.kind !== "group" && files.some((f) => overlay?.moved?.has(f)),
            focus: refactor && v.kind !== "group" && files.some((f) => overlay?.focusFiles?.has(f)),
          },
        };
      }) ?? [],
    [layout, selectedViewId, highlight, source, heat, moduleFiles, refactor, overlay?.moved, overlay?.focusFiles],
  );

  const displayEdges = useMemo<RoutedEdgeType[]>(
    () =>
      layout?.edges.map((e) => {
        const active = highlight?.edges.has(e.id) ?? false;
        const any = (set?: ReadonlySet<string>) => !!set && e.members.some((m) => set.has(m));
        const violation = refactor && any(overlay?.violations);
        const added = refactor && any(overlay?.added);
        const stepEdge = refactor && any(overlay?.focusImports);
        const cycle = mode === "structure" && e.inCycle;
        const color = violation ? DANGER : stepEdge || added ? ADDED : cycle ? DANGER : active ? ACCENT : EDGE;
        const emphasised = violation || added || stepEdge;
        const source = layout.absolute.get(e.source);
        const target = layout.absolute.get(e.target);
        const baseOpacity = emphasised ? 0.95 : cycle ? 0.9 : refactor ? 0.35 : 0.55;
        return {
          id: e.id,
          type: "routed",
          source: e.source,
          target: e.target,
          data: { points: layout.routes.get(e.id), anchors: source && target ? { source, target } : undefined },
          zIndex: active || emphasised ? 10 : 0,
          label: e.weight > 1 ? String(e.weight) : undefined,
          labelStyle: { fontSize: 10, fontWeight: 600, fill: color },
          labelShowBg: true,
          labelBgStyle: { fill: "var(--canvas)" },
          labelBgPadding: [3, 2] as [number, number],
          labelBgBorderRadius: 4,
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
          style: {
            stroke: color,
            strokeWidth: (active || emphasised ? 2 : 1.25) + Math.log2(e.weight) * 0.6 + (stepEdge ? 1 : 0),
            strokeDasharray: e.typeOnly ? "5 4" : undefined,
            opacity: settling ? 0 : highlight ? (active ? 1 : emphasised ? 0.5 : 0.1) : baseOpacity,
            transition: "opacity 200ms",
          },
        };
      }) ?? [],
    [layout, highlight, mode, refactor, overlay?.violations, overlay?.added, overlay?.focusImports, settling],
  );

  const expand = (module: string) => setExpanded((prev) => (prev.has(module) ? prev : new Set(prev).add(module)));

  const onNodeClick: NodeMouseHandler<MapperNode> = (event, node) => {
    const v = node.data.view;
    if (v.kind === "module") {
      // Frame the opened module so its files are readable straight away.
      focusRef.current = { id: node.id, padding: 0.12 };
      expand(v.module);
      setSelection({ type: "module", id: v.module });
    } else if (v.kind === "group") {
      if ((event.target as HTMLElement).closest('[data-action="collapse"]')) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(v.module);
          return next;
        });
      }
      setSelection({ type: "module", id: v.module });
    } else if (v.file) {
      setSelection({ type: "file", id: v.file });
    }
  };

  /** Zooms to a view node now if it is on screen, otherwise after the next layout. */
  const zoomTo = (viewId: string) => {
    if (layout?.nodes.some((n) => n.id === viewId)) {
      void fitView({ nodes: [{ id: viewId }], duration: 450, maxZoom: 1.2, padding: 0.8 });
    } else {
      focusRef.current = { id: viewId, padding: 0.8 };
    }
  };

  const focusFile = (file: string) => {
    if (!partition[file]) return;
    setSelection({ type: "file", id: file });
    zoomTo(fileNodeId(file));
    expand(partition[file]);
  };

  const focusModule = (module: string) => {
    if (!moduleFiles.has(module)) return;
    setSelection({ type: "module", id: module });
    zoomTo(moduleNodeId(module));
  };

  const expandModules = (modules: string[]) =>
    setExpanded((prev) => (modules.every((m) => prev.has(m)) ? prev : new Set([...prev, ...modules])));

  useImperativeHandle(ref, () => ({ focusFile, focusModule, expandModules }));

  const allExpanded = expanded.size === moduleFiles.size;
  const ctx: SidebarContext = { selection, clear: () => setSelection(null), focusFile, focusModule };

  return (
    <div className="flex h-full min-h-0">
      <div className={`relative min-w-0 flex-1 bg-[var(--canvas)] ${animate ? "rf-animate" : ""}`}>
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
          nodesDraggable
          // A few pixels of jitter still counts as a click (expand / select), not a drag.
          nodeClickDistance={5}
          nodesConnectable={false}
          elementsSelectable={false}
          minZoom={0.08}
          colorMode="system"
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
          {/* Raised so the Next.js dev indicator does not cover it. */}
          <Controls showInteractive={false} style={{ marginBottom: 64 }} />
          <MiniMap pannable zoomable nodeStrokeWidth={2} nodeBorderRadius={6} className="!rounded-lg !border !border-[var(--border)] !bg-[var(--panel)]" />
          <Panel position="top-left" className="!m-3">
            <div className="flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-1 shadow-sm">
              <ToolbarButton onClick={() => setExpanded(allExpanded ? new Set() : new Set(moduleFiles.keys()))}>
                {allExpanded ? "Collapse all" : "Expand all"}
              </ToolbarButton>
              <ToolbarButton onClick={resetLayout} disabled={!hasPins} title="Discard dragged positions and auto-arrange">
                Reset layout
              </ToolbarButton>
              {hiddenCount > 0 || includeAll ? (
                <>
                  <span className="mx-1 h-5 w-px bg-[var(--border)]" />
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1 text-[12.5px] hover:bg-[var(--hover)]">
                    <input type="checkbox" checked={includeAll} onChange={(e) => onIncludeAllChange(e.target.checked)} className="accent-[var(--accent)]" />
                    Tests, examples &amp; config
                    {!includeAll && <span className="text-[var(--muted)]">({hiddenCount} hidden)</span>}
                  </label>
                </>
              ) : null}
            </div>
          </Panel>
          {onModeChange && (
            <Panel position="top-right" className="!m-3">
              <div className="flex rounded-xl border border-[var(--border)] bg-[var(--panel)] p-1 shadow-sm" role="tablist" aria-label="Diagram mode">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    role="tab"
                    aria-selected={mode === m.id}
                    title={m.title}
                    onClick={() => {
                      setSelection(null);
                      onModeChange(m.id);
                    }}
                    className={`rounded-lg px-3 py-1 text-[12.5px] font-medium transition ${mode === m.id ? "bg-[var(--accent)] text-white shadow-sm" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]"}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </Panel>
          )}
        </ReactFlow>
        {analysis.graph.nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-[14px] text-[var(--muted)]">No source files to draw.</div>
        )}
      </div>
      {sidebar ? (
        <SidebarSlot render={sidebar} ctx={ctx} />
      ) : (
        <Inspector analysis={analysis} source={source} selection={selection} onClear={ctx.clear} onFocusFile={focusFile} onFocusModule={focusModule} />
      )}
    </div>
  );
}

/** Renders the caller's sidebar with the diagram's selection and navigation. */
function SidebarSlot({ render, ctx }: { render: (ctx: SidebarContext) => ReactNode; ctx: SidebarContext }) {
  return render(ctx);
}

function ToolbarButton(props: React.ComponentProps<"button">) {
  return <button {...props} className="rounded-lg px-2.5 py-1 text-[12.5px] font-medium hover:bg-[var(--hover)] disabled:pointer-events-none disabled:opacity-40" />;
}
