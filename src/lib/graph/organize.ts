/**
 * How the map is organised (Kosmos: "organized"), from the module graph alone:
 *
 * - Shelves: a part that most other parts use (at least `shelfShare` of them), and that uses no part
 *   outside the shelves, sits on a full-width shelf at the bottom instead of collecting an arrow from
 *   everyone. Shelves are ordered so a shelf another shelf uses sits below it.
 * - Pairs: two parts that import each other sit side by side with one two-way arrow.
 * - Rows: every part on the map gets a row (`rowsOf`), so arrows point down and wide rows wrap.
 * - Minor connections: an arrow the map already tells through other parts, or one pointing up the map,
 *   is left out at rest (`mainLinks`), so the picture shows the main relationships only.
 *
 * Pure and client-safe; the diagram's layout and the tour both read it.
 */

export interface Organization {
  /** Shelf modules, top shelf first. */
  shelves: string[];
  /** Modules that import each other, to sit side by side (each module in at most one pair). */
  pairs: [string, string][];
  /** Non-shelf module -> the shelves it uses. */
  uses: Map<string, string[]>;
  /** Shelf -> the modules (shelves included) that use it. */
  usedBy: Map<string, string[]>;
  /** Row of each module on the map (not shelves), top row 0. The two modules of a pair share one. */
  rows: Map<string, number>;
  /** Module pairs (`source\0target`) whose arrow is left out at rest (only with `simplify`). */
  minor: Set<string>;
}

export interface OrganizeOptions {
  /** Share of the other modules that must use a module for it to become a shelf. */
  shelfShare: number;
  /** Fewer modules than this: no shelves (a small map is clear without them). */
  minModules: number;
  maxShelves: number;
  /** Leave out the arrows the map already tells through other parts (`mainLinks`). */
  simplify: boolean;
  /** Bands the rows must follow, top first (the AI's tiers); otherwise the rows come from the arrows alone. */
  tiers?: Readonly<Record<string, number>>;
}

/** At most this many parts side by side; a wider row wraps (a map should fit a screen, not a corridor). */
export const MAX_ROW = 4;

export const DEFAULT_ORGANIZE: OrganizeOptions = { shelfShare: 0.6, minModules: 4, maxShelves: 3, simplify: false };

/** How heavy each arrow on a detour must be, relative to the arrow it replaces (see `mainLinks`). */
export const DETOUR_STRENGTH = 0.5;

export interface MainLinkOptions {
  /** Arrows drawn their own way (loops): never left out, but they count as detours. */
  fixed?: ReadonlySet<string>;
  /** Arrows pointing up the map (against the rows): left out while both their ends keep another arrow. */
  against?: ReadonlySet<string>;
  strength?: number;
}

/**
 * The arrows a map can leave out and still say who depends on whom (keys `source\0target`):
 *
 * 1. An arrow pointing up the map (`against`) is minor while both of its parts keep another arrow:
 *    drawn, it would have to loop around the map, and the map reads top to bottom.
 * 2. An arrow a→b is minor when b can still be reached from a over other kept arrows that are each at
 *    least `strength` × as heavy, so a thin detour never hides a heavy direct arrow. The lightest
 *    arrows are tried first, so heavy ones stay. Each removal keeps every "a reaches b" of what is
 *    left; on an acyclic map with `strength` 0 this step is the transitive reduction.
 */
export function mainLinks(edges: readonly { source: string; target: string; weight: number }[], options: MainLinkOptions = {}): Set<string> {
  const { fixed = new Set<string>(), against = new Set<string>(), strength = DETOUR_STRENGTH } = options;
  const key = (s: string, t: string) => `${s}\0${t}`;
  const ends = (k: string) => [k.slice(0, k.indexOf("\0")), k.slice(k.indexOf("\0") + 1)] as const;
  const weight = new Map<string, number>();
  for (const e of edges) if (e.source !== e.target) weight.set(key(e.source, e.target), (weight.get(key(e.source, e.target)) ?? 0) + e.weight);
  const lightestFirst = (keys: Iterable<string>) => [...keys].filter((k) => weight.has(k) && !fixed.has(k)).sort((a, b) => weight.get(a)! - weight.get(b)! || a.localeCompare(b));
  const minor = new Set<string>();

  // 1. Upward arrows, while both ends stay connected to something.
  const degree = new Map<string, number>();
  for (const k of weight.keys()) for (const m of ends(k)) degree.set(m, (degree.get(m) ?? 0) + 1);
  for (const k of lightestFirst(against)) {
    const [s, t] = ends(k);
    if (degree.get(s)! < 2 || degree.get(t)! < 2) continue;
    degree.set(s, degree.get(s)! - 1).set(t, degree.get(t)! - 1);
    minor.add(k);
    weight.delete(k);
  }

  // 2. Arrows told by a detour that is strong enough.
  const out = new Map<string, string[]>();
  for (const k of weight.keys()) {
    const [s, t] = ends(k);
    out.set(s, [...(out.get(s) ?? []), t]);
  }
  for (const k of lightestFirst(weight.keys())) {
    const [source, target] = ends(k);
    const w = weight.get(k)!;
    // Breadth-first search from source to target, skipping this arrow and any arrow too thin to stand in for it.
    const seen = new Set([source]);
    const queue = [source];
    let found = false;
    while (queue.length > 0 && !found) {
      const at = queue.shift()!;
      for (const next of out.get(at) ?? []) {
        const via = key(at, next);
        if (via === k || seen.has(next) || !weight.has(via)) continue;
        if (weight.get(via)! < strength * w) continue;
        if (next === target) {
          found = true;
          break;
        }
        seen.add(next);
        queue.push(next);
      }
    }
    if (found) {
      minor.add(k);
      weight.delete(k);
    }
  }
  return minor;
}

/**
 * A row per module, top first, such that the arrows point down the map:
 *
 * - The two modules of a pair share a row (their loop arrow runs sideways).
 * - With `tiers`, each tier is a band of rows below the band above it. Within a band, and without
 *   tiers, a module sits one row below the lowest module that imports it (longest path). Arrows that
 *   point up the tiers, or that would close a loop, push nothing down: they are the ones left pointing
 *   up, which `mainLinks` leaves out.
 * - A row of more than `maxPerRow` modules wraps onto the next rows (the most imported first), and
 *   modules with no arrows at all sit in a grid below everything else.
 */
export function rowsOf(
  modules: readonly string[],
  edges: readonly { source: string; target: string }[],
  pairs: readonly (readonly [string, string])[] = [],
  tiers?: Readonly<Record<string, number>>,
  maxPerRow = MAX_ROW,
): Map<string, number> {
  // A pair moves as one: its first module stands for both.
  const rep = new Map(modules.map((m) => [m, m]));
  for (const [a, b] of pairs) if (rep.has(a) && rep.has(b)) rep.set(b, a);
  const banded = !!tiers && modules.some((m) => tiers[m] !== undefined);
  const tierOf = new Map<string, number>();
  for (const m of modules) {
    const r = rep.get(m)!;
    tierOf.set(r, Math.min(tierOf.get(r) ?? Infinity, banded ? (tiers![m] ?? 0) : 0));
  }
  const reps = [...new Set(rep.values())].sort();
  const into = new Map<string, string[]>(reps.map((r) => [r, []]));
  const linked = new Set<string>();
  for (const e of edges) {
    const s = rep.get(e.source);
    const t = rep.get(e.target);
    if (!s || !t || s === t) continue;
    linked.add(s).add(t);
    if (tierOf.get(s)! <= tierOf.get(t)!) into.get(t)!.push(s);
  }

  // Longest path, band by band: each band starts on the row after the band above.
  const row = new Map<string, number>();
  const visiting = new Set<string>();
  let next = 0;
  for (const tier of [...new Set(reps.filter((r) => linked.has(r)).map((r) => tierOf.get(r)!))].sort((a, b) => a - b)) {
    const base = next;
    const depth = (r: string): number => {
      if (row.has(r)) return row.get(r)!;
      if (visiting.has(r)) return -Infinity; // closes a loop: this arrow pushes nothing down
      visiting.add(r);
      const d = Math.max(base, ...into.get(r)!.map((p) => depth(p) + 1));
      visiting.delete(r);
      row.set(r, d);
      return d;
    };
    const band = reps.filter((r) => linked.has(r) && tierOf.get(r) === tier);
    band.forEach(depth);
    next = Math.max(next, ...band.map((r) => row.get(r)! + 1));
  }

  // Wrap wide rows (the most imported parts stay on the first line), then the parts on their own.
  const lines: string[][] = [];
  const byRow = new Map<number, string[]>();
  for (const [r, d] of row) byRow.set(d, [...(byRow.get(d) ?? []), r]);
  for (const d of [...byRow.keys()].sort((a, b) => a - b)) {
    const line = byRow.get(d)!.sort((a, b) => into.get(b)!.length - into.get(a)!.length || a.localeCompare(b));
    for (let i = 0; i < line.length; i += maxPerRow) lines.push(line.slice(i, i + maxPerRow));
  }
  const alone = reps.filter((r) => !linked.has(r));
  for (let i = 0; i < alone.length; i += maxPerRow) lines.push(alone.slice(i, i + maxPerRow));

  const final = new Map<string, number>();
  lines.forEach((line, i) => line.forEach((r) => final.set(r, i)));
  return new Map(modules.map((m) => [m, final.get(rep.get(m)!)!]));
}

export function organize(
  modules: readonly string[],
  edges: readonly { source: string; target: string; weight?: number }[],
  options: Partial<OrganizeOptions> = {},
): Organization {
  const o = { ...DEFAULT_ORGANIZE, ...options };
  const out = new Map<string, Set<string>>(modules.map((m) => [m, new Set()]));
  const into = new Map<string, Set<string>>(modules.map((m) => [m, new Set()]));
  const weight = new Map<string, number>();
  for (const e of edges) {
    if (e.source === e.target || !out.has(e.source) || !out.has(e.target)) continue;
    out.get(e.source)!.add(e.target);
    into.get(e.target)!.add(e.source);
    weight.set(`${e.source}\0${e.target}`, (weight.get(`${e.source}\0${e.target}`) ?? 0) + (e.weight ?? 1));
  }

  // Shelves: well-used modules whose own imports stay among the shelves; shrink until stable.
  let shelves = new Set<string>();
  if (modules.length >= o.minModules) {
    const need = Math.ceil(o.shelfShare * (modules.length - 1));
    shelves = new Set(modules.filter((m) => into.get(m)!.size >= need));
    for (let changed = true; changed; ) {
      changed = false;
      for (const m of [...shelves]) {
        if ([...out.get(m)!].some((t) => !shelves.has(t))) {
          shelves.delete(m);
          changed = true;
        }
      }
    }
    // Keep the most used, and always leave at least two modules on the map proper.
    const ranked = [...shelves].sort((a, b) => into.get(b)!.size - into.get(a)!.size || a.localeCompare(b));
    shelves = new Set(ranked.slice(0, Math.max(0, Math.min(o.maxShelves, modules.length - 2))));
    // Dropping a shelf can strand another that used it; re-check.
    for (let changed = true; changed; ) {
      changed = false;
      for (const m of [...shelves]) {
        if ([...out.get(m)!].some((t) => !shelves.has(t))) {
          shelves.delete(m);
          changed = true;
        }
      }
    }
  }

  // Shelf order: a shelf used by another shelf goes below it (Kahn's algorithm, ties by name).
  const order: string[] = [];
  const pending = new Set(shelves);
  while (pending.size > 0) {
    const ready = [...pending].filter((m) => ![...pending].some((other) => other !== m && out.get(other)!.has(m))).sort();
    const next = ready[0] ?? [...pending].sort()[0]; // a cycle among shelves: break it by name
    order.push(next);
    pending.delete(next);
  }

  // Pairs: mutual imports between map modules, heaviest first, each module used once.
  const candidates: [string, string, number][] = [];
  for (const a of modules) {
    if (shelves.has(a)) continue;
    for (const b of out.get(a)!) {
      if (a < b && !shelves.has(b) && out.get(b)!.has(a)) candidates.push([a, b, (weight.get(`${a}\0${b}`) ?? 0) + (weight.get(`${b}\0${a}`) ?? 0)]);
    }
  }
  candidates.sort((x, y) => y[2] - x[2] || x[0].localeCompare(y[0]));
  const paired = new Set<string>();
  const pairs: [string, string][] = [];
  for (const [a, b] of candidates) {
    if (paired.has(a) || paired.has(b)) continue;
    paired.add(a).add(b);
    pairs.push([a, b]);
  }

  const uses = new Map<string, string[]>();
  for (const m of modules) if (!shelves.has(m)) uses.set(m, order.filter((s) => out.get(m)!.has(s)));
  const usedBy = new Map(order.map((s) => [s, [...into.get(s)!].sort()]));

  // Rows for the parts on the map, then the minor connections among them (arrows into shelves are told in words).
  const onMap = [...weight]
    .map(([k, w]) => ({ source: k.slice(0, k.indexOf("\0")), target: k.slice(k.indexOf("\0") + 1), weight: w }))
    .filter((e) => !shelves.has(e.source) && !shelves.has(e.target));
  const rows = rowsOf(
    modules.filter((m) => !shelves.has(m)),
    onMap,
    pairs,
    o.tiers,
  );
  let minor = new Set<string>();
  if (o.simplify) {
    const fixed = new Set(pairs.flatMap(([a, b]) => [`${a}\0${b}`, `${b}\0${a}`]));
    const against = new Set(onMap.filter((e) => rows.get(e.source)! >= rows.get(e.target)!).map((e) => `${e.source}\0${e.target}`));
    minor = mainLinks(onMap, { fixed, against });
  }
  return { shelves: order, pairs, uses, usedBy, rows, minor };
}
