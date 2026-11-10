import { describe, expect, it } from "vitest";
import { formatFact, Program, RuleError } from "./engine";
import { edgeKey, edgesAfter, formatAtom, planRefactoring, type PlanEdge, type PlanFile, type PlanProblem } from "./planner";
import { parsePolicy, Policy, suggestRules } from "./rules";

describe("forward-chaining engine", () => {
  const reach = Program.fromText(`
    reach(?x, ?y) :- edge(?x, ?y).
    reach(?x, ?z) :- reach(?x, ?y), edge(?y, ?z).
    unreachable(?x) :- node(?x), not reach(a, ?x).
    pair(?x, ?y) :- node(?x), node(?y), ?x != ?y.
  `);

  it("derives a transitive closure to a fixpoint (semi-naive rounds)", () => {
    const edges = [["a", "b"], ["b", "c"], ["c", "d"], ["d", "b"]];
    const model = reach.run([...edges.map(([x, y]) => ["edge", x, y]), ...["a", "b", "c", "d", "e"].map((n) => ["node", n])]);
    expect(model.query("reach", ["a", null]).map((t) => t[1]).sort()).toEqual(["b", "c", "d"]);
    expect(model.has("reach", "d", "d")).toBe(true);
    expect(model.query("reach")).toHaveLength(3 + 3 * 3);
    expect(model.stats.rounds).toBeGreaterThan(2);
  });

  it("evaluates negation only after the negated predicate is complete (stratification)", () => {
    const model = reach.run([["edge", "a", "b"], ["edge", "b", "c"], ...["a", "b", "c", "z"].map((n) => ["node", n])]);
    expect(model.query("unreachable").map((t) => t[0]).sort()).toEqual(["a", "z"]);
    expect(reach.strata.findIndex((s) => s.some((r) => r.head.pred === "reach"))).toBeLessThan(
      reach.strata.findIndex((s) => s.some((r) => r.head.pred === "unreachable")),
    );
  });

  it("supports != and anonymous variables", () => {
    const model = reach.run([["node", "a"], ["node", "b"]]);
    expect(model.query("pair").map((t) => t.join("")).sort()).toEqual(["ab", "ba"]);
    const p = Program.fromText("hasOut(?x) :- edge(?x, _).");
    expect(p.run([["edge", "a", "b"], ["edge", "a", "c"]]).query("hasOut")).toEqual([["a"]]);
  });

  it("rejects recursion through negation and unsafe rules", () => {
    expect(() => Program.fromText("p(?x) :- q(?x), not p(?x).")).toThrow(/stratifiable/);
    expect(() => Program.fromText("p(?x) :- not q(?x).")).toThrow(RuleError);
    expect(() => Program.fromText("p(?x, ?y) :- q(?x).")).toThrow(/\?y/);
    expect(() => Program.fromText("p(?x) :- q(?x), not r(_).")).toThrow(/unsafe/);
    expect(() => Program.fromText("p(?x) q(?x).")).toThrow(/:-/);
  });

  it("keeps a proof tree for every derived fact", () => {
    const model = reach.run([["edge", "a", "b"], ["edge", "b", "c"]]);
    const proof = model.explain("reach", ["a", "c"])!;
    expect(proof.rule).toBe("r2");
    expect(proof.premises.map((p) => formatFact(p.fact)).sort()).toEqual(["edge(b, c)", "reach(a, b)"]);
    expect(proof.premises.find((p) => p.rule)?.premises.map((p) => formatFact(p.fact))).toEqual(["edge(a, b)"]);
    expect(model.explain("reach", ["c", "a"])).toBeNull();
  });
});

describe("rules format", () => {
  it("parses rules and reports errors by line", () => {
    const { rules, errors } = parsePolicy(
      [
        "# comment",
        "layers: pages > components > services, state > data > lib",
        "forbid: pages, components -> data",
        "only: services → data/db.ts",
        "keep: data",
        "layers: ui",
        "forbid: a b -> c",
        "nope: x",
        "only: a",
        "layers: a > b > a",
      ].join("\n"),
    );
    expect(rules.map((r) => [r.id, r.kind])).toEqual([["L2", "layers"], ["L3", "forbid"], ["L4", "only"], ["L5", "keep"]]);
    expect(rules[0].groups).toEqual([["pages"], ["components"], ["services", "state"], ["data"], ["lib"]]);
    expect(rules[2]).toMatchObject({ from: ["services"], to: ["data/db.ts"] });
    expect(errors.map((e) => e.line)).toEqual([6, 7, 8, 9, 10]);
  });
});

describe("Policy", () => {
  const policy = new Policy(
    [
      "layers: pages > components > services, state > data > lib",
      "forbid: pages, components -> data",
      "only: services -> data",
      "allow: components/Legacy.tsx -> data",
    ].join("\n"),
    "src",
  );

  it("derives layer, forbid and only violations", () => {
    expect(policy.check("src/pages/menu.tsx", "src/services/menu.ts")).toEqual([]);
    expect(policy.check("src/services/a.ts", "src/state/b.ts")).toEqual([]); // same layer
    expect(policy.check("src/lib/utils.ts", "src/pages/menu.tsx")).toEqual(["L1"]); // upward
    expect(policy.check("src/pages/menu.tsx", "src/data/db.ts")).toEqual(["L2", "L3"]);
    expect(policy.check("src/state/cart.ts", "src/data/db.ts")).toEqual(["L3"]); // only services
    expect(policy.check("src/data/repo.ts", "src/data/db.ts")).toEqual([]); // inside the guarded folder
    expect(policy.check("src/components/Legacy.tsx", "src/data/db.ts")).toEqual([]); // allowed exception
    expect(policy.check("other/x.ts", "src/data/db.ts")).toEqual(["L3"]);
  });

  it("puts a file in its most specific layer and supports * segments", () => {
    const nested = new Policy("layers: ui > ui/base\nforbid: features/*/api -> ui");
    expect(nested.check("ui/base/Button.tsx", "ui/Page.tsx")).toEqual(["L1"]);
    expect(nested.check("ui/Page.tsx", "ui/base/Button.tsx")).toEqual([]);
    expect(nested.check("features/cart/api/load.ts", "ui/Page.tsx")).toEqual(["L2"]);
    expect(nested.check("features/cart/model.ts", "ui/Page.tsx")).toEqual([]);
  });

  it("explains a violation with the engine's proof", () => {
    const [reason] = policy.explain("src/lib/utils.ts", "src/pages/menu.tsx");
    expect(reason.kind).toBe("upward");
    expect(reason.rule.id).toBe("L1");
    expect(reason.summary).toBe('lib/utils.ts is in layer "lib" but imports pages/menu.tsx from "pages", a layer above it.');
    const facts = reason.proof.premises.map((p) => formatFact(p.fact));
    expect(facts).toContain("imports(src/lib/utils.ts, src/pages/menu.tsx)");
    expect(facts).toContain("above(pages, lib, L1)");
  });

  it("agrees with a whole-graph run of the engine", () => {
    const files = ["src/pages/a.tsx", "src/components/b.tsx", "src/services/c.ts", "src/data/db.ts", "src/lib/u.ts"].map((id) => ({ id, path: id }));
    const edges = [
      ["src/pages/a.tsx", "src/data/db.ts"],
      ["src/components/b.tsx", "src/services/c.ts"],
      ["src/services/c.ts", "src/data/db.ts"],
      ["src/lib/u.ts", "src/components/b.tsx"],
      ["src/data/db.ts", "src/lib/u.ts"],
    ].map(([source, target]) => ({ source, target }));
    const { violations, stats } = policy.evaluate(files, edges);
    const perEdge = edges.map((e) => ({ ...e, rules: policy.check(e.source, e.target) })).filter((v) => v.rules.length > 0);
    expect(violations).toEqual(perEdge.sort((x, y) => x.source.localeCompare(y.source)));
    expect(stats.derived).toBeGreaterThan(0);
  });

  it("suggests conventional layers, or infers them from the imports", () => {
    const text = suggestRules(["components", "data", "lib", "pages", "services", "state"].map((label) => ({ label })));
    expect(text).toContain("layers: pages > components > services, state > data > lib");
    expect(text).toContain("forbid: pages, components -> data");
    expect(new Policy(text).errors).toEqual([]);

    const inferred = suggestRules([{ label: "a" }, { label: "b" }, { label: "c" }], [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "a", target: "c" },
    ]);
    expect(inferred).toContain("layers: a > b > c");
  });
});

// ---------------------------------------------------------------------------------------------

function problemOf(ids: string[], edges: [string, string, boolean?][], rules: string, risk?: Record<string, number>): PlanProblem {
  const files: PlanFile[] = ids.map((id) => {
    const slash = id.lastIndexOf("/");
    return { id, dir: slash === -1 ? "" : id.slice(0, slash), name: id.slice(slash + 1) };
  });
  return {
    files,
    edges: edges.map(([source, target, typeOnly]) => ({ source, target, typeOnly: typeOnly ?? false })),
    policy: new Policy(rules),
    risk: risk ? new Map(Object.entries(risk)) : undefined,
  };
}

describe("A* refactoring planner", () => {
  it("has nothing to do when no import breaks a rule", () => {
    const r = planRefactoring(problemOf(["ui/a.ts", "data/db.ts"], [["ui/a.ts", "data/db.ts"]], "layers: ui > data"));
    expect(r.status).toBe("nothing-to-do");
    expect(r.steps).toEqual([]);
  });

  it("redirects an import through a file that may use the target", () => {
    const p = problemOf(
      ["ui/page.tsx", "services/menu.ts", "data/db.ts"],
      [["ui/page.tsx", "data/db.ts"], ["services/menu.ts", "data/db.ts"]],
      "forbid: ui -> data",
    );
    const r = planRefactoring(p);
    expect(r.status).toBe("solved");
    expect(r.steps.map((s) => s.action)).toEqual([{ kind: "redirect", file: "ui/page.tsx", from: "data/db.ts", to: "services/menu.ts" }]);
    expect(r.cost).toBe(1);
    const step = r.steps[0];
    expect(step.strips.name).toBe("RedirectImport(ui/page.tsx, data/db.ts, services/menu.ts)");
    expect(step.strips.pre.map(formatAtom)).toEqual(["imports(ui/page.tsx, data/db.ts)", "imports(services/menu.ts, data/db.ts)"]);
    expect(step.strips.add.map(formatAtom)).toEqual(["imports(ui/page.tsx, services/menu.ts)"]);
    expect(step.strips.del.map(formatAtom)).toEqual(["imports(ui/page.tsx, data/db.ts)"]);
    expect(step.fixed).toEqual([edgeKey("ui/page.tsx", "data/db.ts")]);
    const after = edgesAfter(p.edges, step.state);
    expect(after.map((e) => edgeKey(e.source, e.target)).sort()).toEqual(
      [edgeKey("services/menu.ts", "data/db.ts"), edgeKey("ui/page.tsx", "services/menu.ts")].sort(),
    );
  });

  it("moves one file when that fixes several imports at once", () => {
    const p = problemOf(
      ["ui/a.tsx", "ui/b.tsx", "data/schema.ts", "data/db.ts", "lib/u.ts"],
      [["ui/a.tsx", "data/schema.ts", true], ["ui/b.tsx", "data/schema.ts", true], ["data/db.ts", "data/schema.ts", true], ["data/db.ts", "lib/u.ts"]],
      "layers: ui > data > lib\nforbid: ui -> data",
    );
    const r = planRefactoring(p);
    expect(r.status).toBe("solved");
    expect(r.steps.map((s) => s.action)).toEqual([{ kind: "move", file: "data/schema.ts", from: "data", to: "lib" }]);
    expect(r.steps[0].costParts).toEqual({ base: 1, rewrites: 1.5, risk: 0 });
    expect(r.steps[0].strips.preNot.map(formatAtom)).toEqual(["exists(lib/schema.ts)"]);
    expect(r.steps[0].state.moves).toEqual([["data/schema.ts", "lib"]]);
  });

  it("finds the same optimal cost as uniform-cost search on random instances, expanding no more", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const dirs = ["ui", "logic", "data", "lib"];
    for (let trial = 0; trial < 25; trial++) {
      const ids = Array.from({ length: 7 }, (_, i) => `${dirs[Math.floor(rand() * dirs.length)]}/f${i}.ts`);
      const edges: [string, string][] = [];
      for (let i = 0; i < 11; i++) {
        const a = ids[Math.floor(rand() * ids.length)];
        const b = ids[Math.floor(rand() * ids.length)];
        if (a !== b) edges.push([a, b]);
      }
      const risk = Object.fromEntries(ids.map((id) => [id, Math.round(rand() * 10) / 10]));
      const p = problemOf(ids, edges, "layers: ui > logic > data > lib\nforbid: ui -> data", risk);
      const astar = planRefactoring(p, { heuristic: "matching" });
      const ucs = planRefactoring(p, { heuristic: "zero" });
      expect(astar.status).toBe(ucs.status);
      if (ucs.status !== "solved") continue;
      expect(astar.cost).toBeCloseTo(ucs.cost, 9);
      expect(astar.stats.hStart).toBeLessThanOrEqual(ucs.cost + 1e-9); // admissible
      expect(astar.stats.expanded).toBeLessThanOrEqual(ucs.stats.expanded);
    }
  });

  it("shows why counting violating imports is not admissible", () => {
    // One move of `data/x.ts` fixes all three imports: cost 1 + 0.5 × 3 rewritten imports = 2.5. Counting says 3.
    const p = problemOf(
      ["data/x.ts", "ui/a.ts", "ui/b.ts", "ui/c.ts", "lib/l.ts"],
      [["data/x.ts", "ui/a.ts"], ["data/x.ts", "ui/b.ts"], ["data/x.ts", "ui/c.ts"]],
      "layers: ui > data > lib",
    );
    const count = planRefactoring(p, { heuristic: "count" });
    const matching = planRefactoring(p, { heuristic: "matching" });
    expect(matching.cost).toBe(2.5);
    expect(matching.steps.map((st) => st.action)).toEqual([{ kind: "move", file: "data/x.ts", from: "data", to: "ui" }]);
    expect(count.stats.hStart).toBe(3);
    expect(count.stats.hStart).toBeGreaterThan(matching.cost);
    expect(matching.stats.hStart).toBe(1);
  });

  it("respects keep rules and avoids risky files", () => {
    const ids = ["ui/page.tsx", "services/a.ts", "data/db.ts", "lib/u.ts"];
    const edges: [string, string][] = [["ui/page.tsx", "data/db.ts"], ["services/a.ts", "data/db.ts"]];
    // Moving db.ts would also fix it, but `keep` forbids that.
    const kept = planRefactoring(problemOf(ids, edges, "forbid: ui -> data\nkeep: data"));
    expect(kept.steps.every((s) => s.action.kind !== "move" || s.action.file !== "data/db.ts")).toBe(true);

    // Without a gateway, the page itself must move; with the page marked risky the planner prefers moving db.ts.
    const noGateway: [string, string][] = [["ui/page.tsx", "data/db.ts"]];
    const plain = planRefactoring(problemOf(ids, noGateway, "forbid: ui -> data"), { riskWeight: 3 });
    const risky = planRefactoring(problemOf(ids, noGateway, "forbid: ui -> data", { "ui/page.tsx": 1 }), { riskWeight: 3 });
    expect(plain.status).toBe("solved");
    expect(risky.steps[0].action.file).toBe("data/db.ts");
    expect(risky.steps[0].costParts.risk).toBe(0);
  });

  it("reports unsolvable problems and partial plans", () => {
    const stuck = planRefactoring(problemOf(["ui/a.ts", "data/db.ts"], [["ui/a.ts", "data/db.ts"]], "forbid: ui -> data\nkeep: ui, data"));
    expect(stuck.status).toBe("unsolvable");
    expect(stuck.finalViolations).toEqual([edgeKey("ui/a.ts", "data/db.ts")]);

    const ids = ["ui/a.ts", "ui/b.ts", "ui/c.ts", "data/d1.ts", "data/d2.ts", "data/d3.ts", "logic/s.ts"];
    const edges: [string, string][] = [["ui/a.ts", "data/d1.ts"], ["ui/b.ts", "data/d2.ts"], ["ui/c.ts", "data/d3.ts"], ["logic/s.ts", "data/d1.ts"], ["logic/s.ts", "data/d2.ts"], ["logic/s.ts", "data/d3.ts"]];
    const partial = planRefactoring(problemOf(ids, edges, "forbid: ui -> data\nkeep: ui, data"), { maxExpansions: 1 });
    expect(partial.status).toBe("partial");
    expect(partial.finalViolations.length).toBeLessThan(partial.initialViolations.length);
  });
});

describe("edgesAfter", () => {
  it("keeps the type-only flag of a redirected import", () => {
    const edges: PlanEdge[] = [{ source: "a", target: "b", typeOnly: true }, { source: "c", target: "b", typeOnly: false }];
    const after = edgesAfter(edges, { moves: [], removed: [edgeKey("a", "b")], added: [edgeKey("a", "c")], addedTypeOnly: [edgeKey("a", "c")] });
    expect(after).toEqual([{ source: "c", target: "b", typeOnly: false }, { source: "a", target: "c", typeOnly: true }]);
  });
});
