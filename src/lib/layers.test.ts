import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { planRefactoring, type PlanProblem } from "@/lib/change/planner";
import { Policy, suggestRules } from "@/lib/change/rules";
import { DEFAULT_DIAGNOSIS_PARAMS, prepareDiagnosis, scoreDiagnosis, type DiagnosisBasis } from "@/lib/diagnose/diagnose";
import { parseGitLog } from "@/lib/diagnose/history";
import { parseTestReport } from "@/lib/diagnose/reports";
import { extractGraph } from "@/lib/graph/extract";
import { analyzeProject, type ProjectAnalysis } from "@/lib/graph/project-analysis";

/** Layers 2 and 3 end to end on fixtures/restaurant-app (its git history and test report are fixtures). */
const sample = path.resolve(__dirname, "../../fixtures/restaurant-app");
let analysis: ProjectAnalysis;
let basis: DiagnosisBasis;
let report: ReturnType<typeof parseTestReport>;

beforeAll(async () => {
  const { graph } = await extractGraph(sample);
  analysis = analyzeProject(graph, "restaurant-app", false);
  const commits = parseGitLog(readFileSync(path.join(sample, "git-log.txt"), "utf8"));
  basis = prepareDiagnosis(graph, analysis.graph.nodes, commits, DEFAULT_DIAGNOSIS_PARAMS);
  report = parseTestReport(readFileSync(path.join(sample, "test-results.json"), "utf8"), basis.coverage.map((c) => c.id));
});

describe("Layer 2 on the sample", () => {
  it("builds the prior from history, skipping the bulk formatting commit", () => {
    const d = scoreDiagnosis(basis, new Map(), DEFAULT_DIAGNOSIS_PARAMS);
    expect(d.history).toMatchObject({ commits: 25, fixCommits: 8, bulkSkipped: 1 });
    expect(d.files.slice(0, 2).map((f) => f.id)).toEqual(["src/services/pricing.ts", "src/state/cartStore.ts"]);
    expect(d.byId.get("src/services/pricing.ts")!.history).toMatchObject({ fixes: 4 });
  });

  it("concentrates on pricing.ts once the failing tests are known — where Ochiai alone ranks it second", () => {
    expect(report.unmatched).toEqual([]);
    expect([...report.outcomes.values()].filter((o) => o === "fail")).toHaveLength(3);
    const d = scoreDiagnosis(basis, report.outcomes, DEFAULT_DIAGNOSIS_PARAMS);
    const pricing = d.files[0];
    expect(pricing.id).toBe("src/services/pricing.ts");
    expect(pricing.posterior).toBeGreaterThan(0.6);
    expect(pricing.ochiaiRank).toBe(2);
    expect(d.files.find((f) => f.ochiaiRank === 1)!.id).toBe("src/services/paymentService.ts");
    // Every failing test reaches pricing.ts; each one multiplies its odds.
    expect(pricing.factors.filter((f) => f.outcome === "fail")).toHaveLength(3);
  });
});

describe("Layer 3 on the sample", () => {
  let problem: PlanProblem;
  beforeAll(() => {
    const rules = suggestRules([...analysis.modules.keys()].map((m) => ({ label: analysis.labels[m] })));
    const d = scoreDiagnosis(basis, report.outcomes, DEFAULT_DIAGNOSIS_PARAMS);
    problem = {
      files: analysis.graph.nodes.map((n) => ({ id: n.id, dir: n.dir, name: n.name })),
      edges: analysis.graph.edges,
      policy: new Policy(rules, analysis.prefix),
      risk: new Map(d.files.map((f) => [f.id, f.posterior / d.maxPosterior])),
    };
  });

  it("finds the planted violations: UI code reaching into data/", () => {
    const files = analysis.graph.nodes.map((n) => ({ id: n.id, path: n.id }));
    const { violations } = problem.policy.evaluate(files, analysis.graph.edges);
    expect(violations.map((v) => `${v.source} -> ${v.target}`)).toEqual([
      "src/components/Cart.tsx -> src/data/db.ts",
      "src/components/MenuItemCard.tsx -> src/data/schema.ts",
      "src/components/MenuList.tsx -> src/data/schema.ts",
      "src/pages/menu.tsx -> src/data/db.ts",
      "src/pages/order.tsx -> src/data/db.ts",
    ]);
  });

  it("plans: route the pages through menuService, move the shared schema down to lib", () => {
    const astar = planRefactoring(problem, { heuristic: "matching" });
    const ucs = planRefactoring(problem, { heuristic: "zero" });
    expect(astar.status).toBe("solved");
    const actions = astar.steps.map((s) => `${s.action.kind} ${s.action.file} ${s.action.to}`).sort();
    expect(actions).toEqual([
      "move src/data/schema.ts src/lib",
      "redirect src/components/Cart.tsx src/services/menuService.ts",
      "redirect src/pages/menu.tsx src/services/menuService.ts",
      "redirect src/pages/order.tsx src/services/menuService.ts",
    ]);
    expect(astar.finalViolations).toEqual([]);
    expect(astar.cost).toBeCloseTo(ucs.cost, 9);
    expect(astar.stats.expanded).toBeLessThan(ucs.stats.expanded / 3);
  });
});
