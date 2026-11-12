import path from "node:path";
import { describe, expect, it } from "vitest";
import { degrees, findCycles, findGodFiles } from "./analysis";
import { classifyFile, countLines, extractGraph, makeFileNode } from "./extract";
import { filterGraph } from "./insights";
import { autoFolderPartition, folderPartition, moduleGraph, modulesOf } from "./partition";
import type { DepGraph } from "./types";

function graphOf(edges: [string, string][], extraNodes: string[] = []): DepGraph {
  const ids = new Set(extraNodes);
  for (const [a, b] of edges) ids.add(a).add(b);
  return {
    root: "/tmp/x",
    nodes: [...ids].map(makeFileNode),
    edges: edges.map(([source, target]) => ({ source, target, typeOnly: false })),
  };
}

describe("findCycles", () => {
  it("finds no cycles in a DAG", () => {
    expect(findCycles(graphOf([["a", "b"], ["b", "c"], ["a", "c"]]))).toEqual([]);
  });

  it("finds separate cycles, largest first", () => {
    const g = graphOf([
      ["a", "b"], ["b", "a"],
      ["c", "d"], ["d", "e"], ["e", "c"],
      ["e", "f"],
    ]);
    expect(findCycles(g)).toEqual([["c", "d", "e"], ["a", "b"]]);
  });

  it("handles a long chain without overflowing the stack", () => {
    const edges: [string, string][] = [];
    for (let i = 0; i < 20000; i++) edges.push([`n${i}`, `n${i + 1}`]);
    edges.push(["n20000", "n0"]);
    expect(findCycles(graphOf(edges))[0]).toHaveLength(20001);
  });
});

describe("findGodFiles", () => {
  it("flags a file far more depended on than the rest", () => {
    const edges: [string, string][] = [];
    for (let i = 0; i < 10; i++) edges.push([`f${i}`, "utils"]);
    edges.push(["f0", "f1"], ["f2", "f3"]);
    const gods = findGodFiles(graphOf(edges));
    expect(gods.map((g) => g.id)).toEqual(["utils"]);
    expect(gods[0].fanIn).toBe(10);
  });

  it("flags nothing when dependencies are evenly spread", () => {
    expect(findGodFiles(graphOf([["a", "b"], ["b", "c"], ["c", "a"]]))).toEqual([]);
  });
});

describe("partition helpers", () => {
  const g = graphOf([
    ["ui/a.tsx", "ui/b.tsx"],
    ["ui/a.tsx", "data/db.ts"],
    ["ui/b.tsx", "data/db.ts"],
    ["main.ts", "ui/a.tsx"],
  ]);

  it("groups files by folder", () => {
    const p = folderPartition(g);
    expect(p["ui/a.tsx"]).toBe("ui");
    expect(p["main.ts"]).toBe("(root)");
    expect(modulesOf(p).get("ui")).toEqual(["ui/a.tsx", "ui/b.tsx"]);
  });

  it("aggregates imports into weighted module edges", () => {
    const { edges, internal } = moduleGraph(g, folderPartition(g));
    expect(internal.get("ui")).toBe(1);
    expect(edges).toContainEqual({ source: "ui", target: "data", weight: 2 });
    expect(edges).toContainEqual({ source: "(root)", target: "ui", weight: 1 });
  });
});

describe("extractGraph on fixtures/restaurant-app", () => {
  const sample = path.resolve(__dirname, "../../../fixtures/restaurant-app");

  it("resolves tsconfig path aliases and finds the planted smells", async () => {
    const { graph: full, warnings } = await extractGraph(sample);
    const g = filterGraph(full, new Set(["source"]));
    const has = (s: string, t: string) => g.edges.some((e) => e.source === s && e.target === t);

    expect(warnings).toEqual([]);
    expect(full.nodes.every((n) => n.loc > 0)).toBe(true);
    // Co-located *.test.ts files are kept in the graph (Layer 2 reads coverage from them) but classified.
    expect(full.nodes.filter((n) => n.role === "test")).toHaveLength(8);

    expect(g.nodes).toHaveLength(16);
    // "@/data/db" alias resolved: pages import the database directly.
    expect(has("src/pages/menu.tsx", "src/data/db.ts")).toBe(true);
    expect(has("src/pages/order.tsx", "src/data/db.ts")).toBe(true);
    // Type-only import is kept and marked.
    expect(g.edges.find((e) => e.source === "src/data/db.ts" && e.target === "src/data/schema.ts")?.typeOnly).toBe(true);

    expect(findCycles(g)).toEqual([["src/services/pricing.ts", "src/state/cartStore.ts"]]);
    expect(findGodFiles(g).map((f) => f.id)).toEqual(["src/lib/utils.ts"]);
    expect(degrees(g).get("src/lib/utils.ts")?.fanIn).toBe(7);
  });

  it("rejects a path that is not a directory", async () => {
    await expect(extractGraph(path.join(sample, "nope"))).rejects.toThrow(/Not a directory/);
  });
});

describe("classifyFile", () => {
  it.each([
    ["src/lib/db.ts", "source"],
    ["src/lib/db.test.ts", "test"],
    ["src/__tests__/db.ts", "test"],
    ["test-d/index.ts", "test"],
    ["src/Button.stories.tsx", "story"],
    ["examples/demo/src/App.tsx", "example"],
    ["docs/site.ts", "example"],
    ["next.config.ts", "config"],
    ["scripts/build.js", "config"],
    ["src/types/global.d.ts", "declaration"],
  ])("%s -> %s", (id, role) => {
    expect(classifyFile(id)).toBe(role);
  });

  it("counts non-blank lines", () => {
    expect(countLines("a\n\n  \nb\n")).toBe(2);
  });
});

describe("autoFolderPartition", () => {
  it("strips the shared prefix and labels modules relative to it", () => {
    const g = graphOf([["src/app/page.tsx", "src/lib/db.ts"], ["src/index.ts", "src/app/page.tsx"]]);
    const { partition, labels, prefix } = autoFolderPartition(g);
    expect(prefix).toBe("src");
    expect(partition["src/lib/db.ts"]).toBe("src/lib");
    expect(labels["src/lib"]).toBe("lib");
    expect(labels["src"]).toBe("src (top level)");
  });

  it("goes as deep as it can while staying under the module limit", () => {
    const g = graphOf([
      ["src/ui/forms/a.ts", "src/ui/buttons/b.ts"],
      ["src/data/x.ts", "src/data/y.ts"],
    ]);
    expect(Object.values(autoFolderPartition(g, 14).partition).sort()).toEqual(
      ["src/data", "src/data", "src/ui/buttons", "src/ui/forms"],
    );
    expect(new Set(Object.values(autoFolderPartition(g, 2).partition))).toEqual(new Set(["src/ui", "src/data"]));
  });

  it("handles files at the repository root", () => {
    const g = graphOf([["index.ts", "lib/a.ts"]]);
    const { partition, labels } = autoFolderPartition(g);
    expect(partition["index.ts"]).toBe("(root)");
    expect(labels["(root)"]).toBe("(root)");
  });
});
