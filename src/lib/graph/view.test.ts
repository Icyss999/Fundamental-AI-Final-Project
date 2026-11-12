import { describe, expect, it } from "vitest";
import { makeFileNode } from "./extract";
import { folderPartition } from "./partition";
import type { DepGraph } from "./types";
import { buildView } from "./view";

const graph: DepGraph = {
  root: "/x",
  nodes: ["ui/a.tsx", "ui/b.tsx", "data/db.ts", "data/schema.ts"].map(makeFileNode),
  edges: [
    { source: "ui/a.tsx", target: "ui/b.tsx", typeOnly: false },
    { source: "ui/a.tsx", target: "data/db.ts", typeOnly: false },
    { source: "ui/b.tsx", target: "data/db.ts", typeOnly: false },
    { source: "ui/b.tsx", target: "data/schema.ts", typeOnly: true },
    { source: "data/db.ts", target: "data/schema.ts", typeOnly: true },
  ],
};
const partition = folderPartition(graph);

describe("buildView", () => {
  it("shows one box per module and merges cross-module imports when collapsed", () => {
    const { nodes, edges } = buildView(graph, partition, new Set(), [], new Set());
    expect(nodes.map((n) => [n.id, n.kind])).toEqual([
      ["m:data", "module"],
      ["m:ui", "module"],
    ]);
    expect(edges).toEqual([
      {
        id: "m:ui->m:data",
        source: "m:ui",
        target: "m:data",
        weight: 3,
        inCycle: false,
        typeOnly: false,
        members: ["ui/a.tsx\0data/db.ts", "ui/b.tsx\0data/db.ts", "ui/b.tsx\0data/schema.ts"],
      },
    ]);
  });

  it("puts files inside a group when their module is expanded", () => {
    const { nodes, edges } = buildView(graph, partition, new Set(["ui"]), [], new Set(["data/db.ts"]));
    expect(nodes.find((n) => n.id === "m:ui")?.kind).toBe("group");
    expect(nodes.find((n) => n.id === "f:ui/a.tsx")?.parent).toBe("m:ui");
    expect(nodes.find((n) => n.id === "f:ui/a.tsx")?.label).toBe("a.tsx");
    expect(nodes.find((n) => n.id === "m:data")?.god).toBe(true);
    const ids = edges.map((e) => e.id).sort();
    expect(ids).toEqual(["f:ui/a.tsx->f:ui/b.tsx", "f:ui/a.tsx->m:data", "f:ui/b.tsx->m:data", "m:ui->m:data"]);
    // Opening ui keeps the part-level arrow; each file's own arrows across parts are details, drawn on focus.
    expect(edges.find((e) => e.id === "m:ui->m:data")).toMatchObject({ weight: 3 });
    expect(edges.find((e) => e.id === "m:ui->m:data")?.detail).toBeUndefined();
    // b imports db (value) and schema (type) -> merged edge is not type-only.
    expect(edges.find((e) => e.id === "f:ui/b.tsx->m:data")).toMatchObject({ weight: 2, typeOnly: false, minor: true, detail: true });
  });

  it("marks only edges between files of the same cycle", () => {
    const cyclic: DepGraph = {
      ...graph,
      edges: [...graph.edges, { source: "data/db.ts", target: "ui/b.tsx", typeOnly: false }],
    };
    const { edges } = buildView(cyclic, partition, new Set(["ui", "data"]), [["data/db.ts", "ui/b.tsx"]], new Set());
    const cycleEdges = edges.filter((e) => e.inCycle && !e.detail).map((e) => e.id).sort();
    expect(cycleEdges).toEqual(["m:data->m:ui", "m:ui->m:data"]);
    const cycleDetails = edges.filter((e) => e.inCycle && e.detail).map((e) => e.id).sort();
    expect(cycleDetails).toEqual(["f:data/db.ts->f:ui/b.tsx", "f:ui/b.tsx->f:data/db.ts"]);
  });
});
