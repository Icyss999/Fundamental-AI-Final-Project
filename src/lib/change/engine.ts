/**
 * A small forward-chaining (bottom-up) rule engine, written from scratch: Datalog with
 * stratified negation-as-failure and provenance.
 *
 *   violates(?a, ?b, ?r) :- imports(?a, ?b), forbid(?pa, ?pb, ?r), under(?a, ?pa), under(?b, ?pb), not exempt(?a, ?b).
 *
 * - Terms: `?name` is a variable, `_` an anonymous variable, anything else a constant.
 * - Body literals: positive atoms, `not atom` (negation as failure) and `?x != ?y`.
 * - Safety: every variable in the head, in a negated atom or in `!=` must occur in a positive atom.
 * - Stratification: predicates are split into strata so that a predicate is only negated after it
 *   is complete; recursion through negation is rejected.
 * - Evaluation: semi-naive — after the first round, a rule only re-fires on combinations that use
 *   at least one fact derived in the previous round.
 * - Provenance: the first derivation of every fact (rule + premises) is kept, so any conclusion
 *   can be explained as a proof tree.
 */

export interface Atom {
  pred: string;
  args: string[];
}

export type Literal =
  | ({ kind: "pos" } & Atom)
  | ({ kind: "neg" } & Atom)
  | { kind: "neq"; left: string; right: string };

export interface Rule {
  id: string;
  head: Atom;
  body: Literal[];
  /** Source text, for explanations. */
  text: string;
}

export type Tuple = readonly string[];

const SEP = "\u0001";
const isVar = (t: string) => t.startsWith("?");
export const factKey = (pred: string, args: Tuple) => `${pred}${SEP}${args.join(SEP)}`;

export function parseFact(key: string): { pred: string; args: string[] } {
  const [pred, ...args] = key.split(SEP);
  return { pred, args };
}

/** Human-readable `pred(a, b)` from a fact key. */
export function formatFact(key: string): string {
  const { pred, args } = parseFact(key);
  return `${pred}(${args.join(", ")})`;
}

export class RuleError extends Error {}

// ---------------------------------------------------------------------------------------------
// Parsing

const ATOM = /^([a-z][A-Za-z0-9_]*)\s*\(([^()]*)\)$/;

function parseAtom(text: string, fresh: () => string): Atom {
  const m = text.trim().match(ATOM);
  if (!m) throw new RuleError(`Not an atom: "${text.trim()}"`);
  const args = m[2].trim() === "" ? [] : m[2].split(",").map((a) => a.trim());
  return { pred: m[1], args: args.map((a) => (a === "_" ? fresh() : a.replace(/^"(.*)"$/, "$1"))) };
}

/** Splits on commas that are not inside parentheses. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if (text[i] === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Parses rules written as `[id] head :- literal, literal.` (one or more lines each,
 * ending with a period). `%` starts a comment. Facts are not written here; they are passed to `run`.
 */
export function parseRules(source: string): Rule[] {
  const text = source.replace(/%[^\n]*/g, "");
  const rules: Rule[] = [];
  let anon = 0;
  const fresh = () => `?_${anon++}`;
  for (const raw of text.split(/\.\s*(?:\n|$)/)) {
    const clause = raw.trim();
    if (!clause) continue;
    const labelled = clause.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
    const id = labelled ? labelled[1] : `r${rules.length + 1}`;
    const body = labelled ? labelled[2] : clause;
    const [headText, bodyText] = body.split(":-");
    if (bodyText === undefined) throw new RuleError(`Rule "${clause}" has no ":-"`);
    const literals: Literal[] = splitTopLevel(bodyText).map((lit) => {
      const neq = lit.match(/^(\S+)\s*!=\s*(\S+)$/);
      if (neq) return { kind: "neq", left: neq[1], right: neq[2] };
      if (/^not\s+/.test(lit)) return { kind: "neg", ...parseAtom(lit.replace(/^not\s+/, ""), fresh) };
      return { kind: "pos", ...parseAtom(lit, fresh) };
    });
    rules.push({ id, head: parseAtom(headText, fresh), body: literals, text: `${clause}.` });
  }
  return rules;
}

// ---------------------------------------------------------------------------------------------
// Storage

class Relation {
  readonly tuples: Tuple[] = [];
  private readonly keys = new Set<string>();
  private readonly indexes = new Map<number, Map<string, Tuple[]>>();

  constructor(readonly pred: string) {}

  has(args: Tuple): boolean {
    return this.keys.has(args.join(SEP));
  }

  add(args: Tuple): boolean {
    const key = args.join(SEP);
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    this.tuples.push(args);
    for (const [pos, index] of this.indexes) {
      const bucket = index.get(args[pos]);
      if (bucket) bucket.push(args);
      else index.set(args[pos], [args]);
    }
    return true;
  }

  /** Tuples whose argument at `pos` equals `value` (index built on first use). */
  lookup(pos: number, value: string): Tuple[] {
    let index = this.indexes.get(pos);
    if (!index) {
      index = new Map();
      for (const t of this.tuples) {
        const bucket = index.get(t[pos]);
        if (bucket) bucket.push(t);
        else index.set(t[pos], [t]);
      }
      this.indexes.set(pos, index);
    }
    return index.get(value) ?? [];
  }
}

const EMPTY = new Relation("");

// ---------------------------------------------------------------------------------------------
// Program: validation + stratification

export interface Derivation {
  rule: string;
  /** Keys of the positive facts the rule matched. */
  premises: string[];
  /** Negated atoms that held because the fact was absent. */
  absent: string[];
}

export interface Proof {
  fact: string;
  /** Rule id, or undefined for a given fact. */
  rule?: string;
  premises: Proof[];
  absent: string[];
}

export interface RunStats {
  given: number;
  derived: number;
  rounds: number;
  strata: number;
}

function variablesOf(args: readonly string[]): string[] {
  return args.filter(isVar);
}

export class Program {
  readonly rules: Rule[];
  /** Rules grouped by stratum, lowest first. */
  readonly strata: Rule[][];

  constructor(rules: Rule[]) {
    this.rules = rules;
    for (const r of rules) Program.checkSafety(r);
    this.strata = Program.stratify(rules);
  }

  static fromText(source: string): Program {
    return new Program(parseRules(source));
  }

  private static checkSafety(rule: Rule) {
    const bound = new Set<string>();
    for (const l of rule.body) if (l.kind === "pos") variablesOf(l.args).forEach((v) => bound.add(v));
    const needed = [
      ...variablesOf(rule.head.args),
      ...rule.body.flatMap((l) => (l.kind === "neg" ? variablesOf(l.args) : l.kind === "neq" ? variablesOf([l.left, l.right]) : [])),
    ];
    // An anonymous "_" is a fresh variable that occurs once, so outside positive atoms it is always unbound.
    const unbound = [...new Set(needed.filter((v) => !bound.has(v)).map((v) => (v.startsWith("?_") ? "_" : v)))];
    if (unbound.length > 0) throw new RuleError(`Rule ${rule.id} is unsafe: ${unbound.join(", ")} not bound by a positive atom`);
  }

  /**
   * Predicate dependency graph (head -> body predicate), strongly connected components by
   * Tarjan's algorithm. A component is finished only after everything it depends on, so the
   * order components finish in is a valid evaluation order. Negation inside a component means
   * recursion through negation, which has no stratified meaning.
   */
  private static stratify(rules: Rule[]): Rule[][] {
    const idb = new Set(rules.map((r) => r.head.pred));
    const deps = new Map<string, Set<string>>([...idb].map((p) => [p, new Set<string>()]));
    for (const r of rules) {
      for (const l of r.body) if (l.kind !== "neq" && idb.has(l.pred)) deps.get(r.head.pred)!.add(l.pred);
    }

    let counter = 0;
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const components: string[][] = [];
    const visit = (p: string) => {
      index.set(p, counter);
      low.set(p, counter++);
      stack.push(p);
      onStack.add(p);
      for (const q of deps.get(p)!) {
        if (!index.has(q)) {
          visit(q);
          low.set(p, Math.min(low.get(p)!, low.get(q)!));
        } else if (onStack.has(q)) {
          low.set(p, Math.min(low.get(p)!, index.get(q)!));
        }
      }
      if (low.get(p) === index.get(p)) {
        const comp: string[] = [];
        let q: string;
        do {
          q = stack.pop()!;
          onStack.delete(q);
          comp.push(q);
        } while (q !== p);
        components.push(comp);
      }
    };
    // Predicate graphs are tiny, so plain recursion is fine here.
    for (const p of idb) if (!index.has(p)) visit(p);

    return components.map((comp) => {
      const members = new Set(comp);
      const stratumRules = rules.filter((r) => members.has(r.head.pred));
      for (const r of stratumRules) {
        for (const l of r.body) {
          if (l.kind === "neg" && members.has(l.pred)) {
            throw new RuleError(`Not stratifiable: ${r.head.pred} depends negatively on ${l.pred} through recursion (rule ${r.id})`);
          }
        }
      }
      return stratumRules;
    });
  }

  /** Derives everything that follows from `facts` (each fact is [predicate, ...arguments]). */
  run(facts: Iterable<readonly string[]>): Model {
    return new Model(this, facts);
  }
}

// ---------------------------------------------------------------------------------------------
// Evaluation

type Binding = Map<string, string>;

export class Model {
  private readonly relations = new Map<string, Relation>();
  private readonly provenance = new Map<string, Derivation>();
  readonly stats: RunStats;

  constructor(
    private readonly program: Program,
    facts: Iterable<readonly string[]>,
  ) {
    let given = 0;
    for (const [pred, ...args] of facts) if (this.relation(pred).add(args)) given++;
    let derived = 0;
    let rounds = 0;
    for (const stratum of program.strata) {
      const r = this.evaluateStratum(stratum);
      derived += r.derived;
      rounds += r.rounds;
    }
    this.stats = { given, derived, rounds, strata: program.strata.length };
  }

  private relation(pred: string): Relation {
    let r = this.relations.get(pred);
    if (!r) {
      r = new Relation(pred);
      this.relations.set(pred, r);
    }
    return r;
  }

  private evaluateStratum(rules: Rule[]): { derived: number; rounds: number } {
    const recursive = new Set(rules.map((r) => r.head.pred));
    let derived = 0;
    let rounds = 1;

    // Round 1: every rule over all known facts.
    let delta = new Map<string, Relation>();
    for (const rule of rules) derived += this.fire(rule, -1, null, delta);

    // Later rounds: only combinations that use a fact derived in the previous round.
    while ([...delta.values()].some((r) => r.tuples.length > 0)) {
      rounds++;
      const next = new Map<string, Relation>();
      for (const rule of rules) {
        rule.body.forEach((l, i) => {
          if (l.kind === "pos" && recursive.has(l.pred) && delta.get(l.pred)?.tuples.length) {
            derived += this.fire(rule, i, delta.get(l.pred)!, next);
          }
        });
      }
      delta = next;
    }
    return { derived, rounds };
  }

  /**
   * Evaluates one rule. If `deltaAt` >= 0, the body literal at that position reads only `delta`.
   * New head facts are collected first and inserted afterwards, so relations are never
   * modified while being iterated. Returns how many new facts were added.
   */
  private fire(rule: Rule, deltaAt: number, delta: Relation | null, out: Map<string, Relation>): number {
    const found: { args: string[]; premises: string[]; absent: string[] }[] = [];
    const positives = rule.body.map((l, i) => ({ l, i })).filter((x) => x.l.kind === "pos") as { l: Literal & { kind: "pos" }; i: number }[];
    const remaining = new Set(positives.map((p) => p.i));
    const premises: string[] = [];

    const source = (i: number, pred: string) => (i === deltaAt ? delta! : (this.relations.get(pred) ?? EMPTY));

    const step = (binding: Binding) => {
      if (remaining.size === 0) {
        const absent: string[] = [];
        for (const l of rule.body) {
          if (l.kind === "neq") {
            if (resolve(l.left, binding) === resolve(l.right, binding)) return;
          } else if (l.kind === "neg") {
            const args = l.args.map((a) => resolve(a, binding));
            if (this.relations.get(l.pred)?.has(args)) return;
            absent.push(factKey(l.pred, args));
          }
        }
        found.push({ args: rule.head.args.map((a) => resolve(a, binding)), premises: [...premises], absent });
        return;
      }

      // Next literal: the delta one first (it is small), then the one with the most bound arguments.
      let pick = -1;
      let pickScore = -1;
      for (const { l, i } of positives) {
        if (!remaining.has(i)) continue;
        const score = i === deltaAt ? Infinity : l.args.filter((a) => !isVar(a) || binding.has(a)).length;
        if (score > pickScore) {
          pick = i;
          pickScore = score;
        }
      }
      const lit = rule.body[pick] as Literal & { kind: "pos" };
      const rel = source(pick, lit.pred);
      const boundPos = lit.args.findIndex((a) => !isVar(a) || binding.has(a));
      const candidates = boundPos === -1 ? rel.tuples : rel.lookup(boundPos, resolve(lit.args[boundPos], binding));

      remaining.delete(pick);
      for (const tuple of candidates) {
        if (tuple.length !== lit.args.length) continue;
        const added: string[] = [];
        let ok = true;
        for (let k = 0; k < lit.args.length; k++) {
          const term = lit.args[k];
          if (!isVar(term)) {
            if (term !== tuple[k]) ok = false;
          } else if (binding.has(term)) {
            if (binding.get(term) !== tuple[k]) ok = false;
          } else {
            binding.set(term, tuple[k]);
            added.push(term);
          }
          if (!ok) break;
        }
        if (ok) {
          premises.push(factKey(lit.pred, tuple));
          step(binding);
          premises.pop();
        }
        for (const v of added) binding.delete(v);
      }
      remaining.add(pick);
    };
    step(new Map());

    let count = 0;
    const head = this.relation(rule.head.pred);
    for (const f of found) {
      if (!head.add(f.args)) continue;
      count++;
      this.provenance.set(factKey(rule.head.pred, f.args), { rule: rule.id, premises: f.premises, absent: f.absent });
      let d = out.get(rule.head.pred);
      if (!d) {
        d = new Relation(rule.head.pred);
        out.set(rule.head.pred, d);
      }
      d.add(f.args);
    }
    return count;
  }

  /** All tuples of `pred`, optionally filtered by a pattern (null = any value). */
  query(pred: string, pattern?: readonly (string | null)[]): Tuple[] {
    const rel = this.relations.get(pred);
    if (!rel) return [];
    if (!pattern) return [...rel.tuples];
    return rel.tuples.filter((t) => pattern.every((p, i) => p === null || p === t[i]));
  }

  has(pred: string, ...args: string[]): boolean {
    return this.relations.get(pred)?.has(args) ?? false;
  }

  /** Proof tree for a fact (null if it does not hold). */
  explain(pred: string, args: Tuple, maxDepth = 12): Proof | null {
    if (!this.has(pred, ...args)) return null;
    const build = (key: string, depth: number): Proof => {
      const d = this.provenance.get(key);
      if (!d || depth >= maxDepth) return { fact: key, premises: [], absent: [] };
      return { fact: key, rule: d.rule, premises: d.premises.map((p) => build(p, depth + 1)), absent: d.absent };
    };
    return build(factKey(pred, args), 0);
  }

  ruleText(id: string): string | undefined {
    return this.program.rules.find((r) => r.id === id)?.text;
  }
}

function resolve(term: string, binding: Binding): string {
  return isVar(term) ? binding.get(term)! : term;
}
