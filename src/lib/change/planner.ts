/**
 * Layer 3's planner, written from scratch: A* search over STRIPS actions that edit the import
 * graph until no import breaks an architecture rule.
 *
 * State: the set of ground atoms `at(file, folder)` and `imports(a, b)`. It is stored as a delta
 * from the initial state (files moved, imports removed, imports added), so a state costs O(plan
 * length) to copy and its canonical key is the sorted delta.
 *
 * Actions (STRIPS: preconditions, add list, delete list):
 *   MoveFile(f, from, to)
 *     pre: at(f, from), ¬exists(to/name(f))      add: at(f, to)        del: at(f, from)
 *     cost: 1 + rewriteCost × (import statements whose path changes: in the files importing f,
 *           and f's own imports) + riskWeight × risk(f)
 *   RedirectImport(a, b, c) — a stops importing b and uses c, which already imports b, instead
 *     pre: imports(a, b), imports(c, b)          add: imports(a, c)    del: imports(a, b)
 *     cost: 1 + riskWeight × risk(a)
 * risk(f) is Layer 2's bug probability scaled to 0..1, so plans avoid touching likely-buggy files.
 *
 * Goal: no import is violating. Violations are derived by the forward-chaining rule engine
 * (Policy.check), which looks only at the two endpoints of an import.
 *
 * Heuristics:
 *   "matching" (admissible, default): pick a maximal set of violating imports that share no file
 *     (greedy matching). Fixing an import needs an action that touches it — moving one of its
 *     files, or redirecting it — and one action touches at most one import of the matching. So
 *     h = Σ over the matching of the cheapest such action (1 + riskWeight × min risk of its files)
 *     never overestimates. It is admissible but not always consistent, so A* re-opens a state
 *     whenever it finds a cheaper path to it.
 *   "count": number of violating imports. NOT admissible: one MoveFile can fix several imports.
 *   "zero": uniform-cost search (the baseline).
 */

import { importKey } from "@/lib/graph/types";
import type { Policy } from "./rules";

export interface PlanFile {
  id: string;
  dir: string;
  name: string;
}

export interface PlanEdge {
  source: string;
  target: string;
  typeOnly: boolean;
}

export interface PlanProblem {
  files: readonly PlanFile[];
  edges: readonly PlanEdge[];
  policy: Policy;
  /** Layer 2 bug probability per file, scaled to 0..1 (1 = the riskiest file). */
  risk?: ReadonlyMap<string, number>;
  /** Folders a file may move to; defaults to every folder that holds a file. */
  dirs?: readonly string[];
}

export type Heuristic = "matching" | "count" | "zero";

export interface PlanOptions {
  heuristic: Heuristic;
  /** Weight of Layer 2 risk in action costs. */
  riskWeight: number;
  /** Cost per import statement a move forces you to rewrite (in importers and in the moved file). */
  rewriteCost: number;
  maxExpansions: number;
  timeLimitMs: number;
}

export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  heuristic: "matching",
  riskWeight: 1,
  rewriteCost: 0.5,
  maxExpansions: 50_000,
  timeLimitMs: 5_000,
};

export type PlanAction =
  | { kind: "move"; file: string; from: string; to: string }
  /** `file` stops importing `from` and imports `to` instead. */
  | { kind: "redirect"; file: string; from: string; to: string };

export interface GroundAtom {
  pred: "at" | "imports" | "exists";
  args: string[];
}

export interface StripsAction {
  name: string;
  pre: GroundAtom[];
  /** Negative preconditions: atoms that must not hold. */
  preNot: GroundAtom[];
  add: GroundAtom[];
  del: GroundAtom[];
}

export interface CostParts {
  base: number;
  rewrites: number;
  risk: number;
}

/** A plan state in serialisable form: what differs from the initial graph. */
export interface StateDelta {
  /** [file, new folder] */
  moves: [string, string][];
  /** Imports removed and added, as `${source}\0${target}` keys. */
  removed: string[];
  added: string[];
  /** The added imports that only bring in types (they inherit this from the import they replace). */
  addedTypeOnly: string[];
}

export interface PlanStep {
  action: PlanAction;
  strips: StripsAction;
  cost: number;
  costParts: CostParts;
  /** Violating imports this step fixed / created (edge keys). */
  fixed: string[];
  introduced: string[];
  /** Violating imports left after the step. */
  remaining: number;
  /** State after the step. */
  state: StateDelta;
}

export interface PlanStats {
  expanded: number;
  generated: number;
  /** States expanded again after a cheaper path to them was found. */
  reopened: number;
  maxFrontier: number;
  ms: number;
  /** Heuristic value of the initial state. */
  hStart: number;
}

export interface PlanResult {
  /** "partial": search limit hit; "unsolvable": no sequence of the two actions fixes every violation. */
  status: "solved" | "nothing-to-do" | "partial" | "unsolvable";
  heuristic: Heuristic;
  steps: PlanStep[];
  cost: number;
  initialViolations: string[];
  finalViolations: string[];
  stats: PlanStats;
}

export const edgeKey = importKey;
export const splitEdge = (key: string) => key.split("\0") as [string, string];
const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

// ---------------------------------------------------------------------------------------------
// Binary min-heap (priority queue), keyed by [f, h, insertion order].

class MinHeap<T> {
  private items: { value: T; key: [number, number, number] }[] = [];

  get size() {
    return this.items.length;
  }

  private less(i: number, j: number): boolean {
    const a = this.items[i].key;
    const b = this.items[j].key;
    return a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];
  }

  private swap(i: number, j: number) {
    [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
  }

  push(value: T, key: [number, number, number]) {
    this.items.push({ value, key });
    for (let i = this.items.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0].value;
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.items.length && this.less(l, smallest)) smallest = l;
        if (r < this.items.length && this.less(r, smallest)) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }
}

// ---------------------------------------------------------------------------------------------
// State

interface State {
  moves: ReadonlyMap<string, string>;
  removed: ReadonlySet<string>;
  extra: ReadonlySet<string>;
}

/** Fixed facts about the initial graph, with index structures for fast state queries. */
class World {
  readonly baseDir = new Map<string, string>();
  readonly name = new Map<string, string>();
  readonly baseEdges = new Set<string>();
  readonly typeOnly = new Map<string, boolean>();
  readonly outBase = new Map<string, string[]>();
  readonly inBase = new Map<string, string[]>();
  /** Initial path -> file. */
  readonly basePath = new Map<string, string>();
  readonly dirs: string[];

  constructor(
    readonly problem: PlanProblem,
    readonly options: PlanOptions,
  ) {
    for (const f of problem.files) {
      this.baseDir.set(f.id, f.dir);
      this.name.set(f.id, f.name);
      this.basePath.set(joinPath(f.dir, f.name), f.id);
      this.outBase.set(f.id, []);
      this.inBase.set(f.id, []);
    }
    for (const e of problem.edges) {
      if (!this.baseDir.has(e.source) || !this.baseDir.has(e.target)) continue;
      const key = edgeKey(e.source, e.target);
      if (this.baseEdges.has(key)) continue;
      this.baseEdges.add(key);
      this.typeOnly.set(key, e.typeOnly);
      this.outBase.get(e.source)!.push(key);
      this.inBase.get(e.target)!.push(key);
    }
    this.dirs = [...new Set(problem.dirs ?? problem.files.map((f) => f.dir))].sort();
  }

  dirOf(s: State, f: string): string {
    return s.moves.get(f) ?? this.baseDir.get(f)!;
  }

  pathOf(s: State, f: string): string {
    return joinPath(this.dirOf(s, f), this.name.get(f)!);
  }

  hasEdge(s: State, key: string): boolean {
    return s.extra.has(key) || (this.baseEdges.has(key) && !s.removed.has(key));
  }

  /** File currently at `path`, if any. */
  owner(s: State, path: string): string | undefined {
    const base = this.basePath.get(path);
    if (base !== undefined && !s.moves.has(base)) return base;
    for (const [f, d] of s.moves) if (joinPath(d, this.name.get(f)!) === path) return f;
    return undefined;
  }

  holds(s: State, atom: GroundAtom): boolean {
    const [x, y] = atom.args;
    if (atom.pred === "at") return this.dirOf(s, x) === y;
    if (atom.pred === "imports") return this.hasEdge(s, edgeKey(x, y));
    return this.owner(s, x) !== undefined;
  }

  /** Applies a STRIPS action: checks preconditions, then deletes and adds atoms. */
  apply(s: State, a: StripsAction): State | null {
    if (!a.pre.every((p) => this.holds(s, p)) || a.preNot.some((p) => this.holds(s, p))) return null;
    const moves = new Map(s.moves);
    const removed = new Set(s.removed);
    const extra = new Set(s.extra);
    for (const atom of a.del) {
      if (atom.pred === "imports") {
        const key = edgeKey(atom.args[0], atom.args[1]);
        if (!extra.delete(key)) removed.add(key);
      }
      // at(f, from) is replaced by the matching add below.
    }
    const replaced = a.del.find((x) => x.pred === "imports");
    for (const atom of a.add) {
      if (atom.pred === "at") {
        const [f, d] = atom.args;
        if (d === this.baseDir.get(f)) moves.delete(f);
        else moves.set(f, d);
      } else if (atom.pred === "imports") {
        const key = edgeKey(atom.args[0], atom.args[1]);
        if (!removed.delete(key) && !this.baseEdges.has(key)) extra.add(key);
        if (!this.typeOnly.has(key) && replaced) this.typeOnly.set(key, this.typeOnly.get(edgeKey(replaced.args[0], replaced.args[1])) ?? false);
      }
    }
    return { moves, removed, extra };
  }

  incident(s: State, f: string): string[] {
    const keys = [...this.outBase.get(f)!, ...this.inBase.get(f)!].filter((k) => !s.removed.has(k));
    for (const k of s.extra) {
      const [a, b] = splitEdge(k);
      if (a === f || b === f) keys.push(k);
    }
    return keys;
  }

  importers(s: State, f: string): string[] {
    const result = this.inBase.get(f)!.filter((k) => !s.removed.has(k)).map((k) => splitEdge(k)[0]);
    for (const k of s.extra) {
      const [a, b] = splitEdge(k);
      if (b === f) result.push(a);
    }
    return result;
  }

  imports(s: State, f: string): string[] {
    const result = this.outBase.get(f)!.filter((k) => !s.removed.has(k)).map((k) => splitEdge(k)[1]);
    for (const k of s.extra) {
      const [a, b] = splitEdge(k);
      if (a === f) result.push(b);
    }
    return result;
  }

  violates(s: State, a: string, b: string): boolean {
    return this.problem.policy.check(this.pathOf(s, a), this.pathOf(s, b)).length > 0;
  }

  risk(f: string): number {
    return this.problem.risk?.get(f) ?? 0;
  }

  cost(s: State, action: PlanAction): CostParts {
    const risk = this.options.riskWeight * this.risk(action.file);
    if (action.kind === "move") {
      const statements = this.importers(s, action.file).length + this.imports(s, action.file).length;
      return { base: 1, rewrites: this.options.rewriteCost * statements, risk };
    }
    return { base: 1, rewrites: 0, risk };
  }

  key(s: State): string {
    const moves = [...s.moves].map(([f, d]) => `${f}>${d}`).sort();
    return `${moves.join("|")}#${[...s.removed].sort().join("|")}#${[...s.extra].sort().join("|")}`;
  }
}

export function stripsFor(action: PlanAction, name: string): StripsAction {
  if (action.kind === "move") {
    const { file, from, to } = action;
    return {
      name: `MoveFile(${file}, ${from || "."}, ${to || "."})`,
      pre: [{ pred: "at", args: [file, from] }],
      preNot: [{ pred: "exists", args: [joinPath(to, name)] }],
      add: [{ pred: "at", args: [file, to] }],
      del: [{ pred: "at", args: [file, from] }],
    };
  }
  const { file: a, from: b, to: c } = action;
  return {
    name: `RedirectImport(${a}, ${b}, ${c})`,
    pre: [{ pred: "imports", args: [a, b] }, { pred: "imports", args: [c, b] }],
    preNot: [],
    add: [{ pred: "imports", args: [a, c] }],
    del: [{ pred: "imports", args: [a, b] }],
  };
}

export function formatAtom(atom: GroundAtom): string {
  return `${atom.pred}(${atom.args.join(", ")})`;
}

// ---------------------------------------------------------------------------------------------
// Search

interface SearchNode {
  state: State;
  key: string;
  g: number;
  h: number;
  violating: Set<string>;
  parent: SearchNode | null;
  action: PlanAction | null;
  costParts: CostParts | null;
}

function heuristic(world: World, violating: ReadonlySet<string>): number {
  const { heuristic: kind, riskWeight } = world.options;
  if (kind === "zero" || violating.size === 0) return 0;
  if (kind === "count") return violating.size;
  // Greedy maximal matching over violating imports, heaviest lower bound first.
  const weighted = [...violating].map((k) => {
    const [a, b] = splitEdge(k);
    return { a, b, k, w: 1 + riskWeight * Math.min(world.risk(a), world.risk(b)) };
  });
  weighted.sort((x, y) => y.w - x.w || x.k.localeCompare(y.k));
  const used = new Set<string>();
  let h = 0;
  for (const e of weighted) {
    if (used.has(e.a) || used.has(e.b)) continue;
    used.add(e.a).add(e.b);
    h += e.w;
  }
  return h;
}

/**
 * Relevant ground actions in a state: only ones that make some violating import stop violating.
 * Folders (for moves) and gateway files (for redirects) that every rule sees identically — same
 * signature — lead to equivalent states, so one representative of each is kept: the folder most
 * of the file's neighbours live in, and a gateway the file already imports (else the least risky).
 */
function actionsFor(world: World, s: State, violating: ReadonlySet<string>): PlanAction[] {
  const { policy } = world.problem;
  const actions = new Map<string, PlanAction>();
  const add = (a: PlanAction) => actions.set(`${a.kind}|${a.file}|${a.from}|${a.to}`, a);

  for (const key of violating) {
    const [a, b] = splitEdge(key);

    // RedirectImport(a, b, c): c imports b legitimately and a may import c.
    const gateways = new Map<string, string>();
    const alreadyImported = new Set(world.imports(s, a));
    // Lower is better: a file `a` already imports (no new dependency), then lower risk, then name.
    const preference = (x: string, y: string) =>
      Number(alreadyImported.has(y)) - Number(alreadyImported.has(x)) || world.risk(x) - world.risk(y) || x.localeCompare(y);
    for (const c of world.importers(s, b)) {
      if (c === a || c === b || world.violates(s, c, b) || world.violates(s, a, c)) continue;
      const sig = policy.signature(world.pathOf(s, c));
      const current = gateways.get(sig);
      if (current === undefined || preference(c, current) < 0) gateways.set(sig, c);
    }
    for (const c of gateways.values()) add({ kind: "redirect", file: a, from: b, to: c });

    // MoveFile(f, from, to) for either end, to a folder where this import stops violating.
    for (const f of [a, b]) {
      const from = world.dirOf(s, f);
      if (policy.isKept(world.pathOf(s, f))) continue;
      const neighbourDirs = new Map<string, number>();
      for (const k of world.incident(s, f)) {
        const [x, y] = splitEdge(k);
        const other = x === f ? y : x;
        const d = world.dirOf(s, other);
        neighbourDirs.set(d, (neighbourDirs.get(d) ?? 0) + 1);
      }
      const best = new Map<string, string>();
      for (const to of world.dirs) {
        if (to === from) continue;
        const path = joinPath(to, world.name.get(f)!);
        if (world.owner(s, path) !== undefined) continue;
        const pa = f === a ? path : world.pathOf(s, a);
        const pb = f === b ? path : world.pathOf(s, b);
        if (policy.check(pa, pb).length > 0) continue;
        const sig = policy.signature(path);
        const current = best.get(sig);
        const score = (d: string) => neighbourDirs.get(d) ?? 0;
        if (current === undefined || score(to) > score(current) || (score(to) === score(current) && to.length < current.length)) best.set(sig, to);
      }
      for (const to of best.values()) add({ kind: "move", file: f, from, to });
    }
  }
  return [...actions.values()];
}

function stateDelta(world: World, s: State): StateDelta {
  const added = [...s.extra].sort();
  return { moves: [...s.moves].sort(), removed: [...s.removed].sort(), added, addedTypeOnly: added.filter((k) => world.typeOnly.get(k)) };
}

export function planRefactoring(problem: PlanProblem, options: Partial<PlanOptions> = {}): PlanResult {
  const opts = { ...DEFAULT_PLAN_OPTIONS, ...options };
  const world = new World(problem, opts);
  const started = Date.now();
  const initial: State = { moves: new Map(), removed: new Set(), extra: new Set() };

  const startViolating = new Set<string>();
  for (const k of world.baseEdges) {
    const [a, b] = splitEdge(k);
    if (world.violates(initial, a, b)) startViolating.add(k);
  }
  const start: SearchNode = {
    state: initial,
    key: world.key(initial),
    g: 0,
    h: heuristic(world, startViolating),
    violating: startViolating,
    parent: null,
    action: null,
    costParts: null,
  };
  const stats: PlanStats = { expanded: 0, generated: 1, reopened: 0, maxFrontier: 1, ms: 0, hStart: start.h };
  const initialViolations = [...startViolating].sort();

  const finish = (status: PlanResult["status"], node: SearchNode): PlanResult => {
    const path: SearchNode[] = [];
    for (let n: SearchNode | null = node; n; n = n.parent) path.unshift(n);
    const steps: PlanStep[] = path.slice(1).map((n) => {
      const parent = n.parent!;
      const cp = n.costParts!;
      return {
        action: n.action!,
        strips: stripsFor(n.action!, world.name.get(n.action!.file)!),
        cost: cp.base + cp.rewrites + cp.risk,
        costParts: cp,
        fixed: [...parent.violating].filter((k) => !n.violating.has(k)).sort(),
        introduced: [...n.violating].filter((k) => !parent.violating.has(k)).sort(),
        remaining: n.violating.size,
        state: stateDelta(world, n.state),
      };
    });
    stats.ms = Date.now() - started;
    return { status, heuristic: opts.heuristic, steps, cost: node.g, initialViolations, finalViolations: [...node.violating].sort(), stats };
  };

  if (startViolating.size === 0) return finish("nothing-to-do", start);

  const open = new MinHeap<SearchNode>();
  const bestG = new Map<string, number>([[start.key, 0]]);
  const expandedKeys = new Set<string>();
  let seq = 0;
  open.push(start, [start.h, start.h, seq++]);
  let best = start;

  while (open.size > 0) {
    const node = open.pop()!;
    if (node.g > bestG.get(node.key)! + 1e-9) continue; // a cheaper path to this state was queued later
    if (node.violating.size === 0) return finish("solved", node);
    if (stats.expanded >= opts.maxExpansions || Date.now() - started > opts.timeLimitMs) return finish("partial", best);

    stats.expanded++;
    if (expandedKeys.has(node.key)) stats.reopened++;
    expandedKeys.add(node.key);

    for (const action of actionsFor(world, node.state, node.violating)) {
      const strips = stripsFor(action, world.name.get(action.file)!);
      const next = world.apply(node.state, strips);
      if (!next) continue;
      const costParts = world.cost(node.state, action);
      const g = node.g + costParts.base + costParts.rewrites + costParts.risk;
      const key = world.key(next);
      if (g >= (bestG.get(key) ?? Infinity) - 1e-9) continue;
      bestG.set(key, g);

      // Only imports touching what the action changed can change status.
      const affected =
        action.kind === "move" ? world.incident(node.state, action.file) : [edgeKey(action.file, action.from), edgeKey(action.file, action.to)];
      const violating = new Set(node.violating);
      for (const k of affected) {
        violating.delete(k);
        const [a, b] = splitEdge(k);
        if (world.hasEdge(next, k) && world.violates(next, a, b)) violating.add(k);
      }
      const h = heuristic(world, violating);
      stats.generated++;
      const child: SearchNode = { state: next, key, g, h, violating, parent: node, action, costParts };
      if (violating.size < best.violating.size || (violating.size === best.violating.size && g < best.g)) best = child;
      open.push(child, [g + h, h, seq++]);
      stats.maxFrontier = Math.max(stats.maxFrontier, open.size);
    }
  }
  return finish("unsolvable", best);
}

/** The import graph after a plan state: edges with removals and additions applied. */
export function edgesAfter(edges: readonly PlanEdge[], delta: StateDelta): PlanEdge[] {
  const removed = new Set(delta.removed);
  const typeOnly = new Set(delta.addedTypeOnly);
  const kept: PlanEdge[] = edges.filter((e) => !removed.has(edgeKey(e.source, e.target)));
  for (const k of delta.added) {
    const [source, target] = splitEdge(k);
    kept.push({ source, target, typeOnly: typeOnly.has(k) });
  }
  return kept;
}
