import type { DepGraph } from "@/lib/graph/types";

/**
 * Static test coverage, read off the import graph instead of running anything:
 * a test file "covers" every file it reaches through value imports. A file `d` imports
 * away is less likely to actually execute, so coverage is discounted by `decay` per hop
 * after the first: c = decay^(d-1). Type-only imports carry no code and are not followed.
 */

/** One test file and how strongly it covers each file it reaches. */
export interface TestCoverage {
  id: string;
  /** File id -> coverage strength in (0, 1]. */
  coverage: Map<string, number>;
  /** File id -> import distance from the test (1 = imported directly). */
  depth: Map<string, number>;
}

/**
 * Test cases: test files nothing else imports. Files under test folders that other tests
 * import (helpers, mocks, fixtures) are support code, not cases with a pass/fail outcome.
 */
export function testCases(graph: DepGraph): string[] {
  const imported = new Set(graph.edges.map((e) => e.target));
  return graph.nodes
    .filter((n) => n.role === "test" && !imported.has(n.id))
    .map((n) => n.id)
    .sort();
}

export function staticCoverage(
  graph: DepGraph,
  tests: readonly string[],
  /** Files to record coverage for (usually the source files that are candidates for the bug). */
  targets: ReadonlySet<string>,
  decay: number,
): TestCoverage[] {
  const out = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) if (!e.typeOnly) out.get(e.source)?.push(e.target);

  return tests.map((id) => {
    const depth = new Map<string, number>();
    const coverage = new Map<string, number>();
    // Breadth-first, so the first time a file is reached is its shortest distance.
    const seen = new Set([id]);
    let frontier = [id];
    for (let d = 1; frontier.length > 0; d++) {
      const next: string[] = [];
      for (const file of frontier) {
        for (const target of out.get(file) ?? []) {
          if (seen.has(target)) continue;
          seen.add(target);
          next.push(target);
          if (targets.has(target)) {
            depth.set(target, d);
            coverage.set(target, decay ** (d - 1));
          }
        }
      }
      frontier = next;
    }
    return { id, coverage, depth };
  });
}
