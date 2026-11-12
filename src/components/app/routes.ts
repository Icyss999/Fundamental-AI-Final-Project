import type { DiagramMode } from "@/components/mapper/DiagramView";
import type { AnalysisResult } from "@/lib/analyze";

/**
 * Kosmos's pages: `/` (start), `/analyze?repo=…` (the waiting screen: reading the code, then the AI's pass)
 * and one page per map mode, `/map/structure|bug-risk|refactor?repo=…`, which share the map layout.
 */

export const MODE_SLUG: Record<DiagramMode, string> = { structure: "structure", risk: "bug-risk", refactor: "refactor" };

export function mapHref(mode: DiagramMode, repo: string): string {
  return `/map/${MODE_SLUG[mode]}?repo=${encodeURIComponent(repo)}`;
}

export function analyzeHref(repo: string): string {
  return `/analyze?repo=${encodeURIComponent(repo)}`;
}

export function modeFromPath(pathname: string): DiagramMode {
  if (pathname.startsWith(`/map/${MODE_SLUG.risk}`)) return "risk";
  if (pathname.startsWith(`/map/${MODE_SLUG.refactor}`)) return "refactor";
  return "structure";
}

/** The short, shareable form of what was analysed: `owner/repo` (or the folder link), or the local path. */
export function canonicalSource(data: AnalysisResult, requested: string): string {
  const s = data.overview.source;
  if (s.kind === "github") return s.subdir ? `https://github.com/${s.owner}/${s.repo}/tree/${s.branch}/${s.subdir}` : `${s.owner}/${s.repo}`;
  return requested;
}

/** A readable name for a repository before it has been read. */
export function displayName(repo: string): string {
  const m = repo.match(/github\.com\/([^/\s]+\/[^/\s#?]+)/);
  return (m ? m[1] : repo).replace(/\.git$/, "");
}
