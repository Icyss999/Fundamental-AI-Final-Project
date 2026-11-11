import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractGraph } from "@/lib/graph/extract";
import { analyzeProject } from "@/lib/graph/project-analysis";
import type { DepGraph } from "@/lib/graph/types";
import { architectureGrouping, clusterProject, partitionMQ } from "./grouping";
import { clusterGraph, ModularityState, turboMQ } from "./mq";
import { random, searchPartition } from "./search";

function graph(edges: [string, string][], extra: string[] = []): DepGraph {
  const ids = [...new Set([...edges.flat(), ...extra])];
  return {
    root: "/",
    nodes: ids.map((id) => ({ id, dir: "", name: id, role: "source" as const, loc: 10 })),
    edges: edges.map(([source, target]) => ({ source, target, typeOnly: false })),
  };
}

// Two triangles joined by one import: the obvious modules are {a,b,c} and {x,y,z}.
const twoTriangles = graph([
  ["a", "b"],
  ["b", "c"],
  ["c", "a"],
  ["x", "y"],
  ["y", "z"],
  ["z", "x"],
  ["c", "x"],
]);

describe("TurboMQ", () => {
  it("scores cohesive clusters with few links between them highest", () => {
    const g = clusterGraph(twoTriangles);
    const at = (groups: Record<string, number>) => g.ids.map((id) => groups[id]);
    // Each triangle: μ = 3, ε = 1 → CF = 6/7.
    expect(turboMQ(g, at({ a: 0, b: 0, c: 0, x: 1, y: 1, z: 1 }))).toBeCloseTo(12 / 7, 10);
    // Everything together: no external edges → CF = 1.
    expect(turboMQ(g, at({ a: 0, b: 0, c: 0, x: 0, y: 0, z: 0 }))).toBeCloseTo(1, 10);
    // Singletons have no internal edges → 0.
    expect(turboMQ(g, g.ids.map((_, i) => i))).toBe(0);
  });

  it("weighs type-only imports half", () => {
    const g = clusterGraph({ ...twoTriangles, edges: twoTriangles.edges.map((e) => (e.source === "c" && e.target === "x" ? { ...e, typeOnly: true } : e)) });
    expect(turboMQ(g, g.ids.map((id) => ("abc".includes(id) ? 0 : 1)))).toBeCloseTo(2 * (6 / 6.5), 10);
  });

  it("scores single moves incrementally exactly as a full recomputation", () => {
    const rng = random(7);
    const ids = Array.from({ length: 30 }, (_, i) => `f${i}`);
    const edges: [string, string][] = [];
    for (let i = 0; i < 90; i++) edges.push([ids[Math.floor(rng() * 30)], ids[Math.floor(rng() * 30)]]);
    const g = clusterGraph(graph(edges, ids));
    const state = new ModularityState(g, ids.map(() => Math.floor(rng() * 5)));
    for (let step = 0; step < 300; step++) {
      const v = Math.floor(rng() * 30);
      const to = rng() < 0.1 ? state.freshCluster() : Math.floor(rng() * 6);
      const predicted = state.mq + state.delta(v, to);
      state.move(v, to);
      expect(state.mq).toBeCloseTo(predicted, 9);
      expect(state.mq).toBeCloseTo(turboMQ(g, state.assignment), 9);
    }
  });
});

describe("searching for modules", () => {
  const g = clusterGraph(twoTriangles);
  const split = (assignment: number[]) => {
    const groups = new Map<number, string[]>();
    g.ids.forEach((id, i) => groups.set(assignment[i], [...(groups.get(assignment[i]) ?? []), id]));
    return [...groups.values()].map((m) => m.sort().join("")).sort();
  };

  it("hill climbing finds the two triangles from singletons", () => {
    const r = searchPartition(g, g.ids.map((_, i) => i), { algorithm: "hill-climbing" });
    expect(split(r.assignment)).toEqual(["abc", "xyz"]);
    expect(r.mq).toBeCloseTo(12 / 7, 10);
    expect(r.stats.trace.every((v, i, t) => i === 0 || v >= t[i - 1] - 1e-12)).toBe(true);
  });

  it("annealing finds them too, and a seed reproduces the run", () => {
    const a = searchPartition(g, g.ids.map((_, i) => i), { algorithm: "annealing", seed: 3 });
    const b = searchPartition(g, g.ids.map((_, i) => i), { algorithm: "annealing", seed: 3 });
    expect(split(a.assignment)).toEqual(["abc", "xyz"]);
    expect(a.assignment).toEqual(b.assignment);
    expect(a.stats.uphill).toBeGreaterThan(0);
  });

  it("on the sample, beats the folder grouping and names clusters after their folders", async () => {
    const { graph: full } = await extractGraph(path.resolve(__dirname, "../../../samples/restaurant-app"));
    const a = analyzeProject(full, "restaurant-app", false);
    for (const algorithm of ["annealing", "hill-climbing"] as const) {
      const run = clusterProject(a.graph, a, { algorithm });
      expect(Object.keys(run.grouping.partition).sort()).toEqual(a.graph.nodes.map((n) => n.id).sort());
      expect(run.grouping.mq).toBeGreaterThanOrEqual(run.folderMQ);
      expect(run.grouping.mq).toBeCloseTo(partitionMQ(a.graph, run.grouping.partition), 9);
      expect(Object.values(run.grouping.labels).every((l) => l.length > 0)).toBe(true);
    }
  });

  it("keeps files without imports next to their folder-mates", () => {
    const iso = graph([["a", "b"]], ["c"]);
    iso.nodes = iso.nodes.map((n) => ({ ...n, dir: n.id === "x" ? "other" : "lib" }));
    const run = clusterProject(iso, { partition: { a: "lib", b: "lib", c: "lib" }, labels: { lib: "lib" } });
    expect(run.grouping.partition.c).toBe(run.grouping.partition.a);
  });

  it("turns an AI architecture into a grouping with names, purposes and tiers", () => {
    const grouping = architectureGrouping(twoTriangles, [
      { name: "Left", purpose: "the a-b-c loop", tier: 0, files: ["a", "b", "c"] },
      { name: "Right", purpose: "the x-y-z loop", tier: 1, files: ["x", "y", "z"] },
    ]);
    expect(grouping).toMatchObject({ kind: "ai", labels: { "ai-1": "Left", "ai-2": "Right" }, tiers: { "ai-1": 0, "ai-2": 1 } });
    expect(grouping.mq).toBeCloseTo(12 / 7, 10);
  });
});
