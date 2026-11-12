import { describe, expect, it } from "vitest";
import { routeAround, type Rect } from "./route";
import type { Point } from "./layout";

const box = (x: number, y: number, w = 200, h = 90): Rect => ({ x, y, w, h });
const hits = (path: Point[], r: Rect) =>
  path.slice(1).some((b, i) => {
    const a = path[i];
    return Math.min(a.x, b.x) < r.x + r.w && Math.max(a.x, b.x) > r.x && Math.min(a.y, b.y) < r.y + r.h && Math.max(a.y, b.y) > r.y;
  });
const orthogonal = (path: Point[]) => path.slice(1).every((b, i) => b.x === path[i].x || b.y === path[i].y);

describe("routing a minor connection around the boxes", () => {
  it("goes straight down when nothing is in the way", () => {
    expect(routeAround(box(0, 0), box(0, 300), [])).toEqual([
      { x: 100, y: 90 },
      { x: 100, y: 300 },
    ]);
  });

  it("goes around a box in between, in right angles, from bottom to top", () => {
    const source = box(0, 0);
    const target = box(0, 400);
    const middle = box(-20, 180, 240);
    const path = routeAround(source, target, [middle])!;
    expect(path[0]).toEqual({ x: 100, y: 90 });
    expect(path[path.length - 1]).toEqual({ x: 100, y: 400 });
    expect(orthogonal(path)).toBe(true);
    expect(hits(path, middle)).toBe(false);
    expect(path.length).toBe(6); // down, aside, down past the box, back, down: four turns
  });

  it("enters a target above from below", () => {
    const path = routeAround(box(0, 400), box(300, 0), [])!;
    expect(path[0]).toEqual({ x: 100, y: 400 });
    expect(path[path.length - 1]).toEqual({ x: 400, y: 90 });
    expect(orthogonal(path)).toBe(true);
  });

  it("goes around the end of a long wall, and gives up when the target is boxed in", () => {
    const wall = box(-1000, 150, 3000, 60);
    const around = routeAround(box(0, 0), box(0, 400), [wall])!;
    expect(hits(around, wall)).toBe(false);
    const ring = [box(-60, 330, 320, 40), box(-60, 330, 40, 220), box(220, 330, 40, 220), box(-60, 510, 320, 40)];
    expect(routeAround(box(0, 0), box(0, 400), ring)).toBeUndefined();
  });
});

describe("routing in a crowded map", () => {
  it("keeps to the area around the two ends, and still avoids every box there", () => {
    // A 12 × 12 grid of file boxes (144, more than the router takes at once), routing between two neighbours.
    const files: Rect[] = [];
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) files.push(box(i * 260, j * 120, 200, 40));
    const source = files[5 * 12 + 5];
    const target = files[6 * 12 + 7];
    const others = files.filter((f) => f !== source && f !== target);
    const path = routeAround(source, target, others)!;
    expect(path).toBeDefined();
    expect(orthogonal(path)).toBe(true);
    for (const o of others) expect(hits(path, o)).toBe(false);
  });
});
