import type { DepGraph, FileNode } from "@/lib/graph/types";
import {
  logBayesFactor,
  ochiai,
  posterior,
  ranks,
  reviewLogBayesFactor,
  riskPrior,
  type LikelihoodParams,
  type Outcome,
  type PriorEntry,
  type PriorParams,
  type ReviewParams,
  type TestEvidence,
} from "./bayes";
import { staticCoverage, testCases, type TestCoverage } from "./coverage";
import { fileHistory, type Commit, type FileHistory, type HistoryOptions, type HistorySummary } from "./history";

export interface DiagnosisParams extends PriorParams, LikelihoodParams, ReviewParams, HistoryOptions {
  /** Static coverage multiplier per extra import hop. */
  coverageDecay: number;
}

export const DEFAULT_DIAGNOSIS_PARAMS: DiagnosisParams = {
  halfLifeDays: 180,
  maxFilesPerCommit: 40,
  changeWeight: 0.15,
  priorStrength: 1,
  activation: 0.6,
  noise: 0.05,
  reviewRecall: 0.7,
  reviewFalseAlarm: 0.1,
  coverageDecay: 0.5,
};

/** A code review's verdicts: files read, and the flagged ones with their strongest severity (0..1]. */
export interface ReviewEvidence {
  reviewed: ReadonlySet<string>;
  flagged: ReadonlyMap<string, { weight: number; titles: string[] }>;
}

/** The parts of a diagnosis that do not depend on test outcomes or likelihood settings. */
export interface DiagnosisBasis {
  candidates: FileNode[];
  coverage: TestCoverage[];
  history: { perFile: Map<string, FileHistory>; summary: HistorySummary } | null;
}

export function prepareDiagnosis(
  fullGraph: DepGraph,
  candidates: readonly FileNode[],
  commits: readonly Commit[] | null,
  params: Pick<DiagnosisParams, "halfLifeDays" | "maxFilesPerCommit" | "coverageDecay">,
): DiagnosisBasis {
  const ids = new Set(candidates.map((c) => c.id));
  return {
    candidates: [...candidates],
    coverage: staticCoverage(fullGraph, testCases(fullGraph), ids, params.coverageDecay),
    history: commits ? fileHistory(commits, ids, params) : null,
  };
}

export interface TestFactor {
  test: string;
  outcome: Outcome;
  coverage: number;
  /** Import hops from the test to the file. */
  depth: number;
  /** ln of the Bayes factor this outcome contributes. */
  logBF: number;
}

export interface FileRisk {
  id: string;
  loc: number;
  prior: PriorEntry;
  posterior: number;
  logPosterior: number;
  rank: number;
  ochiai: number;
  ochiaiRank: number;
  history: FileHistory | null;
  /** Evidence from each test with a known outcome that covers the file, strongest first. */
  factors: TestFactor[];
  /** Test files (any outcome) that reach this file. */
  coveredBy: number;
  /** The code review's factor, if the file was reviewed. */
  review: { logBF: number; flagged: boolean; titles: string[] } | null;
}

export interface Diagnosis {
  /** Most suspicious first. */
  files: FileRisk[];
  byId: Map<string, FileRisk>;
  tests: { id: string; outcome: Outcome | null; covers: number }[];
  history: HistorySummary | null;
  failing: number;
  passing: number;
  maxPosterior: number;
}

export function scoreDiagnosis(
  basis: DiagnosisBasis,
  outcomes: ReadonlyMap<string, Outcome>,
  params: PriorParams & LikelihoodParams & Partial<ReviewParams>,
  review?: ReviewEvidence | null,
): Diagnosis {
  const { candidates, coverage } = basis;
  const prior = riskPrior(candidates, basis.history?.perFile ?? null, params);
  const evidence: TestEvidence[] = [];
  for (const t of coverage) {
    const outcome = outcomes.get(t.id);
    if (outcome) evidence.push({ id: t.id, outcome, coverage: t.coverage });
  }

  const reviewParams = { reviewRecall: params.reviewRecall ?? DEFAULT_DIAGNOSIS_PARAMS.reviewRecall, reviewFalseAlarm: params.reviewFalseAlarm ?? DEFAULT_DIAGNOSIS_PARAMS.reviewFalseAlarm };
  const reviewFactor = new Map<string, { logBF: number; flagged: boolean; titles: string[] }>();
  if (review) {
    for (const file of new Set([...review.reviewed, ...review.flagged.keys()])) {
      if (!prior.has(file)) continue;
      const flag = review.flagged.get(file);
      reviewFactor.set(file, { logBF: reviewLogBayesFactor(flag ? flag.weight : null, reviewParams), flagged: !!flag, titles: flag?.titles ?? [] });
    }
  }
  const post = posterior(
    new Map([...prior].map(([id, e]) => [id, e.p])),
    evidence,
    params,
    new Map([...reviewFactor].map(([f, r]) => [f, r.logBF])),
  );
  const och = ochiai(prior.keys(), evidence);
  const rank = ranks(new Map([...post].map(([id, p]) => [id, p.logPosterior])));
  const ochiaiRank = ranks(och);

  const factors = new Map<string, TestFactor[]>();
  const coveredBy = new Map<string, number>();
  for (const t of coverage) {
    const outcome = outcomes.get(t.id);
    for (const [file, c] of t.coverage) {
      coveredBy.set(file, (coveredBy.get(file) ?? 0) + 1);
      if (!outcome) continue;
      const list = factors.get(file) ?? [];
      list.push({ test: t.id, outcome, coverage: c, depth: t.depth.get(file) ?? 1, logBF: logBayesFactor(outcome, c, params) });
      factors.set(file, list);
    }
  }

  const files: FileRisk[] = candidates.map((n) => ({
    id: n.id,
    loc: n.loc,
    prior: prior.get(n.id)!,
    posterior: post.get(n.id)!.p,
    logPosterior: post.get(n.id)!.logPosterior,
    rank: rank.get(n.id)!,
    ochiai: och.get(n.id) ?? 0,
    ochiaiRank: ochiaiRank.get(n.id)!,
    history: basis.history?.perFile.get(n.id) ?? null,
    factors: (factors.get(n.id) ?? []).sort((a, b) => Math.abs(b.logBF) - Math.abs(a.logBF) || a.test.localeCompare(b.test)),
    coveredBy: coveredBy.get(n.id) ?? 0,
    review: reviewFactor.get(n.id) ?? null,
  }));
  files.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));

  return {
    files,
    byId: new Map(files.map((f) => [f.id, f])),
    tests: coverage.map((t) => ({ id: t.id, outcome: outcomes.get(t.id) ?? null, covers: t.coverage.size })),
    history: basis.history?.summary ?? null,
    failing: evidence.filter((e) => e.outcome === "fail").length,
    passing: evidence.filter((e) => e.outcome === "pass").length,
    maxPosterior: files.reduce((m, f) => Math.max(m, f.posterior), 0),
  };
}
