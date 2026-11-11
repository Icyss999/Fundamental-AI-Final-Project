"use client";

import { useEffect, useMemo, useState } from "react";
import type { AnalysisResult } from "@/lib/analyze";
import { compareSearches, type SearchComparison } from "@/lib/change/describe";
import { planRefactoring, type Heuristic, type PlanResult, type PlanStep } from "@/lib/change/planner";
import { Policy, suggestRules } from "@/lib/change/rules";
import type { Outcome } from "@/lib/diagnose/bayes";
import { DEFAULT_DIAGNOSIS_PARAMS, prepareDiagnosis, scoreDiagnosis, type DiagnosisParams } from "@/lib/diagnose/diagnose";
import { parseTestReport, ReportError } from "@/lib/diagnose/reports";
import { reviewEvidence, type Review } from "@/lib/diagnose/review";
import type { ProjectAnalysis } from "@/lib/graph/project-analysis";
import { importKey } from "@/lib/graph/types";

export interface ReportNote {
  tone: "ok" | "error";
  text: string;
}

export type Comparison = SearchComparison;

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
  /** The last report loaded (its failure messages are evidence the assistant can read). */
  const [report, setReport] = useState<{ name: string; text: string } | null>(null);
  const { halfLifeDays, maxFilesPerCommit, coverageDecay } = params;
  const basis = useMemo(
    () => prepareDiagnosis(data.graph, analysis.graph.nodes, data.history?.commits ?? null, { halfLifeDays, maxFilesPerCommit, coverageDecay }),
    [data, analysis, halfLifeDays, maxFilesPerCommit, coverageDecay],
  );
  /** The AI's code review; its verdicts count as Bayes evidence while `useReview` is on. */
  const [review, setReview] = useState<Review | null>(null);
  const [useReview, setUseReview] = useState(true);
  const evidence = useMemo(() => (review && useReview ? reviewEvidence(review) : null), [review, useReview]);
  const diagnosis = useMemo(() => scoreDiagnosis(basis, outcomes, params, evidence), [basis, outcomes, params, evidence]);
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
      setReport({ name, text });
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
  const [planned, setPlanned] = useState<{ result: PlanResult; rules: string } | null>(null);
  const [comparison, setComparison] = useState<{ rows: Comparison[]; rules: string } | null>(null);
  const [planning, setPlanning] = useState(false);
  const [stepState, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  // A plan belongs to the rules it was made for; editing the rules retires it.
  const plan = planned && planned.rules === rulesText ? planned.result : null;
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
      setPlanned({ result, rules: rulesText });
      setStep(0);
      setPlanning(false);
    }, 30);
  };

  const runComparison = () => {
    setPlanning(true);
    setTimeout(() => {
      setComparison({ rows: compareSearches(problem(), planOptions.riskWeight), rules: rulesText });
      setPlanning(false);
    }, 30);
  };

  /** Shows a plan computed elsewhere (the assistant) for `rules`, from its first step. */
  const adoptPlan = (result: PlanResult, rules: string) => {
    setPlaying(false);
    setPlanned({ result, rules });
    setStep(0);
  };

  const adoptComparison = (rows: Comparison[], rules: string) => setComparison({ rows, rules });

  /** Code changes the AI wrote for plan steps (1-based), kept with the plan they belong to. */
  const [patchSet, setPatchSet] = useState<{ plan: PlanResult; byStep: ReadonlyMap<number, { diff: string; note?: string }> } | null>(null);
  const patches = patchSet && plan && patchSet.plan === plan ? patchSet.byStep : null;
  const attachPatch = (forPlan: PlanResult, step: number, diff: string, note?: string) =>
    setPatchSet((prev) => ({ plan: forPlan, byStep: new Map(prev?.plan === forPlan ? prev.byStep : []).set(step, { diff, note }) }));

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
    basis,
    diagnosis,
    outcomes,
    setOutcome,
    setOutcomes,
    params,
    setParams,
    loadReport,
    reportNote,
    report,
    review,
    setReview,
    useReview,
    setUseReview,
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
    comparison: comparison && comparison.rules === rulesText ? comparison.rows : null,
    runComparison,
    adoptPlan,
    adoptComparison,
    patches,
    attachPatch,
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
