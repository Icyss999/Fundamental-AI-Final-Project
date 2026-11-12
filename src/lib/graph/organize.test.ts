import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractGraph } from "./extract";
import { mainLinks, organize, rowsOf } from "./organize";
import { analyzeProject } from "./project-analysis";

describe("organizing the map", () => {
  it("puts the sample's shared parts on shelves and its loop side by side", async () => {
    const { graph } = await extractGraph(path.resolve(__dirname, "../../../samples/restaurant-app"));
    const a = analyzeProject(graph, "x", false);
    const label = (m: string) => a.labels[m];
    const org = organize([...a.modules.keys()], a.moduleEdges);
    expect(org.shelves.map(label)).toEqual(["data", "lib"]); // data uses lib, so it sits above it
    expect(org.pairs.map((p) => p.map(label).sort())).toEqual([["services", "state"]]);
    expect(Object.fromEntries([...org.uses].map(([m, s]) => [label(m), s.map(label)]))).toEqual({
      components: ["data", "lib"],
      pages: ["data", "lib"],
      services: ["data", "lib"],
      state: ["lib"],
    });
    expect(org.usedBy.get(org.shelves[1])!.map(label)).toEqual(["components", "data", "pages", "services", "state"]);
  });

  it("only shelves a part whose own imports stay on the shelves", () => {
    const e = (source: string, target: string) => ({ source, target });
    // "util" is used by everyone but imports "feature", which is not shared: it stays on the map.
    const org = organize(["app", "feature", "ui", "util"], [e("app", "util"), e("feature", "util"), e("ui", "util"), e("util", "feature"), e("app", "ui")]);
    expect(org.shelves).toEqual([]);
  });

  it("keeps small maps and at least two parts off the shelves", () => {
    const e = (source: string, target: string) => ({ source, target });
    expect(organize(["a", "b", "c"], [e("a", "c"), e("b", "c")]).shelves).toEqual([]);
    const org = organize(["a", "b", "c", "d"], [e("a", "c"), e("b", "c"), e("d", "c"), e("a", "d"), e("b", "d"), e("c", "d")]);
    expect(org.shelves.length).toBeLessThanOrEqual(2);
  });

  it("pairs each module at most once, heaviest loop first", () => {
    const e = (source: string, target: string, weight = 1) => ({ source, target, weight });
    const org = organize(["a", "b", "c"], [e("a", "b", 5), e("b", "a", 5), e("b", "c"), e("c", "b")]);
    expect(org.pairs).toEqual([["a", "b"]]);
  });
});

describe("main connections", () => {
  const e = (source: string, target: string, weight = 1) => ({ source, target, weight });

  it("leaves out an arrow told by a detour (transitive reduction)", () => {
    expect(mainLinks([e("a", "b"), e("b", "c"), e("a", "c")], { strength: 0 })).toEqual(new Set(["a\0c"]));
  });

  it("keeps a heavy arrow when the detour is too thin to stand in for it", () => {
    // a→c (10 imports) vs a→b→c where b→c is a single import: the direct arrow stays.
    expect(mainLinks([e("a", "b", 10), e("b", "c", 1), e("a", "c", 10)]).size).toBe(0);
    expect(mainLinks([e("a", "b", 10), e("b", "c", 6), e("a", "c", 10)])).toEqual(new Set(["a\0c"]));
  });

  it("keeps every part reachable from where it was", () => {
    const edges = [e("a", "b", 3), e("b", "c", 3), e("c", "a", 3), e("a", "c", 1), e("b", "a", 1)];
    const minor = mainLinks(edges, { strength: 0 });
    const kept = edges.filter((x) => !minor.has(`${x.source}\0${x.target}`));
    const reach = (from: string) => {
      const seen = new Set([from]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const x of kept) if (seen.has(x.source) && !seen.has(x.target)) grew = !!seen.add(x.target);
      }
      return seen;
    };
    for (const m of ["a", "b", "c"]) expect(reach(m)).toEqual(new Set(["a", "b", "c"]));
    expect(kept.length).toBe(3); // the heavy 3-cycle is enough
  });

  it("never leaves out a fixed arrow, but lets it stand in for others", () => {
    const minor = mainLinks([e("a", "b", 5), e("b", "a", 5), e("b", "c", 5), e("a", "c", 2)], { fixed: new Set(["a\0b", "b\0a"]) });
    expect(minor).toEqual(new Set(["a\0c"]));
  });

  it("leaves out arrows pointing up the map while both parts keep another arrow", () => {
    const edges = [e("top", "mid", 4), e("mid", "low", 4), e("low", "top", 9), e("low", "side", 1)];
    expect(mainLinks(edges, { against: new Set(["low\0top"]) })).toEqual(new Set(["low\0top"]));
    // Its only arrow: "lonely" keeps it, even though it points up.
    expect(mainLinks([e("top", "mid"), e("lonely", "top")], { against: new Set(["lonely\0top"]) }).size).toBe(0);
  });
});

describe("rows of the map", () => {
  const e = (source: string, target: string) => ({ source, target });

  it("puts each part one row below the lowest part that imports it", () => {
    const rows = rowsOf(["app", "ui", "db", "util"], [e("app", "ui"), e("ui", "util"), e("app", "db"), e("db", "util")]);
    expect(Object.fromEntries(rows)).toEqual({ app: 0, ui: 1, db: 1, util: 2 });
  });

  it("follows the tiers as bands, and a loop pair shares one row", () => {
    const rows = rowsOf(["pages", "store", "pricing", "data"], [e("pages", "store"), e("store", "pricing"), e("pricing", "store"), e("pricing", "data"), e("data", "pages")], [["store", "pricing"]], {
      pages: 0,
      store: 1,
      pricing: 2,
      data: 3,
    });
    expect(Object.fromEntries(rows)).toEqual({ pages: 0, store: 1, pricing: 1, data: 2 }); // data→pages points up: it pushes nothing
  });

  it("wraps a wide row and puts parts without arrows in a grid underneath", () => {
    const parts = ["root", "a", "b", "c", "d", "e", "x", "y"];
    const rows = rowsOf(parts, ["a", "b", "c", "d", "e"].map((t) => e("root", t)), [], undefined, 4);
    expect(rows.get("root")).toBe(0);
    expect(["a", "b", "c", "d", "e"].map((m) => rows.get(m)).sort()).toEqual([1, 1, 1, 1, 2]);
    expect([rows.get("x"), rows.get("y")]).toEqual([3, 3]);
  });

  it("gives the organiser's map rows and minor arrows together", () => {
    const org = organize(["a", "b", "c"], [e("a", "b"), e("b", "c"), e("a", "c")], { maxShelves: 0, simplify: true });
    expect(Object.fromEntries(org.rows)).toEqual({ a: 0, b: 1, c: 2 });
    expect(org.minor).toEqual(new Set(["a\0c"]));
    expect(organize(["a", "b", "c"], [e("a", "b"), e("b", "c"), e("a", "c")]).minor.size).toBe(0); // only when simplifying
  });
});
