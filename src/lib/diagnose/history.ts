/**
 * Git history -> per-file bug-fix and change counts (the evidence behind Layer 2's prior).
 * Pure: the server runs `git log` and hands the text to `parseGitLog`.
 */

/** One commit, reduced to what bug-risk scoring needs. */
export interface Commit {
  sha: string;
  /** Commit time, Unix seconds. */
  time: number;
  subject: string;
  /** Files touched, relative to the analysed folder (POSIX). */
  files: string[];
  /** Total files the commit touched, when `files` was trimmed to the project's source files. */
  touched?: number;
}

/** Starts each commit in the log text; file paths follow on their own lines. */
export const COMMIT_MARKER = "@@@";
/** `git log --format=` value whose output `parseGitLog` reads. */
export const GIT_LOG_FORMAT = `${COMMIT_MARKER}%H|%at|%s`;

/** Parses `git log --name-only --format=GIT_LOG_FORMAT` output. */
export function parseGitLog(text: string): Commit[] {
  const commits: Commit[] = [];
  let current: Commit | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith(COMMIT_MARKER)) {
      const body = line.slice(COMMIT_MARKER.length);
      const a = body.indexOf("|");
      const b = a === -1 ? -1 : body.indexOf("|", a + 1);
      if (b === -1) {
        current = null;
        continue;
      }
      const time = Number(body.slice(a + 1, b));
      current = { sha: body.slice(0, a), time: Number.isFinite(time) ? time : 0, subject: body.slice(b + 1).trim(), files: [] };
      commits.push(current);
    } else if (current && line.trim() !== "") {
      current.files.push(line.trim());
    }
  }
  return commits;
}

// Words that mark a commit as a bug fix. `\b` keeps "prefix", "fixture" and "debug" out.
const FIX = /\b(fix(e[sd]|ing)?|bugs?|bugfix(es)?|hotfix(es)?|patch(e[sd])?|regressions?|crash(es|ed|ing)?|defects?|faults?|broken|incorrect(ly)?|wrong)\b/i;
// "fix typo" / "fix lint" change no behaviour.
const COSMETIC = /\b(typos?|lint(ing)?|formatting|prettier|spelling|whitespace)\b/i;

/** Whether a commit subject describes a bug fix (the classic SZZ-style keyword heuristic). */
export function isBugFix(subject: string): boolean {
  return FIX.test(subject) && !COSMETIC.test(subject);
}

export interface HistoryOptions {
  /** A change this many days older than the newest commit counts half as much. */
  halfLifeDays: number;
  /** Commits touching more files are bulk edits (formatting, renames, dependency bumps) and are skipped. */
  maxFilesPerCommit: number;
}

export const DEFAULT_HISTORY_OPTIONS: HistoryOptions = { halfLifeDays: 180, maxFilesPerCommit: 40 };

export interface FixRef {
  sha: string;
  subject: string;
  time: number;
}

export interface FileHistory {
  changes: number;
  fixes: number;
  /** Changes and fixes, each weighted by recency (1 = as new as the newest commit). */
  weightedChanges: number;
  weightedFixes: number;
  /** Most recent bug-fix commits first (at most 3). */
  recentFixes: FixRef[];
  lastChange: number | null;
}

export interface HistorySummary {
  /** Commits that touched at least one of the files. */
  commits: number;
  fixCommits: number;
  bulkSkipped: number;
  /** Time range of the commits used (Unix seconds). */
  from: number | null;
  to: number | null;
}

/** Per-file change and bug-fix counts over the commits that touch `files`. */
export function fileHistory(
  commits: readonly Commit[],
  files: ReadonlySet<string>,
  options: HistoryOptions = DEFAULT_HISTORY_OPTIONS,
): { perFile: Map<string, FileHistory>; summary: HistorySummary } {
  const relevant: { commit: Commit; files: string[] }[] = [];
  let bulkSkipped = 0;
  for (const commit of commits) {
    const touched = commit.files.filter((f) => files.has(f));
    if (touched.length === 0) continue;
    if ((commit.touched ?? commit.files.length) > options.maxFilesPerCommit) {
      bulkSkipped++;
      continue;
    }
    relevant.push({ commit, files: touched });
  }

  const times = relevant.map((r) => r.commit.time);
  const newest = times.length > 0 ? Math.max(...times) : 0;
  const perFile = new Map<string, FileHistory>();
  let fixCommits = 0;
  // Newest first, so recentFixes fills in order.
  relevant.sort((a, b) => b.commit.time - a.commit.time);
  for (const { commit, files: touched } of relevant) {
    const ageDays = Math.max(0, newest - commit.time) / 86_400;
    const weight = 0.5 ** (ageDays / options.halfLifeDays);
    const fix = isBugFix(commit.subject);
    if (fix) fixCommits++;
    for (const f of touched) {
      let h = perFile.get(f);
      if (!h) {
        h = { changes: 0, fixes: 0, weightedChanges: 0, weightedFixes: 0, recentFixes: [], lastChange: null };
        perFile.set(f, h);
      }
      h.changes++;
      h.weightedChanges += weight;
      h.lastChange = Math.max(h.lastChange ?? 0, commit.time);
      if (fix) {
        h.fixes++;
        h.weightedFixes += weight;
        if (h.recentFixes.length < 3) h.recentFixes.push({ sha: commit.sha, subject: commit.subject, time: commit.time });
      }
    }
  }

  return {
    perFile,
    summary: {
      commits: relevant.length,
      fixCommits,
      bulkSkipped,
      from: times.length > 0 ? Math.min(...times) : null,
      to: times.length > 0 ? newest : null,
    },
  };
}
