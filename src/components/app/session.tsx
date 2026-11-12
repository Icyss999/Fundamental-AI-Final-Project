"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { StatusState } from "@/components/assistant/AssistantPanel";
import { fetchAssistantStatus, fetchSource } from "@/components/assistant/client";
import { useAssistant } from "@/components/assistant/useAssistant";
import { useAutopilot, type StageStatus } from "@/components/assistant/useAutopilot";
import { useLayers } from "@/components/layers/useLayers";
import type { DiagramHandle, DiagramMode } from "@/components/mapper/DiagramView";
import type { Selection } from "@/components/mapper/Inspector";
import { AUTOPILOT_STAGES, type StageId } from "@/lib/ai/autopilot";
import { appState, projectBrief } from "@/lib/ai/brief";
import { AssistantWorkspace, type WorkspaceEffects, type WorkspaceSnapshot } from "@/lib/ai/workspace";
import type { AnalysisResult, AnalyzeStep } from "@/lib/analyze";
import { partitionMQ, type ClusterRun, type Grouping, type GroupingKind } from "@/lib/cluster/grouping";
import { analyzeProject, roleCounts } from "@/lib/graph/project-analysis";
import { canonicalSource, mapHref, modeFromPath, SAMPLE_SOURCE } from "./routes";
import { streamAnalysis } from "./stream";
import { useGitHubSession } from "./useGitHubSession";

export interface Progress {
  source: string;
  current: AnalyzeStep;
  details: Partial<Record<AnalyzeStep, string>>;
}

/** One analysis of one repository: streaming progress, then the result (or an error). */
export interface Run {
  /** What was asked for (the `?repo=` value). */
  repo: string;
  /** Its short form once read (`owner/repo`), used in links from then on. */
  canonical: string | null;
  id: number;
  progress: Progress | null;
  data: AnalysisResult | null;
  at: number;
  error: string | null;
}

interface RunApi {
  run: Run | null;
  /** Reads `repo` (the same repository again is a no-op unless `force`). */
  start: (repo: string, force?: boolean) => void;
  /** Stops reading and forgets the run. */
  cancel: () => void;
  input: string;
  setInput: (v: string) => void;
  github: ReturnType<typeof useGitHubSession>;
}

const RunContext = createContext<RunApi | null>(null);

export function useRun(): RunApi {
  const value = use(RunContext);
  if (!value) throw new Error("useRun outside SessionRoot");
  return value;
}

/** True when `run` is the analysis of `repo` (as asked for, or in its short form). */
export const runIs = (run: Run | null, repo: string) => !!run && (run.repo === repo || run.canonical === repo);

/**
 * Lives in the root layout, so the analysis and everything the AI did survive moving between pages
 * (the waiting screen hands its finished session to the map pages). A reload starts over.
 */
export function SessionRoot({ children }: { children: ReactNode }) {
  const [input, setInput] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const runRef = useRef<Run | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const github = useGitHubSession();

  const start = useCallback(async (repo: string, force = false) => {
    const current = runRef.current;
    if (!force && current && runIs(current, repo) && !current.error) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const id = (current?.id ?? 0) + 1;
    const fresh: Run = { repo, canonical: null, id, progress: { source: repo, current: repo === SAMPLE_SOURCE ? "extract" : "resolve", details: {} }, data: null, at: 0, error: null };
    runRef.current = fresh;
    setRun(fresh);
    const update = (change: (r: Run) => Run) =>
      setRun((r) => {
        const next = r && r.id === id ? change(r) : r;
        runRef.current = next;
        return next;
      });
    try {
      const data = await streamAnalysis(repo, controller.signal, (step, detail) =>
        update((r) => ({ ...r, progress: r.progress && { ...r.progress, current: step, details: detail ? { ...r.progress.details, [step]: detail } : r.progress.details } })),
      );
      const canonical = canonicalSource(data, repo);
      setInput(canonical === SAMPLE_SOURCE ? "" : canonical);
      update((r) => ({ ...r, data, canonical, at: Date.now(), progress: null }));
    } catch (e) {
      if (!controller.signal.aborted) update((r) => ({ ...r, progress: null, error: e instanceof Error ? e.message : String(e) }));
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    runRef.current = null;
    setRun(null);
  }, []);

  const api = useMemo<RunApi>(() => ({ run, start: (repo, force) => void start(repo, force), cancel, input, setInput, github }), [run, start, cancel, input, github]);
  return (
    <RunContext value={api}>
      {run?.data ? (
        <ProjectSession key={run.id} repo={run.canonical ?? run.repo} data={run.data} analysedAt={run.at}>
          {children}
        </ProjectSession>
      ) : (
        children
      )}
    </RunContext>
  );
}

export type Groupings = { kind: GroupingKind; clusters: ClusterRun | null; ai: Grouping | null };

function useProjectState(repo: string, data: AnalysisResult, analysedAt: number) {
  const router = useRouter();
  const mode = modeFromPath(usePathname());
  const [includeAll, setIncludeAll] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  /** Files the assistant highlighted in the diagram. */
  const [marked, setMarked] = useState<ReadonlySet<string> | null>(null);
  /** The map, while it is on screen (the AI's pass runs before it is). */
  const diagramRef = useRef<DiagramHandle>(null);
  const mapMounted = useRef(false);
  const setMapMounted = useCallback((on: boolean) => {
    mapMounted.current = on;
  }, []);
  /** The user chose to see the results without the AI's parts (stage 1 failed, or no AI). */
  const [shown, setShown] = useState(false);
  /** While the AI's pass runs, its view changes (mode, camera, highlights) are muted: it works in the background. */
  const passRunning = useRef(false);

  const goMode = (next: DiagramMode) => router.push(mapHref(next, repo));

  const overviewAnalysis = useMemo(() => analyzeProject(data.graph, data.overview.name, false), [data]);
  const roles = useMemo(() => roleCounts(data.graph), [data]);
  const folderMQ = useMemo(() => partitionMQ(overviewAnalysis.graph, overviewAnalysis.partition), [overviewAnalysis]);

  // ---- Layer 1: folders until the AI designs its parts, then only the AI's parts.
  const [groupings, setGroupings] = useState<Groupings>({ kind: "folders", clusters: null, ai: null });
  /** True for a moment after a regroup, so boxes glide to their new modules. */
  const [regrouping, setRegrouping] = useState(false);
  const regroupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeGrouping = groupings.kind === "ai" ? groupings.ai : null;
  const diagramAnalysis = useMemo(
    () => (includeAll || activeGrouping ? analyzeProject(data.graph, data.overview.name, includeAll, activeGrouping) : overviewAnalysis),
    [data, includeAll, overviewAnalysis, activeGrouping],
  );
  const applyGrouping = (kind: GroupingKind, update?: { clusters?: ClusterRun; ai?: Grouping }) => {
    const ai = update?.ai ?? groupings.ai;
    // Raw clusters are kept for the AI to build on, never drawn.
    const shown: GroupingKind = kind === "ai" && ai ? "ai" : groupings.kind;
    setGroupings((g) => ({ kind: shown, clusters: update?.clusters ?? g.clusters, ai: update?.ai ?? g.ai }));
    if (shown !== "ai" || !mapMounted.current) return;
    setRegrouping(true);
    if (regroupTimer.current) clearTimeout(regroupTimer.current);
    regroupTimer.current = setTimeout(() => setRegrouping(false), 1600);
    if (ai && overviewAnalysis.graph.nodes.length <= 60) diagramRef.current?.expandModules([...new Set(Object.values(ai.partition))]);
  };
  const layers = useLayers(data, overviewAnalysis);

  // ---- AI: tools read a snapshot of the state above and act through these effects.
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
  const aiReady = typeof status === "object" && status.configured;

  /** Source text of project files, fetched once each (the AI's read_file and the bug excerpts share it). */
  const sources = useRef(new Map<string, Promise<string>>());
  const readSource = useCallback(
    (path: string) => {
      let text = sources.current.get(path);
      if (!text) {
        text = fetchSource(data.overview.source, path);
        text.catch(() => sources.current.delete(path));
        sources.current.set(path, text);
      }
      return text;
    },
    [data],
  );
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
        view: { mode, selection, includeAll },
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
        // The AI changes the view only when it answers the user in the chat: never from the waiting screen or
        // while its pass works in the background behind the map.
        show: ({ mode: nextMode, focus, highlight }) => {
          if (!mapMounted.current || passRunning.current) return;
          if (highlight) setMarked(highlight.length > 0 ? new Set(highlight) : null);
          if (nextMode) goMode(nextMode);
          if (highlight && highlight.length > 0) diagramRef.current?.frameFiles(highlight);
          if (focus?.type === "file") diagramRef.current?.focusFile(focus.id);
          else if (focus?.type === "module") diagramRef.current?.focusModule(focus.id);
        },
        setGrouping: (kind, update) => {
          if (kind === "ai" && mapMounted.current && !passRunning.current) goMode("structure");
          applyGrouping(kind, update);
        },
        setReview: layers.setReview,
        attachPatch: layers.attachPatch,
        readSource,
      },
      highlighted: marked?.size ?? 0,
    };
  });

  const assistant = useAssistant({
    context: brief,
    getWorkspace: () => new AssistantWorkspace(live.current!.snapshot, live.current!.effects),
    getAppState: () => appState(live.current!.snapshot, live.current!.highlighted),
  });
  // Leaving this repository stops the AI mid-reply.
  const assistantRef = useRef(assistant);
  useEffect(() => {
    assistantRef.current = assistant;
  });
  useEffect(() => () => assistantRef.current.stop(), []);

  // ---- The AI's pass runs by itself as soon as the AI is ready. The map waits only for its first stage (the
  // parts); bug hunting and the tidy-up plan carry on in the background (the user's call).
  const autopilot = useAutopilot(assistant);
  useEffect(() => {
    passRunning.current = autopilot.running;
  });
  const ready = shown || autopilot.stages?.organize === "done";
  /** The whole pass is over: the plan waits at its first step, nothing stays highlighted. */
  const finish = (status: StageStatus) => {
    setMarked(null);
    if (status === "done") layers.setStep(0);
  };
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !aiReady) return;
    autoStarted.current = true;
    void autopilot.start().then(finish);
  });
  /** Where one stage stands, for its page: no pass at all, waiting its turn, running, done, or failed (or skipped). */
  const stageOf = (id: StageId): "none" | "waiting" | "running" | "done" | "failed" => {
    const st = autopilot.stages?.[id];
    if (!st) return "none";
    if (st === "done") return "done";
    if (st === "running") return "running";
    if (st === "pending") return "waiting";
    return "failed";
  };
  const passFailed = !autopilot.running && AUTOPILOT_STAGES.some((s) => autopilot.stages?.[s.id] === "error" || autopilot.stages?.[s.id] === "stopped");
  /** Runs the stages that did not finish again. */
  const retryPass = () => {
    const left = AUTOPILOT_STAGES.filter((s) => autopilot.stages?.[s.id] !== "done").map((s) => s.id);
    void autopilot.start(left).then(finish);
  };
  /** Without the AI: Kosmos's own algorithms (folders, Bayes from history, rules from folder names, an A* plan). */
  const showOwnResults = () => {
    layers.runPlan();
    setShown(true);
  };
  /** Opens the map with what is ready (the folders, if the AI could not design its parts). */
  const showWhatsReady = () => setShown(true);

  return {
    repo,
    data,
    analysedAt,
    mode,
    goMode,
    overviewAnalysis,
    diagramAnalysis,
    roles,
    folderMQ,
    groupings,
    regrouping,
    layers,
    includeAll,
    setIncludeAll,
    selection,
    setSelection,
    marked,
    setMarked,
    diagramRef: diagramRef as RefObject<DiagramHandle | null>,
    setMapMounted,
    status,
    aiReady,
    readSource,
    assistant,
    autopilot,
    ready,
    passFailed,
    stageOf,
    retryPass,
    showWhatsReady,
    showOwnResults,
  };
}

export type Project = ReturnType<typeof useProjectState>;

const ProjectContext = createContext<Project | null>(null);

function ProjectSession({ repo, data, analysedAt, children }: { repo: string; data: AnalysisResult; analysedAt: number; children: ReactNode }) {
  const project = useProjectState(repo, data, analysedAt);
  return <ProjectContext value={project}>{children}</ProjectContext>;
}

/** The analysed project and the AI's work on it, or null while nothing has been read. */
export function useOptionalProject(): Project | null {
  return use(ProjectContext);
}

export function useProject(): Project {
  const value = use(ProjectContext);
  if (!value) throw new Error("useProject outside a project session");
  return value;
}
