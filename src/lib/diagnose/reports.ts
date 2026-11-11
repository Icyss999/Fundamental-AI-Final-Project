import type { Outcome } from "./bayes";

/**
 * Reads test outcomes from a report the user ran themselves (nothing is executed here):
 * Jest / Vitest `--json`, Mocha's JSON reporter, or JUnit XML. Outcomes are per test *file*,
 * the unit static coverage works at: a file fails if any test case in it fails.
 */

export interface ParsedReport {
  format: "jest" | "mocha" | "junit";
  outcomes: Map<string, Outcome>;
  /** Report entries that matched no test file in the project. */
  unmatched: string[];
}

export class ReportError extends Error {}

/**
 * Maps a path from a report to a test id. Reports carry absolute paths, or paths relative to
 * wherever the tests ran: the longest id that is a whole-segment suffix of the path wins. If the
 * tests ran from a sub-folder, the reported path is shorter than the id; that only counts when
 * exactly one id ends with it.
 */
export function matchTestFile(reported: string, testIds: readonly string[]): string | null {
  const path = reported.replace(/\\/g, "/").replace(/^\.\//, "");
  let best: string | null = null;
  for (const id of testIds) {
    if ((path === id || path.endsWith(`/${id}`)) && (!best || id.length > best.length)) best = id;
  }
  if (best) return best;
  const shorter = testIds.filter((id) => id.endsWith(`/${path}`));
  if (shorter.length === 1) return shorter[0];

  // JUnit class names from other languages: com.shop.PricingTest (Java), tests.test_api.TestCart
  // (pytest): read dots as folders, matched without the extension, dropping trailing class names.
  if (!path.includes("/") && path.includes(".")) {
    const segs = path.split(".");
    for (let k = segs.length; k > 0; k--) {
      const stem = segs.slice(0, k).join("/");
      const hits = testIds.filter((id) => {
        const noExt = id.replace(/\.[^./]+$/, "");
        return noExt === stem || noExt.endsWith(`/${stem}`);
      });
      if (hits.length > 0) return [...hits].sort((a, b) => a.length - b.length)[0];
    }
  }
  // Go reports name the package (an import path): its folder, when it holds one test file.
  const inDir = testIds.filter((id) => {
    const dir = id.slice(0, Math.max(0, id.lastIndexOf("/")));
    return dir !== "" && (path === dir || path.endsWith(`/${dir}`));
  });
  return inDir.length === 1 ? inDir[0] : null;
}

function record(outcomes: Map<string, Outcome>, id: string, outcome: Outcome) {
  if (outcome === "fail" || !outcomes.has(id)) outcomes.set(id, outcome);
}

export function parseTestReport(text: string, testIds: readonly string[]): ParsedReport {
  const trimmed = text.trim();
  if (trimmed.startsWith("<")) return parseJUnit(trimmed, testIds);
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new ReportError("The report is neither JSON nor JUnit XML.");
  }
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj?.testResults)) return parseJest(obj.testResults as Record<string, unknown>[], testIds);
  if (Array.isArray(obj?.passes) || Array.isArray(obj?.failures)) return parseMocha(obj, testIds);
  throw new ReportError("Unrecognised JSON report. Use `vitest --reporter=json`, `jest --json` or Mocha's JSON reporter.");
}

function parseJest(results: Record<string, unknown>[], testIds: readonly string[]): ParsedReport {
  const outcomes = new Map<string, Outcome>();
  const unmatched: string[] = [];
  for (const r of results) {
    const name = typeof r.name === "string" ? r.name : typeof r.testFilePath === "string" ? r.testFilePath : null;
    if (!name) continue;
    const id = matchTestFile(name, testIds);
    if (!id) {
      unmatched.push(name);
      continue;
    }
    const cases = Array.isArray(r.assertionResults) ? (r.assertionResults as { status?: string }[]) : [];
    const failed = r.status === "failed" || cases.some((c) => c.status === "failed");
    record(outcomes, id, failed ? "fail" : "pass");
  }
  return { format: "jest", outcomes, unmatched };
}

function parseMocha(data: Record<string, unknown>, testIds: readonly string[]): ParsedReport {
  const outcomes = new Map<string, Outcome>();
  const unmatched = new Set<string>();
  const visit = (list: unknown, outcome: Outcome) => {
    if (!Array.isArray(list)) return;
    for (const t of list as { file?: string }[]) {
      if (!t.file) continue;
      const id = matchTestFile(t.file, testIds);
      if (id) record(outcomes, id, outcome);
      else unmatched.add(t.file);
    }
  };
  visit(data.passes, "pass");
  visit(data.failures, "fail");
  return { format: "mocha", outcomes, unmatched: [...unmatched] };
}

function attributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    attrs[m[1]] = (m[3] ?? m[4])
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  }
  return attrs;
}

function parseJUnit(xml: string, testIds: readonly string[]): ParsedReport {
  const outcomes = new Map<string, Outcome>();
  const unmatched = new Set<string>();
  let cases = 0;
  // Each <testsuite> block, then each <testcase> inside it (self-closing or with a body).
  for (const suite of xml.matchAll(/<testsuite\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testsuite>)/g)) {
    const suiteAttrs = attributes(suite[1]);
    for (const tc of (suite[2] ?? "").matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
      cases++;
      const a = attributes(tc[1]);
      const candidates = [a.file, a.classname, suiteAttrs.file, suiteAttrs.name].filter((s): s is string => !!s);
      const id = candidates.map((c) => matchTestFile(c, testIds)).find((x) => x !== null) ?? null;
      const failed = /<(failure|error)\b/.test(tc[2] ?? "");
      if (id) record(outcomes, id, failed ? "fail" : "pass");
      else if (candidates[0]) unmatched.add(candidates[0]);
    }
  }
  if (cases === 0) throw new ReportError("No <testcase> elements found in the XML report.");
  return { format: "junit", outcomes, unmatched: [...unmatched] };
}

export interface TestFailure {
  /** Test file id, or the reported path when it matches no test file. */
  test: string;
  /** Test case name. */
  name: string;
  message: string;
}

/**
 * The failure messages in a report, per test case (for the assistant: an assertion message
 * usually says what is wrong). Jest/Vitest and Mocha JSON, and JUnit XML.
 */
export function reportFailures(text: string, testIds: readonly string[]): TestFailure[] {
  const trimmed = text.trim();
  const at = (reported: string) => matchTestFile(reported, testIds) ?? reported;
  const out: TestFailure[] = [];
  if (trimmed.startsWith("<")) {
    for (const tc of trimmed.matchAll(/<testcase\b([^>]*?)>([\s\S]*?)<\/testcase>/g)) {
      const failure = tc[2].match(/<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/);
      if (!failure) continue;
      const a = attributes(tc[1]);
      out.push({ test: at(a.file ?? a.classname ?? ""), name: a.name ?? "", message: attributes(failure[2]).message ?? failure[3]?.trim() ?? "" });
    }
    return out;
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return out;
  }
  if (Array.isArray(data.testResults)) {
    for (const r of data.testResults as Record<string, unknown>[]) {
      const file = at(String(r.name ?? r.testFilePath ?? ""));
      const cases = Array.isArray(r.assertionResults) ? (r.assertionResults as Record<string, unknown>[]) : [];
      for (const c of cases) {
        const messages = Array.isArray(c.failureMessages) ? (c.failureMessages as string[]) : [];
        if (c.status === "failed") out.push({ test: file, name: String(c.fullName ?? c.title ?? ""), message: messages.join("\n") });
      }
      if (r.status === "failed" && cases.length === 0 && typeof r.message === "string") out.push({ test: file, name: "", message: r.message });
    }
  } else if (Array.isArray(data.failures)) {
    for (const f of data.failures as { file?: string; fullTitle?: string; title?: string; err?: { message?: string } }[]) {
      out.push({ test: at(f.file ?? ""), name: f.fullTitle ?? f.title ?? "", message: f.err?.message ?? "" });
    }
  }
  return out;
}
