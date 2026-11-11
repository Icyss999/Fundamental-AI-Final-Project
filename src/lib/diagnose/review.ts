/** Findings from a code review (the AI assistant's), and the Bayes evidence they give. Client-safe. */

import type { ReviewEvidence } from "./diagnose";

export type Severity = "high" | "medium" | "low";

export interface Finding {
  file: string;
  line?: number;
  severity: Severity;
  title: string;
  detail: string;
  /** Suggested fix as a unified diff. */
  fix?: string;
}

export interface Review {
  findings: Finding[];
  /** Files read during the review, flagged or not. */
  reviewed: string[];
}

/** w in the review likelihood: how strongly a finding of this severity points at a real fault. */
export const SEVERITY_WEIGHT: Record<Severity, number> = { high: 1, medium: 0.6, low: 0.3 };

export function reviewEvidence(review: Review): ReviewEvidence {
  const flagged = new Map<string, { weight: number; titles: string[] }>();
  for (const f of review.findings) {
    const prev = flagged.get(f.file);
    flagged.set(f.file, { weight: Math.max(prev?.weight ?? 0, SEVERITY_WEIGHT[f.severity]), titles: [...(prev?.titles ?? []), f.title] });
  }
  return { reviewed: new Set([...review.reviewed, ...flagged.keys()]), flagged };
}

/** Per file: how many findings, and the worst severity (for diagram badges). */
export function findingsByFile(findings: readonly Finding[]): Map<string, { count: number; severity: Severity }> {
  const order: Severity[] = ["low", "medium", "high"];
  const out = new Map<string, { count: number; severity: Severity }>();
  for (const f of findings) {
    const prev = out.get(f.file);
    out.set(f.file, { count: (prev?.count ?? 0) + 1, severity: !prev || order.indexOf(f.severity) > order.indexOf(prev.severity) ? f.severity : prev.severity });
  }
  return out;
}
