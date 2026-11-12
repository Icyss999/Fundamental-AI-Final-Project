"use client";

import { ReactFlowProvider } from "@xyflow/react";
import { useRouter, useSearchParams } from "next/navigation";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AiOverviewCard } from "@/components/assistant/AiOverviewCard";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import type { Target } from "@/components/assistant/Markdown";
import { DiagramView, type DiagramMode, type DiagramOverlay, type GroupingControl, type Inset, type SidebarContext } from "@/components/mapper/DiagramView";
import { resolvePath } from "@/lib/ai/workspace";
import { edgesAfter, edgeKey } from "@/lib/change/planner";
import { findingsByFile } from "@/lib/diagnose/review";
import { organize } from "@/lib/graph/organize";
import { buildTour, projectStory, type Sentence, type TourStep } from "@/lib/graph/story";
import type { Partition } from "@/lib/graph/types";
import { ProjectPanel } from "./ProjectPanel";
import { analyzeHref, mapHref } from "./routes";
import { runIs, useOptionalProject, useRun, type Project } from "./session";
import { SidePanel } from "./SidePanel";
import { Logo } from "./ui";
import { MODES, WorkspaceHeader, type PanelId, type TabBadges } from "./WorkspaceHeader";

const KEYS: [string, string][] = [
  ["1 2 3", "switch what the map shows"],
  ["T", "take the tour"],
  ["A", "ask Kosmos"],
  ["← →", "move through the tour or a plan"],
  ["Esc", "close a panel or the tour"],
];

/** What the mode pages need from the map they sit on. */
export interface MapApi {
  panel: PanelId | null;
  setPanel: (p: PanelId | null) => void;
  tour: number | null;
  setTour: (i: number | null) => void;
  tourSteps: TourStep[];
  startTour: () => void;
  endTour: () => void;
  story: Sentence[];
  focusFile: (file: string) => void;
  focusModule: (module: string) => void;
  ctx: SidebarContext;
  /** Hands a question to the AI chat (absent when the AI is not set up). */
  askAI?: (prompt: string) => void;
}

const MapContext = createContext<MapApi | null>(null);

export function useMap(): MapApi {
  const value = use(MapContext);
  if (!value) throw new Error("useMap outside the map layout");
  return value;
}

/** While the map has nothing to show yet (it sends people to the waiting screen). */
function MapPlaceholder() {
  return (
    <div className="grid h-dvh place-items-center bg-[var(--gutter)]">
      <Logo className="h-12 w-12 animate-pulse" />
    </div>
  );
}

/**
 * The layout every map page shares: header, the map and the panels that are not about one mode.
 * It shows only a finished session (the AI's pass done); anything else goes to the waiting screen.
 */
export function MapShell({ children }: { children: ReactNode }) {
  const repo = useSearchParams().get("repo") ?? "";
  const router = useRouter();
  const { run } = useRun();
  const project = useOptionalProject();
  const ready = !!project && runIs(run, repo) && project.ready;
  useEffect(() => {
    if (!ready) router.replace(repo ? analyzeHref(repo) : "/");
  }, [ready, repo, router]);
  if (!ready || !project) return <MapPlaceholder />;
  return (
    <ReactFlowProvider>
      <MapFrame project={project}>{children}</MapFrame>
    </ReactFlowProvider>
  );
}

function MapFrame({ project, children }: { project: Project; children: ReactNode }) {
  const { data, analysedAt, mode, repo, layers, diagramAnalysis, overviewAnalysis, groupings, folderMQ, roles, selection, marked, includeAll, diagramRef, aiReady, assistant, autopilot, status } = project;
  const router = useRouter();
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [tour, setTour] = useState<number | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  /** When the user last looked at each mode, to mark AI results they have not seen yet. */
  const [seen, setSeen] = useState<Partial<Record<DiagramMode, number>>>({});
  const frameRef = useRef<HTMLDivElement>(null);
  const { setMapMounted } = project;
  useEffect(() => {
    setMapMounted(true);
    return () => setMapMounted(false);
  }, [setMapMounted]);

  /** How much of each side of the map the story box and the open panel cover, so the camera frames around them. */
  const getInset = useCallback((): Inset => {
    const frame = frameRef.current;
    if (!frame) return {};
    const f = frame.getBoundingClientRect();
    const inset = { top: 0, right: 0, bottom: 0, left: 0 };
    for (const el of frame.querySelectorAll<HTMLElement>("[data-overlay]")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.width > f.width * 0.6) inset.bottom = Math.max(inset.bottom, f.bottom - r.top);
      else if (r.left - f.left < f.right - r.right) inset.left = Math.max(inset.left, r.right - f.left);
      else inset.right = Math.max(inset.right, f.right - r.left);
    }
    return inset;
  }, []);

  // The bug dots and the plan show only once the AI has made them (or there is no AI pass at all).
  const bugsShown = ["done", "none"].includes(project.stageOf("bugs"));
  const planShown = ["done", "none"].includes(project.stageOf("refactor"));

  // ---- Refactor: the graph as the plan leaves it after the current step.
  const refactor = mode === "refactor" && planShown;
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

  const heat = useMemo(() => new Map(layers.diagnosis.files.map((f) => [f.id, f.posterior])), [layers.diagnosis]);
  const findings = useMemo(() => (layers.review && layers.review.findings.length > 0 ? findingsByFile(layers.review.findings) : null), [layers.review]);
  const step = layers.currentStep;
  const overlay = useMemo<DiagramOverlay>(() => {
    const ai = { ...(marked ? { marked } : {}), ...(findings ? { findings } : {}) };
    if (mode === "risk") return bugsShown ? { heat, ...ai } : {};
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
  }, [mode, refactor, bugsShown, heat, layers.violationsNow, delta, step, marked, findings]);

  // ---- The story and the tour, told from the map as it is organised now.
  const organization = useMemo(() => organize([...diagramAnalysis.modules.keys()], diagramAnalysis.moduleEdges, { maxShelves: 0 }), [diagramAnalysis]);
  const story = useMemo(() => projectStory(diagramAnalysis, organization), [diagramAnalysis, organization]);
  const tourSteps = useMemo(() => buildTour(diagramAnalysis, organization), [diagramAnalysis, organization]);
  const tourStep = mode === "structure" && tour !== null ? tourSteps[tour] : undefined;
  const spotlight = tourStep && tourStep.focus.length > 0 ? tourStep.focus : null;
  // The tour's last step shows the whole map again.
  useEffect(() => {
    if (tourStep && tourStep.focus.length === 0) diagramRef.current?.fitAll();
  }, [tourStep, diagramRef]);

  /** A mode tab was chosen (its link navigates): the mode's panel follows, the tour ends. */
  const onMode = (next: DiagramMode) => {
    const now = Date.now();
    setSeen((v) => ({ ...v, [mode]: now, [next]: now }));
    setTour(null);
    if (panel === "mode") setPanel(next === "structure" && !selection ? null : "mode");
  };
  const togglePanel = (p: PanelId) => setPanel((cur) => (cur === p ? null : p));
  const startTour = () => {
    if (mode !== "structure") router.push(mapHref("structure", repo));
    setPanel(null);
    setTour(0);
  };
  const endTour = () => {
    setTour(null);
    diagramRef.current?.fitAll();
  };
  const focusFile = (file: string) => diagramRef.current?.focusFile(file);
  const focusModule = (module: string) => diagramRef.current?.focusModule(module);
  const showInDiagram = (target: { type: "file" | "module"; id: string } | null, nextMode?: DiagramMode) => {
    if (nextMode && nextMode !== mode) {
      onMode(nextMode);
      router.push(mapHref(nextMode, repo));
    }
    if (target?.type === "file") focusFile(target.id);
    else if (target?.type === "module") focusModule(target.id);
  };
  const askAI = (prompt: string) => {
    setPanel("ai");
    void assistant.send(prompt);
  };
  const ctx: SidebarContext = { selection, clear: () => diagramRef.current?.clearSelection(), focusFile, focusModule };

  const grouping: GroupingControl = { byAI: groupings.kind === "ai", mq: groupings.kind === "ai" && groupings.ai ? groupings.ai.mq : folderMQ };

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
      project.setIncludeAll(true);
      setTimeout(() => showInDiagram(target), 0);
    } else {
      showInDiagram(target);
    }
  };
  const suggestions = useMemo(() => {
    const list: string[] = [];
    if (selection?.type === "file") list.push(`Explain what \`${selection.id}\` does and how it fits in`);
    if (layers.plan && layers.plan.steps.length > 0) list.push("Walk me through the tidy-up plan, step by step");
    list.push("Explain how this codebase is organised, as if I'm new to it");
    if (layers.review && layers.review.findings.length > 0) list.push("Which bug should I fix first, and how?");
    if (overviewAnalysis.cycles.length > 0) list.push("Explain the loops and how to break them");
    else if (overviewAnalysis.godFiles.length > 0) list.push(`Is \`${overviewAnalysis.godFiles[0].id}\` doing too much? How would you split it?`);
    return list.slice(0, 4);
  }, [selection, layers.plan, layers.review, overviewAnalysis]);

  // ---- Keys: 1 2 3 switch the map, T tours, A asks, ? lists them. Never while typing.
  const keyActions = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyActions.current = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable], [role=dialog], [role=menu]")) return;
      const k = e.key.toLowerCase();
      const m = MODES[Number(k) - 1];
      if (m) {
        onMode(m.id);
        router.push(mapHref(m.id, repo));
      } else if (k === "t" && tourSteps.length > 0) startTour();
      else if (k === "a") togglePanel("ai");
      else if (k === "?") setKeysOpen((v) => !v);
      else if (k === "escape" && keysOpen) setKeysOpen(false);
      else return;
      e.preventDefault();
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyActions.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Tabs: a spinner while the AI works on a mode, a dot when its result is new, a warning if it could not finish.
  const badges: TabBadges = {};
  for (const [m, id] of [["risk", "bugs"], ["refactor", "refactor"]] as const) {
    const st = project.stageOf(id);
    if (st === "running" || st === "waiting") badges[m] = "working";
    else if (st === "failed") badges[m] = "failed";
    else if (st === "done" && m !== mode && (autopilot.doneAt[id] ?? 0) > (seen[m] ?? 0)) badges[m] = "new";
  }

  const api: MapApi = { panel, setPanel, tour, setTour, tourSteps, startTour, endTour, story, focusFile, focusModule, ctx, askAI: aiReady ? askAI : undefined };

  return (
    <MapContext value={api}>
      <div className="flex h-dvh flex-col bg-[var(--gutter)] text-[var(--foreground)]">
        <WorkspaceHeader overview={data.overview} mode={mode} repo={repo} onMode={onMode} panel={panel} onTogglePanel={togglePanel} badges={badges} />
        <main className="relative min-h-0 flex-1 p-3 md:px-5 md:pb-5 md:pt-6">
          <div ref={frameRef} className="relative h-full rounded-[6px] border-[2.5px] border-[var(--ink)] bg-[var(--canvas)]" role="tabpanel" aria-label={`Map: ${MODES.find((m) => m.id === mode)?.label}`}>
            <div className="absolute inset-0 overflow-hidden rounded-[3px]">
              <DiagramView
                ref={diagramRef}
                analysis={diagramAnalysis}
                source={data.overview.source}
                includeAll={includeAll}
                onIncludeAllChange={project.setIncludeAll}
                hiddenCount={data.graph.nodes.length - roles.source}
                mode={mode}
                display={display}
                overlay={overlay}
                animate={(refactor && !!layers.plan) || project.regrouping}
                grouping={grouping}
                onSelectionChange={project.setSelection}
                onNodeActivate={() => setPanel((p) => (p === "ai" ? p : "mode"))}
                onClearMarked={() => project.setMarked(null)}
                spotlight={spotlight}
                getInset={getInset}
              />
            </div>

            {/* The mode's own page: its story box and its panel. */}
            {children}

            {keysOpen && (
              <section aria-label="Keyboard shortcuts" className="k-fade absolute bottom-4 left-4 z-30 w-[300px] rounded-xl border-[2.5px] border-[var(--ink)] bg-[var(--panel)] p-4 shadow-[4px_4px_0_var(--ink)] max-md:hidden">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-letter text-[17px] font-extrabold">Keys</h2>
                  <button onClick={() => setKeysOpen(false)} className="k-link text-[13.5px]">
                    Close
                  </button>
                </div>
                <dl className="space-y-1.5 text-[14px]">
                  {KEYS.map(([k, what]) => (
                    <div key={k} className="flex gap-3">
                      <dt className="w-14 shrink-0 font-mono font-bold">{k}</dt>
                      <dd className="text-[var(--muted)]">{what}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {panel === "project" && (
              <SidePanel title="About this project" onClose={() => setPanel(null)}>
                <ProjectPanel
                  overview={data.overview}
                  analysis={diagramAnalysis}
                  roles={roles}
                  warnings={data.warnings}
                  analysedAt={analysedAt}
                  onModule={(m) => {
                    setPanel(null);
                    showInDiagram({ type: "module", id: m }, "structure");
                  }}
                  onFile={(f) => {
                    setPanel(null);
                    showInDiagram({ type: "file", id: f });
                  }}
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
                      onShowArchitecture={() => {
                        setPanel(null);
                        showInDiagram(null, "structure");
                        diagramRef.current?.fitAll();
                      }}
                      onShowBugs={() => {
                        setPanel(null);
                        showInDiagram(null, "risk");
                      }}
                      onShowRefactor={() => {
                        setPanel(null);
                        showInDiagram(null, "refactor");
                      }}
                      onFocusFile={(f) => {
                        setPanel(null);
                        showInDiagram({ type: "file", id: f }, "risk");
                      }}
                    />
                  }
                />
              </SidePanel>
            )}
            {panel === "ai" && (
              <AssistantPanel
                assistant={assistant}
                status={status}
                suggestions={suggestions}
                resolve={resolveTarget}
                onTarget={openTarget}
                onNewChat={() => {
                  assistant.reset();
                  autopilot.clear();
                  project.setMarked(null);
                }}
                onClose={() => setPanel(null)}
                autopilot={autopilot}
              />
            )}
          </div>
        </main>
      </div>
    </MapContext>
  );
}
