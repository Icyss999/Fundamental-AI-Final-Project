import { describe, expect, it } from "vitest";
import type { ViewNode } from "@/lib/graph/view";
import { applyPins, layoutView } from "./layout";

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

describe("applyPins", () => {
  const nodes = [
    { id: "m:ui", position: { x: 0, y: 0 }, width: 200, height: 100 },
    { id: "f:a", parentId: "m:ui", position: { x: 16, y: 40 }, width: 120, height: 34 },
    { id: "m:data", position: { x: 0, y: 200 }, width: 160, height: 60 },
  ];

  it("restores dragged positions and leaves the rest alone", () => {
    const out = applyPins(nodes, new Map([["m:data", { x: 500, y: 20 }]]));
    expect(out.find((n) => n.id === "m:data")!.position).toEqual({ x: 500, y: 20 });
    expect(out.find((n) => n.id === "m:ui")!.position).toEqual({ x: 0, y: 0 });
    expect(nodes[2].position).toEqual({ x: 0, y: 200 }); // input not mutated
  });

  it("pushes an auto-placed node clear of a pinned node it would sit under", () => {
    // User dragged m:data onto the spot ELK gave m:ui.
    const out = applyPins(nodes, new Map([["m:data", { x: 50, y: 10 }]]));
    const ui = out.find((n) => n.id === "m:ui")!;
    const data = out.find((n) => n.id === "m:data")!;
    expect(data.position).toEqual({ x: 50, y: 10 }); // pinned node never moves
    expect(ui.position.x).toBeGreaterThanOrEqual(50 + 160); // pushed to the right of it
    expect(ui.position.y).toBe(0); // stays in its layer
  });

  it("grows a group so a pinned child still fits inside it", () => {
    const out = applyPins(nodes, new Map([["f:a", { x: 300, y: 150 }]]));
    const group = out.find((n) => n.id === "m:ui")!;
    expect(group.width).toBe(300 + 120 + 20);
    expect(group.height).toBe(150 + 34 + 20);
    expect(nodes[0].width).toBe(200); // input not mutated
  });
});
