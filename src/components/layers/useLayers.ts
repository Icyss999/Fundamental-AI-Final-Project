"use client";

import { useEffect, useMemo, useState } from "react";
import type { AnalysisResult } from "@/lib/analyze";
import { planRefactoring, type Heuristic, type PlanResult, type PlanStep } from "@/lib/change/planner";
import { Policy, suggestRules } from "@/lib/change/rules";
import type { Outcome } from "@/lib/diagnose/bayes";
import { DEFAULT_DIAGNOSIS_PARAMS, prepareDiagnosis, scoreDiagnosis, type DiagnosisParams } from "@/lib/diagnose/diagnose";
import { parseTestReport, ReportError } from "@/lib/diagnose/reports";
import type { ProjectAnalysis } from "@/lib/graph/project-analysis";
import { importKey } from "@/lib/graph/types";

export interface ReportNote {
  tone: "ok" | "error";
  text: string;
}

export interface Comparison {
  heuristic: Heuristic;
  status: PlanResult["status"];
  cost: number;
  steps: number;
  expanded: number;
  generated: number;
  hStart: number;
  ms: number;
}

export interface PlanOptionsState {
  heuristic: Heuristic;
  riskWeight: number;
}

/**
 * State for Layer 2 (test outcomes, model settings -> diagnosis) and Layer 3 (rules -> violations,
 * plan, playback). Lives above both tabs so the Overview and the diagram show the same results.
 */
export function useLayers(data: AnalysisResult, analysis: ProjectAnalysis) {
  // ---- Layer 2 · Diagnose
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, Outcome>>(new Map());
  const [params, setParams] = useState<DiagnosisParams>(DEFAULT_DIAGNOSIS_PARAMS);
  const [reportNote, setReportNote] = useState<ReportNote | null>(null);
  const { halfLifeDays, maxFilesPerCommit, coverageDecay } = params;
  const basis = useMemo(
    () => prepareDiagnosis(data.graph, analysis.graph.nodes, data.history?.commits ?? null, { halfLifeDays, maxFilesPerCommit, coverageDecay }),
    [data, analysis, halfLifeDays, maxFilesPerCommit, coverageDecay],
  );
  const diagnosis = useMemo(() => scoreDiagnosis(basis, outcomes, params), [basis, outcomes, params]);
  const testIds = useMemo(() => basis.coverage.map((c) => c.id), [basis]);

  const setOutcome = (test: string, outcome: Outcome | null) =>
    setOutcomes((prev) => {
      const next = new Map(prev);
      if (outcome) next.set(test, outcome);
      else next.delete(test);
      return next;
    });

  const loadReport = (text: string, name: string) => {
    try {
      const parsed = parseTestReport(text, testIds);
      setOutcomes(parsed.outcomes);
      const failed = [...parsed.outcomes.values()].filter((o) => o === "fail").length;
      const extra = parsed.unmatched.length > 0 ? ` ${parsed.unmatched.length} entries matched no test file here.` : "";
      setReportNote({ tone: "ok", text: `${name}: ${parsed.outcomes.size} test files (${failed} failing), read as ${parsed.format}.${extra}` });
    } catch (e) {
      setReportNote({ tone: "error", text: e instanceof ReportError ? e.message : `Could not read ${name}.` });
    }
  };

  // ---- Layer 3 · Change
  const files = useMemo(() => analysis.graph.nodes.map((n) => ({ id: n.id, dir: n.dir, name: n.name, path: n.id })), [analysis]);
  const suggested = useMemo(
    () => suggestRules([...analysis.modules.keys()].map((m) => ({ label: analysis.labels[m] ?? m })), analysis.moduleEdges, (m) => analysis.labels[m] ?? m),
    [analysis],
  );
  const [rulesText, setRulesText] = useState(suggested);
  const policy = useMemo(() => new Policy(rulesText, analysis.prefix), [rulesText, analysis.prefix]);
  const evaluation = useMemo(() => policy.evaluate(files, analysis.graph.edges), [policy, files, analysis]);
  const [planOptions, setPlanOptions] = useState<PlanOptionsState>({ heuristic: "matching", riskWeight: 1 });
  const [planned, setPlanned] = useState<{ result: PlanResult; policy: Policy } | null>(null);
  const [comparison, setComparison] = useState<{ rows: Comparison[]; policy: Policy } | null>(null);
  const [planning, setPlanning] = useState(false);
  const [stepState, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  // A plan belongs to the rules it was made for; editing the rules retires it.
  const plan = planned && planned.policy === policy ? planned.result : null;
  const step = plan ? Math.min(stepState, plan.steps.length) : 0;

  const problem = () => ({
    files,
    edges: analysis.graph.edges,
    policy,
    risk: new Map(diagnosis.files.map((f) => [f.id, diagnosis.maxPosterior > 0 ? f.posterior / diagnosis.maxPosterior : 0])),
  });

  /** Runs after a paint so the "Planning…" state shows; the search itself is synchronous and time-limited. */
  const runPlan = () => {
    setPlanning(true);
    setPlaying(false);
    setTimeout(() => {
      const result = planRefactoring(problem(), { heuristic: planOptions.heuristic, riskWeight: planOptions.riskWeight, timeLimitMs: 4000 });
      setPlanned({ result, policy });
      setStep(0);
      setPlanning(false);
    }, 30);
  };

  const runComparison = () => {
    setPlanning(true);
    setTimeout(() => {
      const p = problem();
      const rows = (["matching", "count", "zero"] as Heuristic[]).map((heuristic) => {
        const r = planRefactoring(p, { heuristic, riskWeight: planOptions.riskWeight, timeLimitMs: 4000 });
        return { heuristic, status: r.status, cost: r.cost, steps: r.steps.length, expanded: r.stats.expanded, generated: r.stats.generated, hStart: r.stats.hStart, ms: r.stats.ms };
      });
      setComparison({ rows, policy });
      setPlanning(false);
    }, 30);
  };

  // Playback: advance one step at a time, then stop at the end.
  useEffect(() => {
    if (!playing || !plan) return;
    if (step >= plan.steps.length) {
      const stop = setTimeout(() => setPlaying(false), 0);
      return () => clearTimeout(stop);
    }
    const timer = setTimeout(() => setStep(step + 1), step === 0 ? 400 : 1700);
    return () => clearTimeout(timer);
  }, [playing, plan, step]);

  const currentStep: PlanStep | null = plan && step > 0 ? plan.steps[step - 1] : null;

  /** Violating imports after `step` plan steps (or now, without a plan). */
  const violationsNow = useMemo(() => {
    if (!plan) return new Set(evaluation.violations.map((v) => importKey(v.source, v.target)));
    const set = new Set(plan.initialViolations);
    for (const s of plan.steps.slice(0, step)) {
      s.fixed.forEach((k) => set.delete(k));
      s.introduced.forEach((k) => set.add(k));
    }
    return set;
  }, [plan, step, evaluation]);

  return {
    // Layer 2
    diagnosis,
    outcomes,
    setOutcome,
    setOutcomes,
    params,
    setParams,
    loadReport,
    reportNote,
    // Layer 3
    rulesText,
    setRulesText,
    suggested,
    policy,
    evaluation,
    planOptions,
    setPlanOptions,
    plan,
    planning,
    runPlan,
    comparison: comparison && comparison.policy === policy ? comparison.rows : null,
    runComparison,
    step,
    setStep: (s: number) => {
      setPlaying(false);
      setStep(s);
    },
    playing,
    setPlaying,
    currentStep,
    violationsNow,
  };
}

export type Layers = ReturnType<typeof useLayers>;
