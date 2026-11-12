import path from "node:path";
import type { Commit } from "@/lib/diagnose/history";
import { extractGraph } from "@/lib/graph/extract";
import type { DepGraph } from "@/lib/graph/types";
import { cloneRepo, deepenHistory, fetchRepoMeta, HISTORY_DEPTH, parseGitHubUrl, RepoError } from "@/lib/repo/github";
import { readGitHistory, trimHistory } from "@/lib/repo/history";
import { buildOverview, type ProjectOverview } from "@/lib/repo/overview";

export type AnalyzeStep = "resolve" | "download" | "extract" | "history" | "summarize";

/** Commit history behind Layer 2's bug-risk prior. */
export interface HistoryData {
  /** Newest first, trimmed to the project's files. */
  commits: Commit[];
  /** How many commits were read before trimming. */
  read: number;
  /** True when older commits exist that were not read. */
  truncated: boolean;
}

export interface AnalysisResult {
  graph: DepGraph;
  overview: ProjectOverview;
  /** Null when the code is not in a git repository or the history could not be read. */
  history: HistoryData | null;
  /** Non-fatal problems to show the user. */
  warnings: string[];
}

export type AnalyzeEvent =
  | { type: "progress"; step: AnalyzeStep; detail?: string }
  | { type: "result"; result: AnalysisResult }
  | { type: "error"; message: string };

/** Errors whose message is written for the user. */
export class UserFacingError extends Error {}

/**
 * Analyses a GitHub repository URL (or, in development, an absolute local folder).
 * `progress` is called as each step starts.
 */
export async function analyzeSource(
  input: string,
  progress: (step: AnalyzeStep, detail?: string) => void,
  /** Signed-in user's GitHub token: unlocks private repos and a higher API rate limit. */
  token?: string,
): Promise<AnalysisResult> {
  const ref = parseGitHubUrl(input);
  if (ref) {
    const label = `${ref.owner}/${ref.repo}`;
    progress("resolve", label);
    const meta = await fetchRepoMeta(ref, token);

    progress("download", meta ? `${meta.fullName}${meta.private ? " (private)" : ""} · ${(meta.sizeKb / 1024).toFixed(1)} MB` : label);
    const clone = await cloneRepo(ref, meta, token);

    progress("extract");
    const { graph, warnings } = await extractGraph(clone.dir);

    progress("history");
    let deepened = true;
    try {
      await deepenHistory(clone, meta, token);
    } catch {
      deepened = false;
    }
    const history = await loadHistory(clone.dir, graph);
    if (!history) warnings.push("The git history could not be read, so bug risk is estimated from file sizes only.");
    else if (!deepened) warnings.push("Only part of the git history could be downloaded; bug risk uses the commits available.");

    progress("summarize");
    const overview = await buildOverview({
      dir: clone.dir,
      repoRoot: clone.repoRoot,
      graph,
      meta,
      source: {
        kind: "github",
        owner: ref.owner,
        repo: ref.repo,
        url: meta?.htmlUrl ?? `https://github.com/${label}`,
        private: meta?.private ?? false,
        branch: clone.branch,
        commit: clone.commit,
        subdir: ref.subdir,
      },
    });
    if (!meta) warnings.push("GitHub details (description, stars) are unavailable right now — the API rate limit may have been reached.");
    return { graph: { ...graph, root: ref.subdir ? `${label}/${ref.subdir}` : label }, overview, history, warnings };
  }

  if (path.isAbsolute(input)) {
    if (process.env.NODE_ENV === "production") {
      throw new UserFacingError("Local folders can only be analysed in development mode. Paste a GitHub URL instead.");
    }
    return analyzeLocal(input, input, progress);
  }

  throw new UserFacingError("That doesn't look like a GitHub repository. Paste a URL like https://github.com/owner/repo.");
}

async function analyzeLocal(dir: string, label: string, progress: (step: AnalyzeStep, detail?: string) => void): Promise<AnalysisResult> {
  progress("extract", label);
  let extracted;
  try {
    extracted = await extractGraph(dir);
  } catch (err) {
    throw new UserFacingError((err as Error).message);
  }
  progress("history");
  const history = await loadHistory(dir, extracted.graph);
  progress("summarize");
  const overview = await buildOverview({ dir, graph: extracted.graph, meta: null, source: { kind: "local", path: label } });
  return { graph: { ...extracted.graph, root: label }, overview, history, warnings: extracted.warnings };
}

async function loadHistory(dir: string, graph: DepGraph): Promise<HistoryData | null> {
  const commits = await readGitHistory(dir, HISTORY_DEPTH);
  if (!commits) return null;
  return {
    commits: trimHistory(commits, new Set(graph.nodes.map((n) => n.id))),
    read: commits.length,
    truncated: commits.length >= HISTORY_DEPTH - 1,
  };
}

export function errorMessage(err: unknown): string {
  if (err instanceof UserFacingError || err instanceof RepoError) return err.message;
  return `Analysis failed: ${err instanceof Error ? err.message : String(err)}`;
}
