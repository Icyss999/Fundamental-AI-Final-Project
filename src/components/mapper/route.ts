import type { Point } from "./layout";

/** A box on the canvas, in absolute coordinates. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A turn costs as much as this many pixels of line, so paths prefer few, long straight runs. */
const BEND = 60;
/** Above this many boxes near the two ends the grid gets large; the caller falls back to a plain path. */
const MAX_OBSTACLES = 80;
/** How far around the two ends the path may wander, tried in turn: near first, so big maps stay fast. */
const REACH = [160, 480, Infinity];

/**
 * An orthogonal path for an arrow ELK did not route (a minor connection, shown only on focus), around
 * every other box: it leaves the source's bottom and enters the target's top, or the other way round
 * when the target sits above. The path is the cheapest one (length + `BEND` per turn) over the grid of
 * lines that run `margin` outside each box's sides (an orthogonal visibility grid), found by A* with
 * the Manhattan distance as heuristic. `ends` places the two ends along the boxes' sides (default: the
 * middle), so several arrows into one box arrive side by side. The search first keeps to the area around
 * the two ends (only the boxes there count), and widens it when there is no way through. Undefined when
 * there is none at all, or too many boxes are in the way.
 */
export function routeAround(source: Rect, target: Rect, obstacles: readonly Rect[], ends: { sx?: number; tx?: number } = {}, margin = 18): Point[] | undefined {
  const up = target.y + target.h <= source.y;
  const sx = ends.sx ?? source.x + source.w / 2;
  const tx = ends.tx ?? target.x + target.w / 2;
  const start = up ? { x: sx, y: source.y } : { x: sx, y: source.y + source.h };
  const end = up ? { x: tx, y: target.y + target.h } : { x: tx, y: target.y };
  const from = { x: start.x, y: start.y + (up ? -margin : margin) };
  const to = { x: end.x, y: end.y + (up ? margin : -margin) };
  const x0 = Math.min(source.x, target.x);
  const x1 = Math.max(source.x + source.w, target.x + target.w);
  const y0 = Math.min(source.y, target.y);
  const y1 = Math.max(source.y + source.h, target.y + target.h);
  for (const reach of REACH) {
    const area = { x: x0 - reach, y: y0 - reach, w: x1 - x0 + 2 * reach, h: y1 - y0 + 2 * reach };
    const near = obstacles.filter((b) => b.x < area.x + area.w && b.x + b.w > area.x && b.y < area.y + area.h && b.y + b.h > area.y);
    if (near.length > MAX_OBSTACLES) return undefined;
    // Once every box counts, only leaving the area can find more room: search without bounds, last.
    const everything = near.length === obstacles.length;
    const path = search(source, target, near, everything ? { x: -Infinity, y: -Infinity, w: Infinity, h: Infinity } : area, from, to, margin);
    if (path) return simplify([start, ...path, end]);
    if (everything) return undefined;
  }
  return undefined;
}

/** A* from `from` to `to` over the grid of lines around `obstacles`, kept inside `area`. */
function search(source: Rect, target: Rect, obstacles: readonly Rect[], area: Rect, from: Point, to: Point, margin: number): Point[] | undefined {
  // The ends themselves block the way too, so the path cannot cut back through them.
  const blocks = [...obstacles, source, target];
  const inside = (p: Point) => blocks.some((b) => p.x > b.x - margin + 0.5 && p.x < b.x + b.w + margin - 0.5 && p.y > b.y - margin + 0.5 && p.y < b.y + b.h + margin - 0.5);
  const crosses = (a: Point, b: Point) => {
    const [x1, x2] = a.x < b.x ? [a.x, b.x] : [b.x, a.x];
    const [y1, y2] = a.y < b.y ? [a.y, b.y] : [b.y, a.y];
    return blocks.some((r) => x1 < r.x + r.w && x2 > r.x && y1 < r.y + r.h && y2 > r.y);
  };
  if (inside(from) || inside(to)) return undefined;

  // Lines through the area only (its own edges included), so the path never leaves it: boxes outside it were not counted.
  const lines = (values: number[], lo: number, size: number) =>
    Number.isFinite(size)
      ? [...new Set([...values.filter((v) => v >= lo && v <= lo + size), lo, lo + size])].sort((a, b) => a - b)
      : [...new Set(values)].sort((a, b) => a - b);
  const xs = lines([from.x, to.x, ...blocks.flatMap((b) => [b.x - margin, b.x + b.w + margin])], area.x, area.w);
  const ys = lines([from.y, to.y, ...blocks.flatMap((b) => [b.y - margin, b.y + b.h + margin])], area.y, area.h);
  const id = (i: number, j: number) => i * ys.length + j;
  const free = new Uint8Array(xs.length * ys.length);
  for (let i = 0; i < xs.length; i++) for (let j = 0; j < ys.length; j++) free[id(i, j)] = inside({ x: xs[i], y: ys[j] }) ? 0 : 1;
  const goal = id(xs.indexOf(to.x), ys.indexOf(to.y));
  const begin = id(xs.indexOf(from.x), ys.indexOf(from.y));

  // A* over (grid point, heading): 0 = vertical, 1 = horizontal. The first run leaves vertically.
  const states = xs.length * ys.length * 2;
  const g = new Float64Array(states).fill(Infinity);
  const prev = new Int32Array(states).fill(-1);
  const h = (n: number) => Math.abs(xs[Math.floor(n / ys.length)] - to.x) + Math.abs(ys[n % ys.length] - to.y);
  const heap = new MinHeap();
  g[begin * 2] = 0;
  heap.push(begin * 2, h(begin));
  let reached = -1;
  while (heap.size > 0) {
    const s = heap.pop();
    const n = s >> 1;
    const heading = s & 1;
    if (n === goal) {
      // Arriving sideways means one more turn, down into the target; settle that before stopping.
      if (heading === 1 && g[s] + BEND < g[goal * 2]) {
        g[goal * 2] = g[s] + BEND;
        prev[goal * 2] = s;
        heap.push(goal * 2, g[goal * 2]);
        continue;
      }
      if (heading === 0) {
        reached = s;
        break;
      }
      continue;
    }
    const i = Math.floor(n / ys.length);
    const j = n % ys.length;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ys.length) continue;
      const m = id(ni, nj);
      if (!free[m] || crosses({ x: xs[i], y: ys[j] }, { x: xs[ni], y: ys[nj] })) continue;
      const nh = di !== 0 ? 1 : 0;
      const cost = g[s] + Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]) + (nh !== heading ? BEND : 0);
      const t = m * 2 + nh;
      if (cost < g[t]) {
        g[t] = cost;
        prev[t] = s;
        heap.push(t, cost + h(m));
      }
    }
  }
  if (reached < 0) return undefined;

  const path: Point[] = [];
  for (let s = reached; s >= 0; s = prev[s]) path.push({ x: xs[Math.floor((s >> 1) / ys.length)], y: ys[(s >> 1) % ys.length] });
  return path.reverse();
}

/** Drops repeated points and the middle of straight runs. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    if (out.length > 0 && out[out.length - 1].x === p.x && out[out.length - 1].y === p.y) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)) out.pop();
    }
    out.push(p);
  }
  return out;
}

/** A binary min-heap of integer items keyed by priority. */
class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, key: number) {
    this.items.push(item);
    this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.items.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}
