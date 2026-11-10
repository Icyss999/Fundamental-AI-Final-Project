/**
 * Layer 2's scoring, written from scratch.
 *
 * Hypotheses: h_f = "the bug is in file f", exactly one file is faulty (single-fault assumption).
 *
 *   P(h_f | outcomes) ∝ P(h_f) · Π_t P(outcome_t | h_f)
 *
 * Prior P(h_f) — Gamma–Poisson model of git history. Each file has a bug rate μ_f; its count of
 * (recency-weighted) bug-fix commits is Poisson(μ_f). With a Gamma prior whose mean scales with
 * the file's size (bigger files have more room for bugs), the posterior mean is
 *
 *   λ_f = (κ·m·s_f + b_f) / (κ + 1)
 *
 * where b_f is the file's bug evidence (fix commits + ω × other changes), m the mean evidence per
 * file, s_f = √lines relative to the average file, and κ how many "pseudo-windows" of history the
 * size-based guess is worth. If every file's bug count is Poisson(λ_f), then given exactly one bug,
 * it sits in f with probability λ_f / Σλ — which is the prior used.
 *
 * Likelihood — each test file t has an outcome and covers f with strength c ∈ [0,1]. If f is the
 * faulty file, the test fails with probability
 *
 *   P(fail | h_f) = c·α + (1 − c·α)·ε
 *
 * α ("activation"): chance that running faulty code makes the test fail; ε ("noise"): chance it
 * fails anyway (another bug, flakiness, coverage the static analysis missed).
 *
 * All products are sums of logs, normalised with log-sum-exp, so hundreds of tests never underflow.
 * Dividing every hypothesis' likelihood by the same constant Π_t P(outcome_t | c = 0) leaves the
 * normalised posterior unchanged, so each test enters only through the files it covers, as a
 * Bayes factor relative to "not covered":
 *
 *   BF_t(f) = P(outcome_t | h_f, c) / P(outcome_t | h_f, c = 0)
 *
 * Posterior ∝ prior × Π BF. The same factors are what "why suspected" shows.
 */

import type { FileHistory } from "./history";

export type Outcome = "pass" | "fail";

export interface PriorParams {
  /** Weight of an ordinary (non-fix) change relative to a bug fix, ω. */
  changeWeight: number;
  /** Strength of the size-based baseline, in units of observed history, κ. */
  priorStrength: number;
}

export interface LikelihoodParams {
  /** α: P(test fails | it runs the faulty file). */
  activation: number;
  /** ε: P(test fails | it does not run the faulty file). */
  noise: number;
}

export interface PriorEntry {
  /** Normalised prior probability. */
  p: number;
  /** Expected bug count λ = sizePart + historyPart. */
  lambda: number;
  sizePart: number;
  historyPart: number;
}

export function riskPrior(
  files: readonly { id: string; loc: number }[],
  history: ReadonlyMap<string, FileHistory> | null,
  { changeWeight, priorStrength }: PriorParams,
): Map<string, PriorEntry> {
  const result = new Map<string, PriorEntry>();
  if (files.length === 0) return result;

  const size = files.map((f) => Math.sqrt(Math.max(1, f.loc)));
  const meanSize = size.reduce((a, b) => a + b, 0) / size.length;
  const evidence = files.map((f) => {
    const h = history?.get(f.id);
    return h ? h.weightedFixes + changeWeight * (h.weightedChanges - h.weightedFixes) : 0;
  });
  const meanEvidence = evidence.reduce((a, b) => a + b, 0) / evidence.length;
  // With no history at all the size baseline alone decides (any positive m gives the same ratios).
  const m = meanEvidence > 0 ? meanEvidence : 1;

  let total = 0;
  files.forEach((f, i) => {
    const sizePart = (priorStrength * m * (size[i] / meanSize)) / (priorStrength + 1);
    const historyPart = evidence[i] / (priorStrength + 1);
    const lambda = sizePart + historyPart;
    total += lambda;
    result.set(f.id, { p: 0, lambda, sizePart, historyPart });
  });
  for (const entry of result.values()) entry.p = entry.lambda / total;
  return result;
}

export function pFail(coverage: number, { activation, noise }: LikelihoodParams): number {
  const run = coverage * activation;
  return run + (1 - run) * noise;
}

/** ln BF: how much one test outcome shifts the odds that a file it covers (with strength c) is faulty. */
export function logBayesFactor(outcome: Outcome, coverage: number, params: LikelihoodParams): number {
  const covered = pFail(coverage, params);
  const uncovered = pFail(0, params);
  return outcome === "fail" ? Math.log(covered / uncovered) : Math.log((1 - covered) / (1 - uncovered));
}

export interface TestEvidence {
  id: string;
  outcome: Outcome;
  /** File id -> coverage strength in (0, 1]; files not listed are not covered. */
  coverage: ReadonlyMap<string, number>;
}

export function logSumExp(values: readonly number[]): number {
  let max = -Infinity;
  for (const v of values) if (v > max) max = v;
  if (max === -Infinity) return -Infinity;
  let sum = 0;
  for (const v of values) sum += Math.exp(v - max);
  return max + Math.log(sum);
}

/** Posterior over files; tests with no outcome are simply left out of `tests`. */
export function posterior(
  prior: ReadonlyMap<string, number>,
  tests: readonly TestEvidence[],
  params: LikelihoodParams,
): Map<string, { logPosterior: number; p: number }> {
  const logPost = new Map<string, number>();
  for (const [file, p] of prior) logPost.set(file, Math.log(p));
  for (const t of tests) {
    for (const [file, c] of t.coverage) {
      const current = logPost.get(file);
      if (current !== undefined) logPost.set(file, current + logBayesFactor(t.outcome, c, params));
    }
  }
  const z = logSumExp([...logPost.values()]);
  const result = new Map<string, { logPosterior: number; p: number }>();
  for (const [file, lp] of logPost) result.set(file, { logPosterior: lp - z, p: Math.exp(lp - z) });
  return result;
}

/**
 * Ochiai suspiciousness, the standard spectrum-based baseline:
 *   ef / √((ef + nf) · (ef + ep))
 * ef/ep: failing/passing tests that cover the file; nf: failing tests that do not.
 * Coverage is binary here (any strength > 0 counts), as in the original formula.
 */
export function ochiai(files: Iterable<string>, tests: readonly TestEvidence[]): Map<string, number> {
  const totalFailed = tests.filter((t) => t.outcome === "fail").length;
  const result = new Map<string, number>();
  for (const file of files) {
    let ef = 0;
    let ep = 0;
    for (const t of tests) {
      if (!t.coverage.has(file)) continue;
      if (t.outcome === "fail") ef++;
      else ep++;
    }
    const denominator = Math.sqrt(totalFailed * (ef + ep));
    result.set(file, denominator === 0 ? 0 : ef / denominator);
  }
  return result;
}

/** 1-based ranks by descending score; ties share the best rank ("1, 2, 2, 4"). */
export function ranks(scores: ReadonlyMap<string, number>): Map<string, number> {
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const result = new Map<string, number>();
  sorted.forEach(([file, score], i) => {
    const prev = sorted[i - 1];
    result.set(file, prev && prev[1] === score ? result.get(prev[0])! : i + 1);
  });
  return result;
}
