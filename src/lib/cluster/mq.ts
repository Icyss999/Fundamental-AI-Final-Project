/**
 * Phase 2's objective, written from scratch: Modularization Quality (TurboMQ, Mitchell & Mancoridis).
 *
 * For a partition of the import graph into clusters, each cluster i has
 *   μ_i  = weight of imports with both ends inside i
 *   ε_i  = weight of imports with exactly one end inside i (either direction)
 *   CF_i = 2μ_i / (2μ_i + ε_i)   (0 when μ_i = 0)
 * and MQ = Σ_i CF_i. High MQ means cohesive clusters with few imports between them; it is not
 * bounded by 1 (it grows with the number of good clusters), so it rewards splitting only where
 * the graph really has seams.
 *
 * Imports are weighted 1, type-only imports 0.5 (they couple files less). The graph is stored
 * with integer node indices and undirected adjacency (MQ only counts an edge's ends), so a move
 * of one file is scored in O(degree) by `ModularityState.delta`.
 */

import type { DepGraph } from "@/lib/graph/types";

export const TYPE_ONLY_WEIGHT = 0.5;

export interface ClusterGraph {
  /** File id per node index. */
  ids: string[];
  index: Map<string, number>;
  /** Undirected neighbours with summed weights (self-imports dropped). */
  adj: { node: number; weight: number }[][];
  /** Total incident weight per node. */
  strength: number[];
}

export function clusterGraph(graph: DepGraph, files?: readonly string[]): ClusterGraph {
  const ids = files ? [...files] : graph.nodes.map((n) => n.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const weights = ids.map(() => new Map<number, number>());
  for (const e of graph.edges) {
    const a = index.get(e.source);
    const b = index.get(e.target);
    if (a === undefined || b === undefined || a === b) continue;
    const w = e.typeOnly ? TYPE_ONLY_WEIGHT : 1;
    weights[a].set(b, (weights[a].get(b) ?? 0) + w);
    weights[b].set(a, (weights[b].get(a) ?? 0) + w);
  }
  const adj = weights.map((m) => [...m].map(([node, weight]) => ({ node, weight })));
  return { ids, index, adj, strength: adj.map((list) => list.reduce((s, x) => s + x.weight, 0)) };
}

const cf = (intra: number, inter: number) => (intra > 0 ? (2 * intra) / (2 * intra + inter) : 0);

/** MQ of an assignment (cluster number per node index), computed from scratch. */
export function turboMQ(g: ClusterGraph, assignment: readonly number[]): number {
  const intra = new Map<number, number>();
  const inter = new Map<number, number>();
  for (let a = 0; a < g.adj.length; a++) {
    for (const { node: b, weight } of g.adj[a]) {
      if (b < a) continue; // each undirected edge once
      const ca = assignment[a];
      const cb = assignment[b];
      if (ca === cb) intra.set(ca, (intra.get(ca) ?? 0) + weight);
      else {
        inter.set(ca, (inter.get(ca) ?? 0) + weight);
        inter.set(cb, (inter.get(cb) ?? 0) + weight);
      }
    }
  }
  let mq = 0;
  for (const c of new Set(assignment)) mq += cf(intra.get(c) ?? 0, inter.get(c) ?? 0);
  return mq;
}

/**
 * A partition being searched: per-cluster μ and ε kept up to date, so moving one file is
 * scored and applied without recomputing MQ.
 */
export class ModularityState {
  readonly assignment: number[];
  private intra = new Map<number, number>();
  private inter = new Map<number, number>();
  private sizes = new Map<number, number>();
  private nextCluster: number;
  mq: number;

  constructor(
    readonly graph: ClusterGraph,
    assignment: readonly number[],
  ) {
    this.assignment = [...assignment];
    for (const c of this.assignment) this.sizes.set(c, (this.sizes.get(c) ?? 0) + 1);
    for (let a = 0; a < graph.adj.length; a++) {
      for (const { node: b, weight } of graph.adj[a]) {
        if (b < a) continue;
        const ca = this.assignment[a];
        const cb = this.assignment[b];
        if (ca === cb) this.intra.set(ca, (this.intra.get(ca) ?? 0) + weight);
        else {
          this.inter.set(ca, (this.inter.get(ca) ?? 0) + weight);
          this.inter.set(cb, (this.inter.get(cb) ?? 0) + weight);
        }
      }
    }
    this.nextCluster = Math.max(-1, ...this.assignment) + 1;
    this.mq = 0;
    for (const c of this.sizes.keys()) this.mq += this.cf(c);
  }

  private cf(c: number): number {
    return cf(this.intra.get(c) ?? 0, this.inter.get(c) ?? 0);
  }

  get clusterCount(): number {
    return this.sizes.size;
  }

  /** An id for a new, empty cluster. */
  freshCluster(): number {
    return this.nextCluster;
  }

  /** Weight from node v to each cluster it touches. */
  links(v: number): Map<number, number> {
    const out = new Map<number, number>();
    for (const { node, weight } of this.graph.adj[v]) {
      const c = this.assignment[node];
      out.set(c, (out.get(c) ?? 0) + weight);
    }
    return out;
  }

  /** Change in MQ if v moved to cluster `to` (`links` = this.links(v), passed to share work). */
  delta(v: number, to: number, links = this.links(v)): number {
    const from = this.assignment[v];
    if (from === to) return 0;
    const s = this.graph.strength[v];
    const wFrom = links.get(from) ?? 0;
    const wTo = links.get(to) ?? 0;
    const fromIntra = this.intra.get(from) ?? 0;
    const fromInter = this.inter.get(from) ?? 0;
    const toIntra = this.intra.get(to) ?? 0;
    const toInter = this.inter.get(to) ?? 0;
    // v leaves `from`: its edges into `from` become external; its edges elsewhere stop touching it.
    const before = cf(fromIntra, fromInter) + cf(toIntra, toInter);
    const after = cf(fromIntra - wFrom, fromInter - (s - wFrom) + wFrom) + cf(toIntra + wTo, toInter - wTo + (s - wTo));
    return after - before;
  }

  move(v: number, to: number, links = this.links(v)) {
    const from = this.assignment[v];
    if (from === to) return;
    const d = this.delta(v, to, links);
    const s = this.graph.strength[v];
    const wFrom = links.get(from) ?? 0;
    const wTo = links.get(to) ?? 0;
    this.intra.set(from, (this.intra.get(from) ?? 0) - wFrom);
    this.inter.set(from, (this.inter.get(from) ?? 0) - (s - wFrom) + wFrom);
    this.intra.set(to, (this.intra.get(to) ?? 0) + wTo);
    this.inter.set(to, (this.inter.get(to) ?? 0) - wTo + (s - wTo));
    this.assignment[v] = to;
    this.sizes.set(to, (this.sizes.get(to) ?? 0) + 1);
    const left = (this.sizes.get(from) ?? 1) - 1;
    if (left === 0) {
      this.sizes.delete(from);
      this.intra.delete(from);
      this.inter.delete(from);
    } else this.sizes.set(from, left);
    if (to >= this.nextCluster) this.nextCluster = to + 1;
    this.mq += d;
  }
}
