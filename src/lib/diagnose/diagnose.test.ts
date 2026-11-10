import { describe, expect, it } from "vitest";
import { makeFileNode } from "@/lib/graph/extract";
import type { DepGraph, FileNode } from "@/lib/graph/types";
import { logBayesFactor, logSumExp, ochiai, pFail, posterior, ranks, riskPrior, type TestEvidence } from "./bayes";
import { staticCoverage, testCases } from "./coverage";
import { DEFAULT_DIAGNOSIS_PARAMS, prepareDiagnosis, scoreDiagnosis } from "./diagnose";
import { fileHistory, GIT_LOG_FORMAT, isBugFix, parseGitLog, type Commit } from "./history";
import { matchTestFile, parseTestReport, ReportError } from "./reports";

const DAY = 86_400;

function graphOf(edges: [string, string, boolean?][], loc: Record<string, number> = {}): DepGraph {
  const ids = new Set<string>();
  for (const [a, b] of edges) ids.add(a).add(b);
  return {
    root: "/x",
    nodes: [...ids].sort().map((id) => makeFileNode(id, loc[id] ?? 10)),
    edges: edges.map(([source, target, typeOnly]) => ({ source, target, typeOnly: typeOnly ?? false })),
  };
}

describe("git history", () => {
  it("parses the log format, keeping '|' inside subjects", () => {
    expect(GIT_LOG_FORMAT).toBe("@@@%H|%at|%s");
    const log = "@@@aaa|1700000000|fix: a | b\r\n\nsrc/a.ts\nsrc/b.ts\n@@@bbb|1690000000|Initial\n\nsrc/a.ts\n@@@ccc|1680000000|empty\n";
    expect(parseGitLog(log)).toEqual([
      { sha: "aaa", time: 1700000000, subject: "fix: a | b", files: ["src/a.ts", "src/b.ts"] },
      { sha: "bbb", time: 1690000000, subject: "Initial", files: ["src/a.ts"] },
      { sha: "ccc", time: 1680000000, subject: "empty", files: [] },
    ]);
  });

  it.each([
    ["fix: rounding error in totals", true],
    ["Fixed crash when cart is empty", true],
    ["fix(pricing): tax", true],
    ["Hotfix for #123", true],
    ["Bug in pagination", true],
    ["Add prefix option", false],
    ["Update test fixtures", false],
    ["Add debug logging", false],
    ["fix typo in comment", false],
    ["Fix lint", false],
  ])("isBugFix(%j) = %s", (subject, expected) => {
    expect(isBugFix(subject)).toBe(expected);
  });

  it("counts changes and fixes per file, decays old ones and skips bulk commits", () => {
    const t = 1_700_000_000;
    const commits: Commit[] = [
      { sha: "1", time: t, subject: "fix: a", files: ["a.ts", "b.ts"] },
      { sha: "2", time: t - 180 * DAY, subject: "feature", files: ["a.ts"] },
      { sha: "3", time: t - 360 * DAY, subject: "fix bug", files: ["a.ts", "other.md"] },
      { sha: "4", time: t - DAY, subject: "fix everything", files: Array.from({ length: 50 }, (_, i) => (i === 0 ? "a.ts" : `x${i}.ts`)) },
      { sha: "5", time: t, subject: "docs", files: ["README.md"] },
    ];
    const { perFile, summary } = fileHistory(commits, new Set(["a.ts", "b.ts"]), { halfLifeDays: 180, maxFilesPerCommit: 40 });
    const a = perFile.get("a.ts")!;
    expect(a.changes).toBe(3);
    expect(a.fixes).toBe(2);
    expect(a.weightedChanges).toBeCloseTo(1 + 0.5 + 0.25);
    expect(a.weightedFixes).toBeCloseTo(1 + 0.25);
    expect(a.recentFixes.map((f) => f.sha)).toEqual(["1", "3"]);
    expect(perFile.get("b.ts")).toMatchObject({ changes: 1, fixes: 1 });
    expect(summary).toEqual({ commits: 3, fixCommits: 2, bulkSkipped: 1, from: t - 360 * DAY, to: t });
  });
});

describe("prior", () => {
  it("falls back to √size when there is no history, and sums to 1", () => {
    const prior = riskPrior([{ id: "small", loc: 25 }, { id: "big", loc: 100 }], null, { changeWeight: 0.15, priorStrength: 1 });
    expect(prior.get("big")!.p / prior.get("small")!.p).toBeCloseTo(2);
    expect(prior.get("big")!.p + prior.get("small")!.p).toBeCloseTo(1);
  });

  it("shrinks bug-fix history towards the size baseline (Gamma–Poisson posterior mean)", () => {
    const history = new Map([
      ["a", { changes: 4, fixes: 3, weightedChanges: 4, weightedFixes: 3, recentFixes: [], lastChange: 0 }],
    ]);
    const prior = riskPrior([{ id: "a", loc: 100 }, { id: "b", loc: 100 }], history, { changeWeight: 0.5, priorStrength: 1 });
    // evidence: a = 3 + 0.5·1 = 3.5, b = 0; m = 1.75; κ = 1.
    expect(prior.get("a")).toMatchObject({ sizePart: 0.875, historyPart: 1.75, lambda: 2.625 });
    expect(prior.get("b")).toMatchObject({ sizePart: 0.875, historyPart: 0, lambda: 0.875 });
    expect(prior.get("a")!.p).toBeCloseTo(0.75);
  });
});

describe("likelihood and posterior", () => {
  const params = { activation: 0.5, noise: 0.05 };

  it("computes per-test Bayes factors", () => {
    expect(pFail(1, params)).toBeCloseTo(0.525);
    expect(logBayesFactor("fail", 1, params)).toBeCloseTo(Math.log(0.525 / 0.05));
    expect(logBayesFactor("pass", 1, params)).toBeCloseTo(Math.log(0.475 / 0.95));
    expect(logBayesFactor("fail", 0, params)).toBe(0);
  });

  it("is the prior when there is no evidence", () => {
    const prior = new Map([["a", 0.2], ["b", 0.8]]);
    const post = posterior(prior, [], params);
    expect(post.get("a")!.p).toBeCloseTo(0.2);
    expect(post.get("b")!.p).toBeCloseTo(0.8);
  });

  it("matches the full product of likelihoods over every test (the Bayes-factor shortcut is exact)", () => {
    const prior = new Map([["a", 0.5], ["b", 0.3], ["c", 0.2]]);
    const tests: TestEvidence[] = [
      { id: "t1", outcome: "fail", coverage: new Map([["a", 1], ["b", 0.5]]) },
      { id: "t2", outcome: "pass", coverage: new Map([["b", 1]]) },
      { id: "t3", outcome: "fail", coverage: new Map([["c", 0.75]]) },
      { id: "t4", outcome: "pass", coverage: new Map() },
    ];
    const brute = new Map<string, number>();
    for (const [f, p] of prior) {
      let l = p;
      for (const t of tests) {
        const q = pFail(t.coverage.get(f) ?? 0, params);
        l *= t.outcome === "fail" ? q : 1 - q;
      }
      brute.set(f, l);
    }
    const z = [...brute.values()].reduce((s, v) => s + v, 0);
    const post = posterior(prior, tests, params);
    for (const f of prior.keys()) expect(post.get(f)!.p).toBeCloseTo(brute.get(f)! / z, 12);
  });

  it("stays finite with thousands of tests (log space)", () => {
    const tests: TestEvidence[] = Array.from({ length: 3000 }, (_, i) => ({
      id: `t${i}`,
      outcome: "fail",
      coverage: new Map([["a", 1], ...(i % 2 ? [["b", 1] as [string, number]] : [])]),
    }));
    const post = posterior(new Map([["a", 0.01], ["b", 0.99]]), tests, params);
    expect(post.get("a")!.p).toBeCloseTo(1);
    expect(Number.isFinite(post.get("b")!.logPosterior)).toBe(true);
    expect(logSumExp([-1000, -1000])).toBeCloseTo(-1000 + Math.log(2));
  });

  it("computes Ochiai and tie-aware ranks", () => {
    const tests: TestEvidence[] = [
      { id: "t1", outcome: "fail", coverage: new Map([["a", 1], ["b", 1]]) },
      { id: "t2", outcome: "fail", coverage: new Map([["a", 1]]) },
      { id: "t3", outcome: "pass", coverage: new Map([["a", 1], ["c", 1]]) },
    ];
    const scores = ochiai(["a", "b", "c", "d"], tests);
    expect(scores.get("a")).toBeCloseTo(2 / Math.sqrt(2 * 3));
    expect(scores.get("b")).toBeCloseTo(1 / Math.sqrt(2 * 1));
    expect(scores.get("c")).toBe(0);
    expect(scores.get("d")).toBe(0);
    expect([...ranks(scores)]).toEqual([["a", 1], ["b", 2], ["c", 3], ["d", 3]]);
  });
});

describe("static coverage", () => {
  const g = graphOf([
    ["src/a.test.ts", "src/a.ts"],
    ["src/a.ts", "src/b.ts"],
    ["src/b.ts", "src/c.ts"],
    ["src/c.ts", "src/a.ts"], // cycle
    ["src/a.ts", "src/types.ts", true],
    ["src/a.test.ts", "src/test-utils.ts"],
    ["src/test-utils.ts", "src/d.ts"],
  ]);
  g.nodes.find((n) => n.id === "src/test-utils.ts")!.role = "test";

  it("treats test files nothing imports as test cases", () => {
    expect(testCases(g)).toEqual(["src/a.test.ts"]);
  });

  it("follows value imports breadth-first and discounts each extra hop", () => {
    const targets = new Set(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/types.ts"]);
    const [cov] = staticCoverage(g, ["src/a.test.ts"], targets, 0.5);
    expect(Object.fromEntries(cov.depth)).toEqual({ "src/a.ts": 1, "src/b.ts": 2, "src/c.ts": 3, "src/d.ts": 2 });
    expect(cov.coverage.get("src/c.ts")).toBe(0.25);
    expect(cov.coverage.has("src/types.ts")).toBe(false);
  });
});

describe("test reports", () => {
  const ids = ["src/a.test.ts", "src/b.test.ts", "pkg/src/b.test.ts"];

  it("matches report paths to test files by whole path segments", () => {
    expect(matchTestFile("/home/me/repo/src/a.test.ts", ids)).toBe("src/a.test.ts");
    expect(matchTestFile("C:\\repo\\pkg\\src\\b.test.ts", ids)).toBe("pkg/src/b.test.ts");
    expect(matchTestFile("a.test.ts", ids)).toBe("src/a.test.ts");
    expect(matchTestFile("b.test.ts", ids)).toBeNull(); // ambiguous
    expect(matchTestFile("/x/xsrc/a.test.ts", ids)).toBeNull();
  });

  it("reads Jest / Vitest JSON", () => {
    const report = JSON.stringify({
      testResults: [
        { name: "/r/src/a.test.ts", status: "failed", assertionResults: [] },
        { name: "/r/pkg/src/b.test.ts", status: "passed", assertionResults: [{ status: "passed" }] },
        { name: "/r/src/gone.test.ts", status: "passed" },
      ],
    });
    const parsed = parseTestReport(report, ids);
    expect(parsed.format).toBe("jest");
    expect(Object.fromEntries(parsed.outcomes)).toEqual({ "src/a.test.ts": "fail", "pkg/src/b.test.ts": "pass" });
    expect(parsed.unmatched).toEqual(["/r/src/gone.test.ts"]);
  });

  it("reads Mocha JSON", () => {
    const report = JSON.stringify({ passes: [{ file: "src/a.test.ts" }, { file: "src/b.test.ts" }], failures: [{ file: "src/a.test.ts" }] });
    expect(Object.fromEntries(parseTestReport(report, ids).outcomes)).toEqual({ "src/a.test.ts": "fail", "src/b.test.ts": "pass" });
  });

  it("reads JUnit XML, failing a file if any of its cases fails", () => {
    const xml = `<?xml version="1.0"?>
      <testsuites>
        <testsuite name="src/a.test.ts" tests="2">
          <testcase classname="src/a.test.ts" name="adds"/>
          <testcase classname="src/a.test.ts" name="rounds &amp; taxes"><failure message="x">boom</failure></testcase>
        </testsuite>
        <testsuite name="b suite"><testcase name="ok" file="pkg/src/b.test.ts"></testcase></testsuite>
      </testsuites>`;
    const parsed = parseTestReport(xml, ids);
    expect(parsed.format).toBe("junit");
    expect(Object.fromEntries(parsed.outcomes)).toEqual({ "src/a.test.ts": "fail", "pkg/src/b.test.ts": "pass" });
  });

  it("rejects unknown formats", () => {
    expect(() => parseTestReport("hello", ids)).toThrow(ReportError);
    expect(() => parseTestReport("{}", ids)).toThrow(ReportError);
  });
});

describe("scoreDiagnosis", () => {
  // Two features share a utility; only the pricing test fails.
  const g = graphOf(
    [
      ["test/pricing.test.ts", "src/pricing.ts"],
      ["test/cart.test.ts", "src/cart.ts"],
      ["src/pricing.ts", "src/utils.ts"],
      ["src/cart.ts", "src/utils.ts"],
    ],
    { "src/utils.ts": 200 },
  );
  for (const n of g.nodes) if (n.id.startsWith("test/")) n.role = "test";
  const candidates: FileNode[] = g.nodes.filter((n) => n.role === "source");

  it("ranks by the prior alone until outcomes are known", () => {
    const basis = prepareDiagnosis(g, candidates, null, DEFAULT_DIAGNOSIS_PARAMS);
    const d = scoreDiagnosis(basis, new Map(), DEFAULT_DIAGNOSIS_PARAMS);
    expect(d.files[0].id).toBe("src/utils.ts"); // biggest file
    expect(d.files.reduce((s, f) => s + f.posterior, 0)).toBeCloseTo(1);
    expect(d.tests).toEqual([
      { id: "test/cart.test.ts", outcome: null, covers: 2 },
      { id: "test/pricing.test.ts", outcome: null, covers: 2 },
    ]);
  });

  it("blames what the failing test covers and the passing test does not", () => {
    // Same sizes, so only the test evidence separates the files.
    const sameSize = { ...g, nodes: g.nodes.map((n) => ({ ...n, loc: 10 })) };
    const basis = prepareDiagnosis(sameSize, sameSize.nodes.filter((n) => n.role === "source"), null, DEFAULT_DIAGNOSIS_PARAMS);
    const outcomes = new Map([["test/pricing.test.ts", "fail"], ["test/cart.test.ts", "pass"]] as const);
    const d = scoreDiagnosis(basis, outcomes, DEFAULT_DIAGNOSIS_PARAMS);
    expect(d.files[0].id).toBe("src/pricing.ts");
    expect(d.files[0].ochiaiRank).toBe(1);
    expect(d.failing).toBe(1);
    expect(d.passing).toBe(1);
    const pricing = d.byId.get("src/pricing.ts")!;
    expect(pricing.factors).toHaveLength(1);
    expect(pricing.factors[0]).toMatchObject({ test: "test/pricing.test.ts", outcome: "fail", depth: 1 });
    // utils: covered by the failing test (boost) and the passing one (penalty), both at 2 hops.
    expect(d.byId.get("src/utils.ts")!.factors.map((f) => f.outcome).sort()).toEqual(["fail", "pass"]);
    expect(d.byId.get("src/cart.ts")!.rank).toBe(3);
  });
});
