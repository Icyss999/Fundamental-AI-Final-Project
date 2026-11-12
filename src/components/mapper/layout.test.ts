import { describe, expect, it } from "vitest";
import type { ViewNode } from "@/lib/graph/view";
import { layoutView, wrapEdges } from "./layout";

const base = { fileCount: 1, loc: 10, color: 0, god: false, inCycle: false };
const viewNodes: ViewNode[] = [
  { id: "m:ui", kind: "group", label: "ui", module: "ui", ...base, fileCount: 2 },
  { id: "f:ui/a.tsx", kind: "file", label: "a.tsx", module: "ui", file: "ui/a.tsx", parent: "m:ui", ...base },
  { id: "f:ui/b.tsx", kind: "file", label: "b.tsx", module: "ui", file: "ui/b.tsx", parent: "m:ui", ...base },
  { id: "m:data", kind: "module", label: "data", module: "data", ...base },
];

describe("layoutView", () => {
  it("places files inside their expanded module and routes every edge", async () => {
    const { boxes, routes, absolute } = await layoutView(viewNodes, [
      { id: "e1", source: "f:ui/a.tsx", target: "f:ui/b.tsx", weight: 1, inCycle: false, typeOnly: false, members: [] },
      { id: "e2", source: "f:ui/b.tsx", target: "m:data", weight: 1, inCycle: false, typeOnly: false, members: [] },
    ]);
    const group = boxes.get("m:ui")!;
    for (const id of ["f:ui/a.tsx", "f:ui/b.tsx"]) {
      const f = boxes.get(id)!;
      // Child coordinates are relative to the group and fit inside it.
      expect(f.x).toBeGreaterThanOrEqual(0);
      expect(f.y).toBeGreaterThanOrEqual(0);
      expect(f.x + f.width).toBeLessThanOrEqual(group.width);
      expect(f.y + f.height).toBeLessThanOrEqual(group.height);
    }
    // Routes are absolute: the a -> b route starts on a's border and ends on b's.
    const route = routes.get("e1")!;
    const a = { ...boxes.get("f:ui/a.tsx")!, ...absolute.get("f:ui/a.tsx")! };
    const b = { ...boxes.get("f:ui/b.tsx")!, ...absolute.get("f:ui/b.tsx")! };
    const onBorder = (p: { x: number; y: number }, r: typeof a) =>
      p.x >= r.x - 1 && p.x <= r.x + r.width + 1 && p.y >= r.y - 1 && p.y <= r.y + r.height + 1;
    expect(onBorder(route[0], a)).toBe(true);
    expect(onBorder(route[route.length - 1], b)).toBe(true);
    expect(routes.has("e2")).toBe(true);
    // The group is wide enough for its header but not padded with empty space below its files.
    expect(group.width).toBeGreaterThanOrEqual(230);
    expect(group.height).toBeLessThan(200);
  });
});

describe("organised layout", () => {
  const mod = (id: string): ViewNode => ({ id: `m:${id}`, kind: "module", label: id, module: id, ...base });
  const edge = (a: string, b: string) => ({ id: `m:${a}->m:${b}`, source: `m:${a}`, target: `m:${b}`, weight: 1, inCycle: false, typeOnly: false, members: [] });

  it("puts shelves under the map, full width and in order, and keeps a loop pair side by side", async () => {
    const nodes = ["pages", "components", "state", "services", "data", "lib"].map(mod);
    const edges = [edge("pages", "components"), edge("pages", "state"), edge("pages", "services"), edge("components", "state"), edge("state", "services"), edge("services", "state"), edge("pages", "data"), edge("pages", "lib"), edge("data", "lib")];
    const { boxes, routes } = await layoutView(nodes, edges, { shelves: ["data", "lib"], pairs: [["services", "state"]] });
    const b = (id: string) => boxes.get(`m:${id}`)!;
    const mapBottom = Math.max(...["pages", "components", "state", "services"].map((m) => b(m).y + b(m).height));
    const mapLeft = Math.min(...["pages", "components", "state", "services"].map((m) => b(m).x));
    const mapRight = Math.max(...["pages", "components", "state", "services"].map((m) => b(m).x + b(m).width));
    // Shelves: below everything on the map, as wide as the map, data above lib.
    expect(b("data").y).toBeGreaterThan(mapBottom);
    expect(b("lib").y).toBeGreaterThan(b("data").y + b("data").height);
    expect(b("data").x).toBe(mapLeft);
    expect(b("data").width).toBeGreaterThanOrEqual(mapRight - mapLeft);
    // The pair shares a row, side by side, and its two-way imports are left to the loop arrow.
    expect(b("state").y).toBe(b("services").y);
    expect(Math.abs(b("state").x - b("services").x)).toBeGreaterThanOrEqual(b("state").width);
    expect(routes.has("m:state->m:services")).toBe(false);
    expect(routes.has("m:pages->m:components")).toBe(true);
    // Shelf edges are not routed either (they are drawn on focus).
    expect(routes.has("m:pages->m:data")).toBe(false);
    // Boxes in a row share a width.
    expect(new Set(["pages", "components", "state", "services"].map((m) => b(m).width)).size).toBe(1);
  });

  it("wraps a wide row of files into a grid", () => {
    const kids = ["a", "b", "c", "d", "e", "f", "g"];
    expect(wrapEdges(kids, [], 3)).toEqual([["a", "d"], ["b", "e"], ["c", "f"], ["d", "g"]]);
    // Files at different dependency levels are already stacked; only same-level rows wrap.
    expect(wrapEdges(["a", "b", "c"], [["a", "b"], ["b", "c"]], 2)).toEqual([]);
  });
});
