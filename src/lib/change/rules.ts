/**
 * Architecture rules: a small text format the user writes, compiled to facts for the
 * forward-chaining engine, which derives `violates(file, file, rule)` for imports that break them.
 *
 *   layers: pages > components > services, state > data > lib
 *   forbid: pages, components -> data
 *   only:   services -> data/db.ts
 *   allow:  components/Cart.tsx -> data/db.ts
 *   keep:   data
 *
 * Paths are folder or file prefixes, relative to the folder every file shares (e.g. `src/`) or to
 * the project root; `*` matches one path segment. Each rule applies to a file and everything under it.
 */

import { parseFact, Program, type Model, type Proof, type RunStats } from "./engine";

export type PolicyRuleKind = "layers" | "forbid" | "only" | "allow" | "keep";

export interface PolicyRule {
  /** "L<line>" — what violations point back to. */
  id: string;
  line: number;
  kind: PolicyRuleKind;
  text: string;
  /** layers: groups from top to bottom. */
  groups: string[][];
  /** forbid / only / allow: importer side and imported side. keep: the kept paths in `from`. */
  from: string[];
  to: string[];
}

export interface PolicyError {
  line: number;
  message: string;
}

const KINDS: PolicyRuleKind[] = ["layers", "forbid", "only", "allow", "keep"];
const PATTERN = /^[^\s,>]+$/;

function normalizePattern(p: string): string {
  return p.trim().replace(/^\.\//, "").replace(/\/+$/, "");
}

function patternList(text: string): string[] | string {
  const items = text.split(",").map(normalizePattern);
  if (items.some((p) => p === "")) return "an empty path in a list";
  const bad = items.find((p) => !PATTERN.test(p));
  return bad ? `"${bad}" is not a path` : items;
}

export function parsePolicy(source: string): { rules: PolicyRule[]; errors: PolicyError[] } {
  const rules: PolicyRule[] = [];
  const errors: PolicyError[] = [];
  source.split("\n").forEach((raw, i) => {
    const line = i + 1;
    const text = raw.replace(/#.*$/, "").trim();
    if (!text) return;
    const m = text.match(/^([a-z]+)\s*:\s*(.*)$/i);
    const kind = m?.[1].toLowerCase() as PolicyRuleKind | undefined;
    if (!m || !kind || !KINDS.includes(kind)) {
      errors.push({ line, message: `Start the line with one of: ${KINDS.map((k) => `${k}:`).join(" ")}` });
      return;
    }
    const body = m[2].replace(/→/g, "->");
    const base = { id: `L${line}`, line, kind, text, groups: [] as string[][], from: [] as string[], to: [] as string[] };

    if (kind === "layers") {
      const groups = body.split(">").map(patternList);
      const bad = groups.find((g): g is string => typeof g === "string");
      if (bad) return errors.push({ line, message: bad });
      const lists = groups as string[][];
      if (lists.length < 2) return errors.push({ line, message: "List at least two layers, top first: layers: ui > logic > data" });
      const all = lists.flat();
      const dup = all.find((p, k) => all.indexOf(p) !== k);
      if (dup) return errors.push({ line, message: `"${dup}" appears in two layers` });
      rules.push({ ...base, groups: lists });
    } else if (kind === "keep") {
      const list = patternList(body);
      if (typeof list === "string") return errors.push({ line, message: list });
      rules.push({ ...base, from: list });
    } else {
      const parts = body.split("->");
      if (parts.length !== 2) return errors.push({ line, message: `Write it as ${kind}: from -> to` });
      const from = patternList(parts[0]);
      const to = patternList(parts[1]);
      if (typeof from === "string") return errors.push({ line, message: from });
      if (typeof to === "string") return errors.push({ line, message: to });
      rules.push({ ...base, from, to });
    }
  });
  return { rules, errors };
}

/** The rule base: what the forward-chaining engine derives from the compiled facts. */
export const RULE_BASE = `
% Layer order: "layers: A > B > C" compiles to directlyAbove(A, B, R), directlyAbove(B, C, R).
[above]      above(?x, ?y, ?r) :- directlyAbove(?x, ?y, ?r).
[above-tc]   above(?x, ?z, ?r) :- above(?x, ?y, ?r), directlyAbove(?y, ?z, ?r).

% A file belongs to the most specific layer path that contains it.
[shadowed]   shadowed(?f, ?p, ?r) :- under(?f, ?p), layerMember(?p, ?r), under(?f, ?q), inside(?q, ?p), layerMember(?q, ?r).
[in-layer]   inLayer(?f, ?p, ?r) :- under(?f, ?p), layerMember(?p, ?r), not shadowed(?f, ?p, ?r).

% "allow: A -> B" exempts an import from every rule.
[exempt]     exempt(?a, ?b) :- imports(?a, ?b), allow(?pa, ?pb, _), under(?a, ?pa), under(?b, ?pb).

% Imports may stay in their layer or point down; pointing up breaks the layer rule.
[upward]     violates(?a, ?b, ?r) :- imports(?a, ?b), inLayer(?a, ?pa, ?r), inLayer(?b, ?pb, ?r), above(?pb, ?pa, ?r), not exempt(?a, ?b).

% "forbid: A -> B"
[forbidden]  violates(?a, ?b, ?r) :- imports(?a, ?b), forbid(?pa, ?pb, ?r), under(?a, ?pa), under(?b, ?pb), not exempt(?a, ?b).

% "only: A -> B": files under B may be imported only from A, or from inside B itself.
[may-use]    mayUse(?a, ?pb, ?r) :- under(?a, ?pa), onlyFrom(?pb, ?pa, ?r).
[may-use-in] mayUse(?a, ?pb, ?r) :- under(?a, ?pb), guarded(?pb, ?r).
[guarded]    violates(?a, ?b, ?r) :- imports(?a, ?b), guarded(?pb, ?r), under(?b, ?pb), not mayUse(?a, ?pb, ?r), not exempt(?a, ?b).
`;

const PROGRAM = Program.fromText(RULE_BASE);

export interface Violation {
  source: string;
  target: string;
  /** Ids of the user's rules it breaks. */
  rules: string[];
}

export interface ViolationReason {
  rule: PolicyRule;
  /** Engine rule that fired: "upward", "forbidden" or "guarded". */
  kind: string;
  summary: string;
  proof: Proof;
}

/** Joined to file paths; never appears in real ones. */
const PAIR = "\u0000";

function patternRegex(pattern: string): RegExp {
  const escaped = pattern
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${escaped}(?:/|$)`);
}

export class Policy {
  readonly rules: PolicyRule[];
  readonly errors: PolicyError[];
  readonly patterns: string[];
  private readonly regexes: Map<string, RegExp>;
  private readonly facts: string[][];
  private readonly keep: string[];
  private readonly patternCache = new Map<string, string[]>();
  private readonly checkCache = new Map<string, string[]>();

  constructor(
    source: string,
    /** Folder every file shares (e.g. "src"); paths in rules may leave it out. */
    private readonly prefix = "",
  ) {
    const parsed = parsePolicy(source);
    this.rules = parsed.rules;
    this.errors = parsed.errors;
    const constraining = this.rules.filter((r) => r.kind !== "keep");
    this.keep = this.rules.filter((r) => r.kind === "keep").flatMap((r) => r.from);
    this.patterns = [...new Set(constraining.flatMap((r) => [...r.groups.flat(), ...r.from, ...r.to]))].sort();
    this.regexes = new Map(this.patterns.map((p) => [p, patternRegex(p)]));

    const facts: string[][] = [];
    for (const r of constraining) {
      if (r.kind === "layers") {
        for (const p of r.groups.flat()) facts.push(["layerMember", p, r.id]);
        for (let i = 0; i + 1 < r.groups.length; i++) {
          for (const x of r.groups[i]) for (const y of r.groups[i + 1]) facts.push(["directlyAbove", x, y, r.id]);
        }
      } else {
        for (const a of r.from) {
          for (const b of r.to) {
            if (r.kind === "forbid") facts.push(["forbid", a, b, r.id]);
            else if (r.kind === "only") facts.push(["onlyFrom", b, a, r.id]);
            else facts.push(["allow", a, b, r.id]);
          }
        }
        if (r.kind === "only") for (const b of r.to) facts.push(["guarded", b, r.id]);
      }
    }
    // inside(Q, P): path Q lies strictly under path P (used to pick the most specific layer).
    for (const q of this.patterns) for (const p of this.patterns) if (q !== p && this.regexes.get(p)!.test(q)) facts.push(["inside", q, p]);
    this.facts = facts;
  }

  /** True when there is at least one rule that can be violated. */
  get active(): boolean {
    return this.rules.some((r) => r.kind !== "keep");
  }

  private relative(path: string): string {
    return this.prefix && path.startsWith(`${this.prefix}/`) ? path.slice(this.prefix.length + 1) : path;
  }

  matches(path: string, pattern: string): boolean {
    const re = this.regexes.get(pattern) ?? patternRegex(pattern);
    return re.test(this.relative(path)) || re.test(path);
  }

  /** Rule paths that contain `path`. */
  patternsFor(path: string): string[] {
    let list = this.patternCache.get(path);
    if (!list) {
      list = this.patterns.filter((p) => this.matches(path, p));
      this.patternCache.set(path, list);
    }
    return list;
  }

  isKept(path: string): boolean {
    return this.keep.some((p) => this.matches(path, p));
  }

  private factsFor(paths: Iterable<string>, edges: Iterable<[string, string]>): string[][] {
    const facts = [...this.facts];
    for (const path of paths) for (const p of this.patternsFor(path)) facts.push(["under", path, p]);
    for (const [a, b] of edges) facts.push(["imports", a, b]);
    return facts;
  }

  /**
   * Which rule paths contain `path`, as one string. Two files with the same signature are
   * indistinguishable to every rule (paths are opaque constants to the engine).
   */
  signature(path: string): string {
    return this.patternsFor(path).join(PAIR);
  }

  /**
   * Rules broken by "a file at `pathA` imports a file at `pathB`" — the planner's goal test.
   * Rules only look at the two endpoints, and only through the rule paths containing them, so the
   * engine's answer is memoised per pair of signatures.
   */
  check(pathA: string, pathB: string): string[] {
    if (!this.active) return [];
    const key = this.signature(pathA) + PAIR + PAIR + this.signature(pathB);
    let result = this.checkCache.get(key);
    if (!result) {
      const found = PROGRAM.run(this.factsFor([pathA, pathB], [[pathA, pathB]])).query("violates").map((t) => t[2]);
      result = [...new Set(found)].sort();
      this.checkCache.set(key, result);
    }
    return result;
  }

  /** Runs the engine over a whole graph at once (all imports and locations as facts). */
  evaluate(files: readonly { id: string; path: string }[], edges: readonly { source: string; target: string }[]): {
    violations: Violation[];
    stats: RunStats;
    model: Model;
  } {
    const pathOf = new Map(files.map((f) => [f.id, f.path]));
    const idOf = new Map(files.map((f) => [f.path, f.id]));
    const pairs = edges.map((e) => [pathOf.get(e.source)!, pathOf.get(e.target)!] as [string, string]);
    const model = PROGRAM.run(this.factsFor(pathOf.values(), pairs));
    const byEdge = new Map<string, Violation>();
    for (const [a, b, r] of model.query("violates")) {
      const source = idOf.get(a)!;
      const target = idOf.get(b)!;
      const key = source + PAIR + target;
      const v = byEdge.get(key) ?? { source, target, rules: [] };
      v.rules.push(r);
      byEdge.set(key, v);
    }
    const violations = [...byEdge.values()].map((v) => ({ ...v, rules: v.rules.sort() }));
    violations.sort((x, y) => x.source.localeCompare(y.source) || x.target.localeCompare(y.target));
    return { violations, stats: model.stats, model };
  }

  /** Why `pathA -> pathB` breaks each rule: the proof the engine found, plus a sentence. */
  explain(pathA: string, pathB: string): ViolationReason[] {
    if (!this.active) return [];
    const model = PROGRAM.run(this.factsFor([pathA, pathB], [[pathA, pathB]]));
    return model.query("violates").map(([a, b, r]) => {
      const proof = model.explain("violates", [a, b, r])!;
      const rule = this.rules.find((x) => x.id === r)!;
      return { rule, kind: proof.rule ?? "", proof, summary: this.summarize(proof, rule, a, b) };
    });
  }

  private summarize(proof: Proof, rule: PolicyRule, a: string, b: string): string {
    const premises = proof.premises.map((p) => parseFact(p.fact));
    const find = (pred: string, first?: string) => premises.find((p) => p.pred === pred && (first === undefined || p.args[0] === first))?.args ?? [];
    const relA = this.relative(a);
    const relB = this.relative(b);
    if (proof.rule === "upward") {
      return `${relA} is in layer "${find("inLayer", a)[1]}" but imports ${relB} from "${find("inLayer", b)[1]}", a layer above it.`;
    }
    if (proof.rule === "forbidden") {
      const [pa, pb] = find("forbid");
      return `${relA} imports ${relB}, and files in "${pa}" may not import "${pb}".`;
    }
    const allowed = rule.from.map((p) => `"${p}"`).join(", ");
    return `${relB} is in "${find("guarded")[0]}", which only ${allowed} may import — ${relA} is outside that.`;
  }
}

// ---------------------------------------------------------------------------------------------
// Suggested starting rules

const TIERS: [string, RegExp][] = [
  ["entry", /^(app|pages|routes|views|screens|cli|bin|commands)$/],
  ["ui", /^(components|ui|widgets|layouts?)$/],
  ["logic", /^(hooks|state|stores?|contexts?|services|api|actions|controllers|features|modules)$/],
  ["data", /^(data|db|database|models|repositories|repository|entities|schemas?|prisma|dal)$/],
  ["shared", /^(lib|libs|utils?|helpers|shared|common|core|config|constants|types|styles)$/],
];

/**
 * A first set of rules for a project, from its module names: conventional folders are ordered
 * into layers (entry points > UI > logic > data > shared code), and if both UI and data folders
 * exist, UI code is forbidden from reaching data access directly.
 */
export function suggestRules(modules: readonly { label: string }[], moduleEdges: readonly { source: string; target: string }[] = [], labelOf: (id: string) => string = (id) => id): string {
  const names = [...new Set(modules.map((m) => m.label).filter((l) => PATTERN.test(l) && !l.includes("(")))].sort();
  const tierOf = (name: string) => TIERS.findIndex(([, re]) => re.test(name.split("/")[0].toLowerCase()));
  const tiers = TIERS.map(() => [] as string[]);
  for (const n of names) {
    const t = tierOf(n);
    if (t !== -1) tiers[t].push(n);
  }
  const used = tiers.filter((t) => t.length > 0);

  const lines = ["# Architecture rules — edit freely. One rule per line; paths are folders or files."];
  if (used.length >= 2) {
    lines.push("# Each layer may import itself and the layers below it, never the ones above.");
    lines.push(`layers: ${used.map((t) => t.join(", ")).join(" > ")}`);
    const front = [...tiers[0], ...tiers[1]];
    if (front.length > 0 && tiers[3].length > 0) {
      lines.push("# UI code should reach data through services, not directly.");
      lines.push(`forbid: ${front.join(", ")} -> ${tiers[3].join(", ")}`);
    }
    return `${lines.join("\n")}\n`;
  }

  // No conventional names: describe the current module order (longest path from the top),
  // ignoring the edges that close cycles, so the rule starts out matching the code.
  const out = new Map<string, string[]>();
  for (const e of moduleEdges) {
    const a = labelOf(e.source);
    const b = labelOf(e.target);
    if (names.includes(a) && names.includes(b)) out.set(a, [...(out.get(a) ?? []), b]);
  }
  const level = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (n: string): number => {
    if (level.has(n)) return level.get(n)!;
    if (visiting.has(n)) return -1;
    visiting.add(n);
    const importers = names.filter((m) => out.get(m)?.includes(n));
    const d = Math.max(0, ...importers.map((m) => depthOf(m) + 1));
    visiting.delete(n);
    level.set(n, d);
    return d;
  };
  names.forEach(depthOf);
  const byLevel = new Map<number, string[]>();
  for (const [n, d] of level) byLevel.set(d, [...(byLevel.get(d) ?? []), n]);
  const groups = [...byLevel.entries()].sort((x, y) => x[0] - y[0]).map(([, g]) => g.sort());
  if (groups.length >= 2) {
    lines.push("# Layers inferred from the current imports (top imports bottom). Tighten them to taste.");
    lines.push(`layers: ${groups.map((g) => g.join(", ")).join(" > ")}`);
  } else {
    lines.push("# Example:");
    lines.push("# layers: app > features > lib");
    lines.push("# forbid: components -> db");
  }
  return `${lines.join("\n")}\n`;
}
