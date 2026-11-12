import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { AnalysisResult } from "@/lib/analyze";
import { Policy, suggestRules } from "@/lib/change/rules";
import { partitionMQ } from "@/lib/cluster/grouping";
import { DEFAULT_DIAGNOSIS_PARAMS, prepareDiagnosis, scoreDiagnosis } from "@/lib/diagnose/diagnose";
import { parseGitLog } from "@/lib/diagnose/history";
import { parseTestReport } from "@/lib/diagnose/reports";
import { extractGraph } from "@/lib/graph/extract";
import { analyzeProject } from "@/lib/graph/project-analysis";
import { appState, projectBrief } from "./brief";
import { executeTool } from "./execute";
import { AssistantWorkspace, resolvePath, ToolError, type WorkspaceEffects, type WorkspaceSnapshot } from "./workspace";

/** The assistant's tools on fixtures/restaurant-app, with the UI replaced by a call log. */
const sample = path.resolve(__dirname, "../../../fixtures/restaurant-app");
let snapshot: WorkspaceSnapshot;
/** The fixture's recorded test run (test-results.json), as the AI would pass it on with set_test_outcomes. */
let reported: { failing: string[]; passing: string[] };

beforeAll(async () => {
  const { graph } = await extractGraph(sample);
  const analysis = analyzeProject(graph, "restaurant-app", false);
  const commits = parseGitLog(readFileSync(path.join(sample, "git-log.txt"), "utf8"));
  const basis = prepareDiagnosis(graph, analysis.graph.nodes, commits, DEFAULT_DIAGNOSIS_PARAMS);
  const rules = suggestRules(
    [...analysis.modules.keys()].map((m) => ({ label: analysis.labels[m] })),
    analysis.moduleEdges,
    (m) => analysis.labels[m],
  );
  const policy = new Policy(rules, analysis.prefix);
  const data: AnalysisResult = {
    graph,
    history: { commits, read: commits.length, truncated: false },
    warnings: [],
    overview: { name: "restaurant-app", source: { kind: "local", path: sample }, description: null, readme: null, github: null, packageInfo: null, techStack: [], languages: [] },
  };
  const run = parseTestReport(readFileSync(path.join(sample, "test-results.json"), "utf8"), basis.coverage.map((c) => c.id));
  const outcomes = [...run.outcomes];
  reported = { failing: outcomes.filter(([, o]) => o === "fail").map(([t]) => t), passing: outcomes.filter(([, o]) => o === "pass").map(([t]) => t) };
  snapshot = {
    data,
    analysis,
    basis,
    diagnosis: scoreDiagnosis(basis, new Map(), DEFAULT_DIAGNOSIS_PARAMS),
    outcomes: new Map(),
    params: DEFAULT_DIAGNOSIS_PARAMS,
    review: null,
    useReview: true,
    rulesText: rules,
    suggestedRules: rules,
    policy,
    violations: policy.evaluate(
      analysis.graph.nodes.map((n) => ({ id: n.id, path: n.id })),
      analysis.graph.edges,
    ).violations,
    planOptions: { heuristic: "matching", riskWeight: 1 },
    plan: null,
    step: 0,
    view: { mode: "structure", selection: null, includeAll: false },
    diagram: { partition: analysis.partition, labels: analysis.labels },
    grouping: { kind: "folders", folderMQ: partitionMQ(analysis.graph, analysis.partition), clusters: null, ai: null },
    patches: null,
  };
});

function session() {
  const calls: unknown[][] = [];
  const effects: WorkspaceEffects = {
    setOutcomes: (o) => calls.push(["setOutcomes", o.size]),
    setRulesText: (text) => calls.push(["setRulesText", text]),
    setPlanOptions: (o) => calls.push(["setPlanOptions", o]),
    adoptPlan: (plan, rules) => calls.push(["adoptPlan", plan.steps.length, rules]),
    adoptComparison: (rows) => calls.push(["adoptComparison", rows.length]),
    setStep: (step) => calls.push(["setStep", step]),
    play: () => calls.push(["play"]),
    show: (options) => calls.push(["show", options]),
    setGrouping: (kind, update) => calls.push(["setGrouping", kind, update?.ai ? Object.keys(update.ai.labels).length : update?.clusters ? "clusters" : undefined]),
    setReview: (review) => calls.push(["setReview", review?.findings.length]),
    attachPatch: (_plan, step) => calls.push(["attachPatch", step]),
    readSource: (file) => readFile(path.join(sample, file), "utf8"),
  };
  const ws = new AssistantWorkspace(snapshot, effects);
  const run = async (name: string, args: object = {}) => {
    const out = await executeTool(ws, name, JSON.stringify(args));
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(out.content);
    } catch {
      // read_file returns plain text
    }
    return { ...out, json };
  };
  return { ws, calls, run };
}

describe("bug finding through the tools", () => {
  it("records the failing tests, ranks pricing.ts first, and explains why", async () => {
    const { run, calls } = session();
    const recorded = await run("set_test_outcomes", reported);
    expect(recorded.ok).toBe(true);
    expect(recorded.json).toMatchObject({ failing: 3, passing: 5 });
    expect(calls).toContainEqual(["setOutcomes", 8]);
    expect(calls).toContainEqual(["show", { mode: "risk" }]);

    const ranked = await run("rank_suspects", { limit: 3 });
    const suspects = ranked.json.suspects as { file: string; ochiai_rank: number }[];
    expect(suspects[0]).toMatchObject({ file: "src/services/pricing.ts", ochiai_rank: 2 });
    expect(ranked.summary).toMatch(/^#1 pricing\.ts/);

    const why = await run("explain_suspect", { path: "pricing.ts" });
    expect(why.json.file).toBe("src/services/pricing.ts");
    expect((why.json.test_evidence as { outcome: string }[]).filter((e) => e.outcome === "fail")).toHaveLength(3);
  });

  it("maps test names to test files and can mark the rest of the suite passing", async () => {
    const { run, ws } = session();
    const total = ws.state.diagnosis.tests.length;
    const out = await run("set_test_outcomes", { failing: ["pricing.test.ts", "nope.test.ts"], rest: "pass" });
    expect(out.json).toMatchObject({ failing: 1, passing: total - 1, unknown: 0 });
    expect(out.json.unmatched).toHaveLength(1);
    expect(out.ok).toBe(false);
    expect(ws.state.outcomes.get("src/services/pricing.test.ts")).toBe("fail");
  });
});

describe("refactoring through the tools", () => {
  it("reads the suggested rules and their violations, with reasons", async () => {
    const { run } = session();
    const rules = await run("get_rules");
    expect(rules.json).toMatchObject({ is_folder_suggestion: true, violations: 5 });
    const list = await run("list_violations");
    const violations = list.json.violations as { from: string; to: string; why: string }[];
    expect(violations).toHaveLength(5);
    expect(violations.find((v) => v.from === "src/pages/menu.tsx")?.why).toMatch(/may not import/);
    const proof = await run("explain_violation", { from: "pages/menu.tsx", to: "data/db.ts" });
    expect((proof.json.reasons as { proof: string }[])[0].proof).toMatch(/violates\(.*\) \[forbidden\]/);
  });

  it("refuses rules with errors and reports paths that match no file", async () => {
    const { run, calls } = session();
    const bad = await run("set_rules", { rules: "layers: pages\nnonsense" });
    expect(bad.ok).toBe(false);
    expect(bad.json.applied).toBe(false);
    expect(calls.some((c) => c[0] === "setRulesText")).toBe(false);

    const good = await run("set_rules", { rules: "forbid: pages -> data\nforbid: widgets -> data" });
    expect(good.json).toMatchObject({ applied: true, violations: 2, unmatched_paths: ["widgets"] });
    expect(calls).toContainEqual(["show", { mode: "refactor" }]);
  });

  it("plans with the rules set earlier in the same turn, then steps and compares", async () => {
    const { run, calls } = session();
    await run("set_test_outcomes", reported);
    const rules = "forbid: pages -> data\n";
    await run("set_rules", { rules });
    const plan = await run("plan_refactoring");
    expect(plan.json.status).toBe("solved");
    // Only the two pages break this rule (components may still use data, so either can be a go-between).
    const steps = plan.json.steps as { action: string; file: string; from: string }[];
    expect(steps.map((s) => `${s.action} ${s.file} ${s.from}`).sort()).toEqual([
      "RedirectImport src/pages/menu.tsx src/data/db.ts",
      "RedirectImport src/pages/order.tsx src/data/db.ts",
    ]);
    expect(calls).toContainEqual(["adoptPlan", 2, rules]);

    expect((await run("show_plan_step", { step: 1 })).json.violations_left).toBe(1);
    expect(calls).toContainEqual(["setStep", 1]);

    const compared = await run("compare_search");
    const rows = compared.json.rows as { cost: number; expanded: number }[];
    expect(rows).toHaveLength(3);
    expect(rows[0].cost).toBeCloseTo(rows[2].cost, 6);
  });

  it("reproduces the fixture's plan for the suggested rules", async () => {
    const { run } = session();
    await run("set_test_outcomes", reported);
    const plan = await run("plan_refactoring");
    const steps = plan.json.steps as { action: string; file: string; to: string }[];
    expect(steps.map((s) => `${s.action} ${s.file} ${s.to}`).sort()).toEqual([
      "MoveFile src/data/schema.ts src/lib",
      "RedirectImport src/components/Cart.tsx src/services/menuService.ts",
      "RedirectImport src/pages/menu.tsx src/services/menuService.ts",
      "RedirectImport src/pages/order.tsx src/services/menuService.ts",
    ]);
    expect(plan.json.after).toMatchObject({ violations: 0 });
  });
});

describe("the AI acting on the app", () => {
  it("rearranges the diagram: MQ clusters, then a named architecture built from them", async () => {
    const { run, calls, ws } = session();
    const clustered = await run("cluster_modules");
    expect(clustered.ok).toBe(true);
    expect(clustered.json.mq).toBeGreaterThan(clustered.json.folder_mq as number);
    expect(calls.some(([name]) => name === "setGrouping")).toBe(false); // clusters are never drawn
    const modules = clustered.json.modules as { id: string; files: string[] }[];
    const pricingCluster = modules.find((m) => m.files.includes("src/services/pricing.ts"))!.id;

    const arch = await run("set_architecture", {
      modules: [
        { name: "Pages", purpose: "Screens", tier: 0, folders: ["pages"] },
        { name: "Cart & pricing", purpose: "Cart state and totals", tier: 1, clusters: [pricingCluster] },
        { name: "Everything else", purpose: "The rest", tier: 2, files: ["lib/utils.ts"], clusters: ["cluster-99"] },
      ],
    });
    expect(arch.ok).toBe(false); // cluster-99 does not exist
    expect(arch.json.unknown).toEqual(["cluster cluster-99"]);
    expect(arch.json.unsorted).toBeDefined(); // files no module claimed
    const ai = ws.state.grouping.ai!;
    expect(ws.state.grouping.kind).toBe("ai");
    expect(Object.values(ai.labels)).toEqual(["Pages", "Cart & pricing", "Everything else", "Unsorted"]);
    expect(ai.partition["src/state/cartStore.ts"]).toBe(ai.partition["src/services/pricing.ts"]);
    expect(ai.tiers).toMatchObject({ "ai-1": 0, "ai-2": 1 });
    expect(ws.state.diagram.labels["ai-2"]).toBe("Cart & pricing");
    expect(Object.keys(ai.partition).sort()).toEqual(ws.state.analysis.graph.nodes.map((n) => n.id).sort());

  });

  it("records a code review that moves the Bayesian ranking", async () => {
    const { run, ws, calls } = session();
    const before = ws.state.diagnosis.byId.get("src/lib/format.ts")!.posterior;
    const out = await run("report_findings", {
      findings: [{ file: "lib/format.ts", line: 2, severity: "high", title: "Wrong rounding", detail: "toFixed on a float", fix: "--- a\n+++ b" }],
      reviewed: ["services/pricing.ts", "nothing.ts"],
    });
    expect(out.json).toMatchObject({ recorded: 1, files_reviewed: 2, unknown_files: ["nothing.ts"] });
    expect(calls).toContainEqual(["setReview", 1]);
    const after = ws.state.diagnosis.byId.get("src/lib/format.ts")!;
    expect(after.posterior).toBeGreaterThan(before * 3);
    expect(after.review).toMatchObject({ flagged: true, titles: ["Wrong rounding"] });
    expect(ws.state.diagnosis.byId.get("src/services/pricing.ts")!.review).toMatchObject({ flagged: false });
  });

  it("attaches patches to steps of the plan it made", async () => {
    const { run, calls, ws } = session();
    expect((await run("attach_patch", { step: 1, diff: "x" })).json.error).toMatch(/No plan/);
    await run("plan_refactoring");
    expect((await run("attach_patch", { step: 9, diff: "x" })).json.error).toMatch(/step must be 1\.\.4/);
    const out = await run("attach_patch", { step: 2, diff: "--- a/x\n+++ b/x\n@@\n-a\n+b", note: "redirect" });
    expect(out.ok).toBe(true);
    expect(calls).toContainEqual(["attachPatch", 2]);
    expect(ws.state.patches?.get(2)).toMatchObject({ note: "redirect" });
  });
});

describe("structure and diagram tools", () => {
  it("reads code with line numbers and pages through long files", async () => {
    const { run } = session();
    const out = await run("read_file", { path: "services/pricing.ts", start_line: 1, end_line: 3 });
    expect(out.content).toMatch(/^src\/services\/pricing\.ts — lines 1-3 of \d+ — more below: start_line=4\n1\| /);
    expect(out.content.split("\n")).toHaveLength(4);
  });

  it("zooms to modules, highlights files, and reports hidden or unknown ones", async () => {
    const { run, calls } = session();
    const out = await run("show_in_diagram", { focus: "services", highlight: ["cartStore.ts", "pricing.test.ts", "zzz.ts"] });
    expect(out.json).toMatchObject({ focused: "src/services", highlighted: ["src/state/cartStore.ts"], unknown: ["zzz.ts"] });
    expect((out.json.hidden as { files: string[] }).files).toEqual(["src/services/pricing.test.ts"]);
    expect(calls).toContainEqual(["show", { mode: undefined, focus: { type: "module", id: "src/services" }, highlight: ["src/state/cartStore.ts"] }]);
  });

  it("describes a file's neighbourhood and flags", async () => {
    const { run } = session();
    const out = await run("get_file", { path: "lib/utils.ts" });
    expect(out.json).toMatchObject({ path: "src/lib/utils.ts", module: "lib" });
    expect(out.json.god_file).not.toBeNull();
  });

  it("returns problems to the model instead of throwing", async () => {
    const { run } = session();
    expect((await run("no_such_tool")).ok).toBe(false);
    expect((await run("get_file", { path: "nothing-here.ts" })).json.error).toMatch(/No file matches/);
    expect((await run("show_plan_step")).json.error).toMatch(/No plan is loaded/);
    const ws = session().ws;
    expect((await executeTool(ws, "get_file", "{not json")).summary).toMatch(/not valid JSON/);
  });

  it("resolves paths the way people write them", () => {
    const ids = ["src/a/index.ts", "src/b/index.ts", "src/b/util.ts"];
    expect(resolvePath(ids, "b/util.ts", "src")).toBe("src/b/util.ts");
    expect(resolvePath(ids, "./src/b/util.ts", "src")).toBe("src/b/util.ts");
    expect(resolvePath(ids, "util", "src")).toBe("src/b/util.ts");
    expect(() => resolvePath(ids, "index.ts", "src")).toThrow(ToolError);
    expect(() => resolvePath(ids, "index.ts", "src")).toThrow(/ambiguous/);
  });

  it("briefs the model on the project and the current app state", () => {
    const brief = projectBrief(snapshot.data, snapshot.analysis);
    expect(brief).toContain('Shared folder prefix: "src"');
    expect(brief).toContain("src/services/pricing.ts · ");
    expect(brief).toContain("Test files: 8.");
    const state = appState(snapshot, 0);
    expect(state).toMatch(/^<app_state>\nMode: Structure \(Layer 1\)\n/);
    expect(state).toContain("(the folder-name suggestion), 5 violations");
  });
});
