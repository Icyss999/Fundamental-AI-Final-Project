/**
 * Phase 2's searches, written from scratch: hill climbing and simulated annealing over partitions
 * of the import graph, maximising TurboMQ (see mq.ts).
 *
 * Neighbourhood: move one file to another cluster. Only clusters the file has imports with, plus
 * one new empty cluster, can raise MQ (moving to an unrelated cluster only adds external weight
 * there), so those are the candidate moves.
 *
 *   Hill climbing: steepest ascent — apply the best improving move until none is left (a local
 *   optimum); restarted from random partitions, keeping the best optimum.
 *   Simulated annealing: random moves, worse ones accepted with probability e^(Δ/T); T starts where
 *   an average worsening move is accepted 80% of the time and cools geometrically. The best
 *   partition seen is then polished with hill climbing.
 */

import type { Partition } from "@/lib/graph/types";
import { ModularityState, turboMQ, type ClusterGraph } from "./mq";

export type ClusterAlgorithm = "hill-climbing" | "annealing";

export interface SearchOptions {
  algorithm: ClusterAlgorithm;
  /** Initial partition: one cluster per file (the classic Bunch start) or the folder grouping. */
  start: "singletons" | "folders";
  seed: number;
  /** Hill climbing: random restarts after the first climb. */
  restarts: number;
  /** Annealing: temperature multiplier per round of moves. */
  cooling: number;
  timeLimitMs: number;
}

export const DEFAULT_SEARCH: SearchOptions = { algorithm: "annealing", start: "singletons", seed: 42, restarts: 4, cooling: 0.95, timeLimitMs: 1500 };

export interface SearchStats {
  algorithm: ClusterAlgorithm;
  startMQ: number;
  /** Moves evaluated (annealing) or applied (hill climbing). */
  iterations: number;
  accepted: number;
  /** Worse moves accepted (annealing only). */
  uphill: number;
  restarts: number;
  ms: number;
  /** Best MQ so far, sampled through the search (for a convergence chart). */
  trace: number[];
}

/** Deterministic PRNG (mulberry32), so a seed reproduces a run. */
export function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Steepest-ascent hill climbing on `state` (in place). Returns the number of moves applied. */
export function hillClimb(state: ModularityState, deadline = Infinity): number {
  const n = state.graph.ids.length;
  let moves = 0;
  for (;;) {
    let best = { gain: 1e-12, v: -1, to: -1 };
    for (let v = 0; v < n; v++) {
      const links = state.links(v);
      const from = state.assignment[v];
      for (const to of [...links.keys(), state.freshCluster()]) {
        if (to === from) continue;
        const gain = state.delta(v, to, links);
        if (gain > best.gain) best = { gain, v, to };
      }
    }
    if (best.v < 0 || performance.now() > deadline) return moves;
    state.move(best.v, best.to);
    moves++;
  }
}

function randomAssignment(n: number, rng: () => number): number[] {
  const k = Math.max(1, Math.round(Math.sqrt(n)));
  return Array.from({ length: n }, () => Math.floor(rng() * k));
}

export function searchPartition(g: ClusterGraph, start: readonly number[], options: Partial<SearchOptions> = {}): { assignment: number[]; mq: number; stats: SearchStats } {
  const o = { ...DEFAULT_SEARCH, ...options };
  const rng = random(o.seed);
  const t0 = performance.now();
  const deadline = t0 + o.timeLimitMs;
  const n = g.ids.length;
  const startMQ = turboMQ(g, start);
  const stats: SearchStats = { algorithm: o.algorithm, startMQ, iterations: 0, accepted: 0, uphill: 0, restarts: 0, ms: 0, trace: [startMQ] };

  if (n < 2) {
    stats.ms = Math.round(performance.now() - t0);
    return { assignment: [...start], mq: startMQ, stats };
  }

  if (o.algorithm === "hill-climbing") {
    let best = new ModularityState(g, start);
    stats.iterations += hillClimb(best, deadline);
    stats.trace.push(best.mq);
    for (let r = 0; r < o.restarts && performance.now() < deadline; r++) {
      const s = new ModularityState(g, randomAssignment(n, rng));
      stats.iterations += hillClimb(s, deadline);
      stats.restarts++;
      if (s.mq > best.mq + 1e-12) best = s;
      stats.trace.push(best.mq);
    }
    stats.accepted = stats.iterations;
    stats.ms = Math.round(performance.now() - t0);
    return { assignment: [...best.assignment], mq: best.mq, stats };
  }

  // Simulated annealing.
  const state = new ModularityState(g, start);
  const pick = (): [number, number, Map<number, number>] => {
    const v = Math.floor(rng() * n);
    const links = state.links(v);
    const targets = [...links.keys(), state.freshCluster()].filter((c) => c !== state.assignment[v]);
    return [v, targets[Math.floor(rng() * targets.length)], links];
  };
  // Initial temperature from a sample of worsening moves: accept the average one with p = 0.8.
  let worse = 0;
  let count = 0;
  for (let i = 0; i < 200; i++) {
    const [v, to, links] = pick();
    const d = state.delta(v, to, links);
    if (d < 0) {
      worse -= d;
      count++;
    }
  }
  const t0Temp = count > 0 ? worse / count / -Math.log(0.8) : 0.01;
  let temperature = t0Temp;
  const perRound = Math.max(100, n * 2);
  const maxIterations = Math.min(600_000, n * 400);
  let best = [...state.assignment];
  let bestMQ = state.mq;
  for (let i = 0; i < maxIterations; i++) {
    const [v, to, links] = pick();
    const d = state.delta(v, to, links);
    stats.iterations++;
    if (d >= 0 || rng() < Math.exp(d / temperature)) {
      state.move(v, to, links);
      stats.accepted++;
      if (d < 0) stats.uphill++;
      if (state.mq > bestMQ + 1e-12) {
        bestMQ = state.mq;
        best = [...state.assignment];
      }
    }
    if ((i + 1) % perRound === 0) {
      temperature *= o.cooling;
      stats.trace.push(bestMQ);
      if (temperature < t0Temp * 1e-4 || performance.now() > deadline) break;
    }
  }
  const polished = new ModularityState(g, best);
  hillClimb(polished, deadline + 500);
  stats.trace.push(polished.mq);
  stats.ms = Math.round(performance.now() - t0);
  return { assignment: [...polished.assignment], mq: polished.mq, stats };
}

/**
 * Files with no imports either way score the same in any cluster; put each with most of its
 * folder-mates so it lands somewhere readable rather than as a lone cluster.
 */
export function placeIsolated(g: ClusterGraph, assignment: number[], folderOf: (file: string) => string): void {
  const byFolder = new Map<string, Map<number, number>>();
  g.ids.forEach((id, v) => {
    if (g.strength[v] === 0) return;
    const counts = byFolder.get(folderOf(id)) ?? new Map<number, number>();
    counts.set(assignment[v], (counts.get(assignment[v]) ?? 0) + 1);
    byFolder.set(folderOf(id), counts);
  });
  const isolated = new Map<string, number>();
  g.ids.forEach((id, v) => {
    if (g.strength[v] > 0) return;
    const counts = byFolder.get(folderOf(id));
    if (counts && counts.size > 0) assignment[v] = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    else {
      // A folder of only isolated files stays together.
      const key = folderOf(id);
      if (!isolated.has(key)) isolated.set(key, assignment[v]);
      assignment[v] = isolated.get(key)!;
    }
  });
}

/** Cluster numbers -> a Partition with ids "cluster-1".. ordered by size, largest first. */
export function toPartition(g: ClusterGraph, assignment: readonly number[]): Partition {
  const sizes = new Map<number, number>();
  for (const c of assignment) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  const order = [...sizes.keys()].sort((a, b) => sizes.get(b)! - sizes.get(a)! || a - b);
  const name = new Map(order.map((c, i) => [c, `cluster-${i + 1}`]));
  const partition: Partition = {};
  g.ids.forEach((id, v) => (partition[id] = name.get(assignment[v])!));
  return partition;
}
