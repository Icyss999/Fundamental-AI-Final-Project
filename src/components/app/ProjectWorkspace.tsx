"use client";

import { useMemo, useRef, useState } from "react";
import { ChangePanel } from "@/components/layers/ChangePanel";
import { DiagnosePanel } from "@/components/layers/DiagnosePanel";
import { useLayers } from "@/components/layers/useLayers";
import { DiagramView, type DiagramHandle, type DiagramMode, type DiagramOverlay } from "@/components/mapper/DiagramView";
import type { AnalysisResult } from "@/lib/analyze";
import { edgesAfter, edgeKey } from "@/lib/change/planner";
import { analyzeProject, roleCounts } from "@/lib/graph/project-analysis";
import type { Partition } from "@/lib/graph/types";
import { Overview, type ShowTarget } from "./Overview";

export type Tab = "overview" | "diagram";

/**
 * Everything derived from one analysis: both tabs, and the state of Layers 2 and 3 they share.
 * Keyed by analysis, so a new repository starts fresh.
 */
export function ProjectWorkspace({ data, analysedAt, tab, onTabChange }: { data: AnalysisResult; analysedAt: number; tab: Tab; onTabChange: (t: Tab) => void }) {
  const [includeAll, setIncludeAll] = useState(false);
  const [mode, setMode] = useState<DiagramMode>("structure");
  const diagramRef = useRef<DiagramHandle>(null);

  const overviewAnalysis = useMemo(() => analyzeProject(data.graph, data.overview.name, false), [data]);
  const diagramAnalysis = useMemo(
    () => (includeAll ? analyzeProject(data.graph, data.overview.name, true) : overviewAnalysis),
    [data, includeAll, overviewAnalysis],
  );
  const roles = useMemo(() => roleCounts(data.graph), [data]);
  const layers = useLayers(data, overviewAnalysis);

  // ---- Refactor mode: the graph as the plan leaves it after the current step.
  const refactor = mode === "refactor";
  const delta = refactor ? (layers.currentStep?.state ?? null) : null;
  /** Folder -> the diagram module its files belong to, to place moved files. */
  const dirModule = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of diagramAnalysis.graph.nodes) if (!map.has(n.dir)) map.set(n.dir, diagramAnalysis.partition[n.id]);
    return map;
  }, [diagramAnalysis]);
  const display = useMemo(() => {
    if (!delta) return undefined;
    const partition: Partition = { ...diagramAnalysis.partition };
    for (const [file, dir] of delta.moves) partition[file] = dirModule.get(dir) ?? partition[file];
    return { graph: { ...diagramAnalysis.graph, edges: edgesAfter(diagramAnalysis.graph.edges, delta) }, partition };
  }, [delta, diagramAnalysis, dirModule]);

  // Open every module the plan touches, so its moves and redirects are visible as they play.
  const plan = refactor ? layers.plan : null;
  const forceExpanded = useMemo(() => {
    if (!plan || plan.steps.length === 0) return undefined;
    const modules = new Set<string>();
    for (const s of plan.steps) {
      const a = s.action;
      for (const f of a.kind === "move" ? [a.file] : [a.file, a.from, a.to]) modules.add(diagramAnalysis.partition[f]);
      if (a.kind === "move") modules.add(dirModule.get(a.to) ?? "");
    }
    modules.delete("");
    return [...modules].sort();
  }, [plan, diagramAnalysis, dirModule]);

  const heat = useMemo(() => new Map(layers.diagnosis.files.map((f) => [f.id, f.posterior])), [layers.diagnosis]);
  const step = layers.currentStep;
  const overlay = useMemo<DiagramOverlay>(() => {
    if (mode === "risk") return { heat };
    if (!refactor) return {};
    const a = step?.action;
    return {
      violations: layers.violationsNow,
      added: delta ? new Set(delta.added) : undefined,
      moved: delta ? new Set(delta.moves.map(([f]) => f)) : undefined,
      focusFiles: a ? new Set(a.kind === "move" ? [a.file] : [a.file, a.to]) : undefined,
      focusImports: a?.kind === "redirect" ? new Set([edgeKey(a.file, a.to)]) : undefined,
    };
  }, [mode, refactor, heat, layers.violationsNow, delta, step]);

  const showInDiagram = (target: ShowTarget | null, nextMode?: DiagramMode) => {
    onTabChange("diagram");
    if (nextMode) setMode(nextMode);
    if (target?.type === "file") diagramRef.current?.focusFile(target.id);
    else if (target?.type === "module") diagramRef.current?.focusModule(target.id);
  };

  // Both tabs stay mounted (the diagram keeps its expansions and drags); the active one sits on top.
  // `invisible` alone cannot hide the diagram: React Flow sets `visibility: visible` on its nodes.
  const panel = (active: boolean) => `absolute inset-0 bg-[var(--background)] ${active ? "z-10" : "z-0 invisible pointer-events-none"}`;

  return (
    <div className="relative min-h-0 flex-1">
      <div className={`${panel(tab === "overview")} overflow-y-auto`} aria-hidden={tab !== "overview"}>
        <Overview
          overview={data.overview}
          analysis={overviewAnalysis}
          roles={roles}
          warnings={data.warnings}
          analysedAt={analysedAt}
          layers={layers}
          history={data.history}
          onShow={(t, m) => showInDiagram(t, m)}
          onOpenDiagram={(m) => showInDiagram(null, m)}
        />
      </div>
      <div className={panel(tab === "diagram")} aria-hidden={tab !== "diagram"}>
        <DiagramView
          ref={diagramRef}
          analysis={diagramAnalysis}
          source={data.overview.source}
          includeAll={includeAll}
          onIncludeAllChange={setIncludeAll}
          hiddenCount={data.graph.nodes.length - roles.source}
          mode={mode}
          onModeChange={setMode}
          display={display}
          overlay={overlay}
          animate={refactor && !!layers.plan}
          forceExpanded={forceExpanded}
          sidebar={
            mode === "risk"
              ? (ctx) => (
                  <DiagnosePanel
                    layers={layers}
                    history={data.history}
                    exampleReport={data.exampleReport}
                    ctx={ctx}
                    prefix={overviewAnalysis.prefix}
                    source={data.overview.source}
                    labels={diagramAnalysis.labels}
                    modules={diagramAnalysis.modules}
                    analysedAt={analysedAt}
                  />
                )
              : refactor
                ? (ctx) => <ChangePanel layers={layers} ctx={ctx} analysis={overviewAnalysis} />
                : undefined
          }
        />
      </div>
    </div>
  );
}
