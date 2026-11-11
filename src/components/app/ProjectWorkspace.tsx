"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AiOverviewCard } from "@/components/assistant/AiOverviewCard";
import { AssistantPanel, type StatusState } from "@/components/assistant/AssistantPanel";
import { fetchAssistantStatus, fetchSource } from "@/components/assistant/client";
import type { Target } from "@/components/assistant/Markdown";
import { useAssistant } from "@/components/assistant/useAssistant";
import { useAutopilot } from "@/components/assistant/useAutopilot";
import { ChangePanel } from "@/components/layers/ChangePanel";
import { DiagnosePanel } from "@/components/layers/DiagnosePanel";
import { useLayers } from "@/components/layers/useLayers";
import { DiagramView, type DiagramHandle, type DiagramMode, type DiagramOverlay, type GroupingControl } from "@/components/mapper/DiagramView";
import type { Selection } from "@/components/mapper/Inspector";
import { appState, projectBrief } from "@/lib/ai/brief";
import { AssistantWorkspace, resolvePath, type WorkspaceEffects, type WorkspaceSnapshot } from "@/lib/ai/workspace";
import type { AnalysisResult } from "@/lib/analyze";
import { edgesAfter, edgeKey } from "@/lib/change/planner";
import { clusterProject, partitionMQ, type ClusterRun, type Grouping, type GroupingKind } from "@/lib/cluster/grouping";
import { findingsByFile } from "@/lib/diagnose/review";
import { analyzeProject, roleCounts } from "@/lib/graph/project-analysis";
import type { Partition } from "@/lib/graph/types";
import { Overview, type ShowTarget } from "./Overview";

export type Tab = "overview" | "diagram";

const AUTORUN_KEY = "architecture-mapper:autopilot";

function readAutoRun(): boolean {
  try {
    return localStorage.getItem(AUTORUN_KEY) !== "off";
  } catch {
    return true;
  }
}

/**
 * Everything derived from one analysis: both tabs, the state of Layers 2 and 3 they share, and the
 * AI assistant that drives all three. Keyed by analysis, so a new repository starts fresh.
 */
export function ProjectWorkspace({
  data,
  analysedAt,
  tab,
  onTabChange,
  assistantOpen,
  onAssistantOpenChange,
}: {
  data: AnalysisResult;
  analysedAt: number;
  tab: Tab;
  onTabChange: (t: Tab) => void;
  assistantOpen: boolean;
  onAssistantOpenChange: (open: boolean) => void;
}) {
  const [includeAll, setIncludeAll] = useState(false);
  const [mode, setMode] = useState<DiagramMode>("structure");
  const [selection, setSelection] = useState<Selection>(null);
  /** Files the assistant highlighted in the diagram. */
  const [marked, setMarked] = useState<ReadonlySet<string> | null>(null);
  const diagramRef = useRef<DiagramHandle>(null);

  const overviewAnalysis = useMemo(() => analyzeProject(data.graph, data.overview.name, false), [data]);

  // ---- Layer 1 groupings: folders (baseline), clusters from the MQ search, or the AI's architecture.
  const [groupings, setGroupings] = useState<{ kind: GroupingKind; clusters: ClusterRun | null; ai: Grouping | null }>({ kind: "folders", clusters: null, ai: null });
  /** True for a moment after a regroup, so boxes glide to their new modules. */
  const [regrouping, setRegrouping] = useState(false);
  const regroupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const folderMQ = useMemo(() => partitionMQ(overviewAnalysis.graph, overviewAnalysis.partition), [overviewAnalysis]);
  const activeGrouping = groupings.kind === "clusters" ? (groupings.clusters?.grouping ?? null) : groupings.kind === "ai" ? groupings.ai : null;
  const diagramAnalysis = useMemo(
    () => (includeAll || activeGrouping ? analyzeProject(data.graph, data.overview.name, includeAll, activeGrouping) : overviewAnalysis),
    [data, includeAll, overviewAnalysis, activeGrouping],
  );
  const applyGrouping = (kind: GroupingKind, update?: { clusters?: ClusterRun; ai?: Grouping }) => {
    setGroupings((g) => ({ kind, clusters: update?.clusters ?? g.clusters, ai: update?.ai ?? g.ai }));
    setRegrouping(true);
    if (regroupTimer.current) clearTimeout(regroupTimer.current);
    regroupTimer.current = setTimeout(() => setRegrouping(false), 1600);
    // Small projects: open every new module so the files are seen moving into place.
    const next = kind === "clusters" ? (update?.clusters ?? groupings.clusters)?.grouping : kind === "ai" ? (update?.ai ?? groupings.ai) : null;
    if (next && overviewAnalysis.graph.nodes.length <= 60) diagramRef.current?.expandModules([...new Set(Object.values(next.partition))]);
  };
  const groupingControl: GroupingControl = {
    value: groupings.kind,
    options: [
      { value: "folders", label: "Folders", mq: folderMQ },
      { value: "clusters", label: "Clusters (MQ search)", mq: groupings.clusters?.grouping.mq, title: "Simulated annealing over the import graph, maximising TurboMQ" },
      { value: "ai", label: "AI architecture", mq: groupings.ai?.mq, disabled: !groupings.ai, title: groupings.ai ? "Modules the AI designed" : "Run the AI autopilot to design one" },
    ],
    onChange: (kind) => {
      if (kind === "clusters" && !groupings.clusters) applyGrouping("clusters", { clusters: clusterProject(overviewAnalysis.graph, overviewAnalysis) });
      else applyGrouping(kind);
    },
  };
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
  const findings = useMemo(() => (layers.review && layers.review.findings.length > 0 ? findingsByFile(layers.review.findings) : null), [layers.review]);
  const step = layers.currentStep;
  const overlay = useMemo<DiagramOverlay>(() => {
    const ai = { ...(marked ? { marked } : {}), ...(findings ? { findings } : {}) };
    if (mode === "risk") return { heat, ...ai };
    if (!refactor) return ai;
    const a = step?.action;
    return {
      ...ai,
      violations: layers.violationsNow,
      added: delta ? new Set(delta.added) : undefined,
      moved: delta ? new Set(delta.moves.map(([f]) => f)) : undefined,
      focusFiles: a ? new Set(a.kind === "move" ? [a.file] : [a.file, a.to]) : undefined,
      focusImports: a?.kind === "redirect" ? new Set([edgeKey(a.file, a.to)]) : undefined,
    };
  }, [mode, refactor, heat, layers.violationsNow, delta, step, marked, findings]);

  const showInDiagram = (target: ShowTarget | null, nextMode?: DiagramMode) => {
    onTabChange("diagram");
    if (nextMode) setMode(nextMode);
    if (target?.type === "file") diagramRef.current?.focusFile(target.id);
    else if (target?.type === "module") diagramRef.current?.focusModule(target.id);
  };

  // ---- AI assistant: tools read a snapshot of the state above and act through these effects.
  const [status, setStatus] = useState<StatusState>("loading");
  useEffect(() => {
    let cancelled = false;
    fetchAssistantStatus()
      .then((s) => !cancelled && setStatus(s))
      .catch(() => !cancelled && setStatus("error"));
    return () => {
      cancelled = true;
    };
  }, []);

  const sources = useRef(new Map<string, Promise<string>>());
  const brief = useMemo(() => projectBrief(data, overviewAnalysis), [data, overviewAnalysis]);
  const live = useRef<{ snapshot: WorkspaceSnapshot; effects: WorkspaceEffects; highlighted: number } | null>(null);
  useEffect(() => {
    live.current = {
      snapshot: {
        data,
        analysis: overviewAnalysis,
        basis: layers.basis,
        diagnosis: layers.diagnosis,
        outcomes: layers.outcomes,
        report: layers.report,
        params: layers.params,
        review: layers.review,
        useReview: layers.useReview,
        rulesText: layers.rulesText,
        suggestedRules: layers.suggested,
        policy: layers.policy,
        violations: layers.evaluation.violations,
        planOptions: layers.planOptions,
        plan: layers.plan,
        step: layers.step,
        view: { tab, mode, selection, includeAll },
        diagram: { partition: diagramAnalysis.partition, labels: diagramAnalysis.labels },
        grouping: { kind: groupings.kind, folderMQ, clusters: groupings.clusters, ai: groupings.ai },
        patches: layers.patches,
      },
      effects: {
        setOutcomes: layers.setOutcomes,
        loadReport: layers.loadReport,
        setRulesText: layers.setRulesText,
        setPlanOptions: layers.setPlanOptions,
        adoptPlan: layers.adoptPlan,
        adoptComparison: layers.adoptComparison,
        setStep: layers.setStep,
        play: () => {
          layers.setStep(0);
          layers.setPlaying(true);
        },
        show: ({ mode: nextMode, focus, highlight }) => {
          onTabChange("diagram");
          if (nextMode) setMode(nextMode);
          if (highlight) {
            setMarked(highlight.length > 0 ? new Set(highlight) : null);
            if (highlight.length > 0) diagramRef.current?.frameFiles(highlight);
          }
          if (focus?.type === "file") diagramRef.current?.focusFile(focus.id);
          else if (focus?.type === "module") diagramRef.current?.focusModule(focus.id);
        },
        setGrouping: (kind, update) => {
          onTabChange("diagram");
          setMode("structure");
          applyGrouping(kind, update);
        },
        setReview: layers.setReview,
        attachPatch: layers.attachPatch,
        readSource: (path) => {
          let text = sources.current.get(path);
          if (!text) {
            text = fetchSource(data.overview.source, path);
            text.catch(() => sources.current.delete(path));
            sources.current.set(path, text);
          }
          return text;
        },
      },
      highlighted: marked?.size ?? 0,
    };
  });

  const assistant = useAssistant({
    context: brief,
    getWorkspace: () => new AssistantWorkspace(live.current!.snapshot, live.current!.effects),
    getAppState: () => appState(live.current!.snapshot, live.current!.highlighted),
  });

  const autopilot = useAutopilot(assistant);
  const [autoRun, setAutoRun] = useState(readAutoRun);
  const changeAutoRun = (value: boolean) => {
    setAutoRun(value);
    try {
      localStorage.setItem(AUTORUN_KEY, value ? "on" : "off");
    } catch {
      // storage blocked: the choice lasts for this page only
    }
  };
  // Declared after the effect that fills `live`, so the autopilot's first message can read it.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !autoRun || typeof status !== "object" || !status.configured) return;
    autoStarted.current = true;
    onAssistantOpenChange(true);
    void autopilot.start();
  }, [status, autoRun, autopilot, onAssistantOpenChange]);

  const askAI = (prompt: string) => {
    onAssistantOpenChange(true);
    void assistant.send(prompt);
  };

  /** Inline code in a reply that names a project file or a diagram module. */
  const allFiles = useMemo(() => data.graph.nodes.map((n) => n.id), [data]);
  const resolveTarget = (text: string): Target | null => {
    const label = text.replace(/\/+$/, "");
    const mod = Object.keys(diagramAnalysis.labels).find((m) => m === label || diagramAnalysis.labels[m] === label);
    if (mod) return { type: "module", id: mod };
    if (!/\.[A-Za-z0-9]+$/.test(text) || /\s/.test(text)) return null;
    try {
      return { type: "file", id: resolvePath(allFiles, text, overviewAnalysis.prefix) };
    } catch {
      return null;
    }
  };
  const openTarget = (target: Target) => {
    if (target.type === "file" && !diagramAnalysis.partition[target.id]) {
      // A test or config file: show hidden files first, then focus it once the diagram has them.
      setIncludeAll(true);
      setTimeout(() => showInDiagram(target), 0);
    } else {
      showInDiagram(target);
    }
  };

  const suggestions = useMemo(() => {
    const list: string[] = [];
    if (selection?.type === "file") list.push(`Explain what \`${selection.id}\` does and how it fits in`);
    if (layers.plan && layers.plan.steps.length > 0) list.push("Write the code changes for step 1 of the plan");
    list.push("Give me a tour of this codebase's architecture");
    list.push(data.exampleReport ? "Load the example test report and find the bug" : "Which files are most likely to contain a bug, and why?");
    list.push("Propose architecture rules for this project and plan a refactoring to meet them");
    if (overviewAnalysis.cycles.length > 0) list.push("Explain the import cycles and how to break them");
    else if (overviewAnalysis.godFiles.length > 0) list.push(`Is \`${overviewAnalysis.godFiles[0].id}\` doing too much? How would you split it?`);
    return list.slice(0, 5);
  }, [selection, layers.plan, data.exampleReport, overviewAnalysis]);

  // Both tabs stay mounted (the diagram keeps its expansions and drags); the active one sits on top.
  // `invisible` alone cannot hide the diagram: React Flow sets `visibility: visible` on its nodes.
  const panel = (active: boolean) => `absolute inset-0 bg-[var(--background)] ${active ? "z-10" : "z-0 invisible pointer-events-none"}`;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="relative min-w-0 flex-1">
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
            ai={
              <AiOverviewCard
                status={status}
                autopilot={autopilot}
                architecture={groupings.ai}
                clustersMQ={groupings.clusters?.grouping.mq ?? null}
                folderMQ={folderMQ}
                review={layers.review}
                plan={layers.plan}
                patches={layers.patches?.size ?? 0}
                prefix={overviewAnalysis.prefix}
                onRun={() => {
                  onAssistantOpenChange(true);
                  void autopilot.start();
                }}
                onShowArchitecture={() => {
                  applyGrouping("ai");
                  showInDiagram(null, "structure");
                }}
                onShowBugs={() => showInDiagram(null, "risk")}
                onShowRefactor={() => showInDiagram(null, "refactor")}
                onFocusFile={(f) => showInDiagram({ type: "file", id: f }, "risk")}
              />
            }
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
            animate={(refactor && !!layers.plan) || regrouping}
            grouping={groupingControl}
            forceExpanded={forceExpanded}
            onSelectionChange={setSelection}
            onClearMarked={() => setMarked(null)}
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
                      onAsk={askAI}
                    />
                  )
                : refactor
                  ? (ctx) => <ChangePanel layers={layers} ctx={ctx} analysis={overviewAnalysis} onAsk={askAI} />
                  : undefined
            }
          />
        </div>
      </div>
      {assistantOpen && (
        <AssistantPanel
          assistant={assistant}
          status={status}
          suggestions={suggestions}
          resolve={resolveTarget}
          onTarget={openTarget}
          onNewChat={() => {
            assistant.reset();
            autopilot.clear();
            setMarked(null);
          }}
          onClose={() => onAssistantOpenChange(false)}
          autopilot={autopilot}
          autoRun={autoRun}
          onAutoRunChange={changeAutoRun}
        />
      )}
    </div>
  );
}
