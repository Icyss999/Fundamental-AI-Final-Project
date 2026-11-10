import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { GIT_LOG_FORMAT, parseGitLog, type Commit } from "@/lib/diagnose/history";

const run = promisify(execFile);

/**
 * Commit history of `dir` (paths relative to it), newest first, from `git log`. Returns null when
 * `dir` is not inside a git repository. Merge commits and the commits at a shallow clone's
 * boundary are left out: git shows a boundary commit as adding every file, which is not a change.
 */
export async function readGitHistory(dir: string, limit: number): Promise<Commit[] | null> {
  let stdout: string;
  try {
    ({ stdout } = await run(
      "git",
      [
        "-C", dir,
        "-c", "core.quotePath=false",
        "log", "--no-merges", "--no-renames", "--name-only", "--relative",
        `--format=${GIT_LOG_FORMAT}`, "-n", String(limit), "--", ".",
      ],
      { timeout: 30_000, maxBuffer: 64 * 1024 * 1024 },
    ));
  } catch {
    return null;
  }
  const boundary = await shallowBoundary(dir);
  return parseGitLog(stdout).filter((c) => !boundary.has(c.sha));
}

async function shallowBoundary(dir: string): Promise<Set<string>> {
  try {
    const { stdout } = await run("git", ["-C", dir, "rev-parse", "--git-path", "shallow"]);
    const file = path.resolve(dir, stdout.trim());
    return new Set((await readFile(/*turbopackIgnore: true*/ file, "utf8")).split("\n").map((l) => l.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

/** History recorded in a text file in the `git log` format (used by the bundled sample project). */
export async function readHistoryFixture(file: string): Promise<Commit[]> {
  return parseGitLog(await readFile(/*turbopackIgnore: true*/ file, "utf8"));
}

/** Keeps only the project's files in each commit (remembering how many it touched) and drops commits left empty. */
export function trimHistory(commits: readonly Commit[], files: ReadonlySet<string>): Commit[] {
  const result: Commit[] = [];
  for (const c of commits) {
    const kept = c.files.filter((f) => files.has(f));
    if (kept.length === 0) continue;
    result.push({ ...c, subject: c.subject.slice(0, 160), files: kept, ...(kept.length < c.files.length ? { touched: c.files.length } : {}) });
  }
  return result;
}
