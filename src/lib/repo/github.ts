import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface RepoRef {
  owner: string;
  repo: string;
  /** Branch or tag; undefined means the default branch. */
  ref?: string;
  /** Folder inside the repo to analyse (from a /tree/<ref>/<path> URL). */
  subdir?: string;
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const REF = /^[A-Za-z0-9._/-]{1,200}$/;
const SEGMENT = /^[^/\\\0]+$/;

/**
 * Accepts the ways people copy a GitHub repo:
 * `https://github.com/o/r`, `github.com/o/r.git`, `git@github.com:o/r.git`, `o/r`,
 * and `https://github.com/o/r/tree/<branch>/<folder>` to analyse one folder of a branch.
 * Returns null for anything else. Branch names containing "/" are not supported in /tree URLs.
 */
export function parseGitHubUrl(input: string): RepoRef | null {
  let s = input.trim();
  if (!s) return null;

  const ssh = s.match(/^git@github\.com:(.+)$/i);
  if (ssh) s = ssh[1];
  else if (/^(https?:\/\/)?(www\.)?github\.com\//i.test(s)) s = s.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "");
  else if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/?$/.test(s)) return null; // bare "owner/repo" only

  s = s.split(/[?#]/)[0];
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === "." || repo === "..") return null;

  const result: RepoRef = { owner, repo };
  if (parts[2] === "tree" && parts[3]) {
    const ref = decodeURIComponent(parts[3]);
    if (!REF.test(ref) || ref.startsWith("-") || ref.includes("..")) return null;
    result.ref = ref;
    const sub = parts.slice(4).map(decodeURIComponent);
    if (sub.some((p) => p === "." || p === ".." || !SEGMENT.test(p))) return null;
    if (sub.length > 0) result.subdir = sub.join("/");
  }
  return result;
}

export interface RepoMeta {
  fullName: string;
  htmlUrl: string;
  description: string | null;
  homepage: string | null;
  stars: number;
  forks: number;
  language: string | null;
  topics: string[];
  license: string | null;
  defaultBranch: string;
  pushedAt: string | null;
  sizeKb: number;
  private: boolean;
}

export class RepoError extends Error {}

/** API headers. A signed-in user's token wins over the server-wide GITHUB_TOKEN. */
function githubHeaders(token?: string): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "architecture-mapper",
  };
  const auth = token || process.env.GITHUB_TOKEN;
  if (auth) headers.Authorization = `Bearer ${auth}`;
  return headers;
}

/**
 * Repository metadata from the GitHub API. Returns null when the API is unavailable
 * (e.g. rate-limited) so analysis can still go ahead from the clone alone.
 * Throws RepoError when the repository does not exist or is private.
 */
export async function fetchRepoMeta({ owner, repo }: RepoRef, token?: string): Promise<RepoMeta | null> {
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: githubHeaders(token),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
  if (res.status === 401 && token) {
    // Expired or revoked token: public repos should still work, so ask again anonymously.
    try {
      const anonymous = await fetchRepoMeta({ owner, repo });
      if (anonymous) return anonymous;
    } catch {
      // not visible anonymously either
    }
    throw new RepoError("Your GitHub sign-in has expired. Please sign out and sign in again.");
  }
  if (res.status === 404) {
    throw new RepoError(
      token
        ? `Repository ${owner}/${repo} was not found, or your GitHub account can't access it.`
        : `Repository ${owner}/${repo} was not found. If it's private, sign in with GitHub first.`,
    );
  }
  if (!res.ok) return null;
  const d = await res.json();
  return {
    fullName: d.full_name,
    htmlUrl: d.html_url,
    description: d.description ?? null,
    homepage: d.homepage || null,
    stars: d.stargazers_count ?? 0,
    forks: d.forks_count ?? 0,
    language: d.language ?? null,
    topics: Array.isArray(d.topics) ? d.topics : [],
    license: d.license?.spdx_id && d.license.spdx_id !== "NOASSERTION" ? d.license.spdx_id : (d.license?.name ?? null),
    defaultBranch: d.default_branch ?? "main",
    pushedAt: d.pushed_at ?? null,
    sizeKb: d.size ?? 0,
    private: d.private === true,
  };
}

export interface UserRepo {
  fullName: string;
  description: string | null;
  private: boolean;
  language: string | null;
  pushedAt: string | null;
  stars: number;
}

/** Repositories the signed-in user owns, collaborates on, or can see through an organisation. */
export async function listUserRepos(token: string): Promise<UserRepo[]> {
  const repos: UserRepo[] = [];
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(
      `https://api.github.com/user/repos?sort=pushed&per_page=100&page=${page}&affiliation=owner,collaborator,organization_member`,
      { headers: githubHeaders(token), signal: AbortSignal.timeout(10_000) },
    );
    if (res.status === 401) throw new RepoError("Your GitHub sign-in has expired. Please sign out and sign in again.");
    if (!res.ok) throw new RepoError(`GitHub returned ${res.status} while listing your repositories.`);
    const batch = (await res.json()) as Record<string, unknown>[];
    for (const r of batch) {
      repos.push({
        fullName: String(r.full_name),
        description: typeof r.description === "string" ? r.description : null,
        private: r.private === true,
        language: typeof r.language === "string" ? r.language : null,
        pushedAt: typeof r.pushed_at === "string" ? r.pushed_at : null,
        stars: typeof r.stargazers_count === "number" ? r.stargazers_count : 0,
      });
    }
    if (batch.length < 100) break;
  }
  return repos;
}

/** Repos above this size (GitHub's figure, which includes history) are refused. */
export const MAX_REPO_SIZE_KB = 400_000;
/** A clone is reused for this long before being fetched again. */
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_ROOT = path.join(os.tmpdir(), "architecture-mapper", "repos");

const inFlight = new Map<string, Promise<CloneResult>>();

export interface CloneResult {
  /** Folder to analyse (the repo root, or the requested sub-folder). */
  dir: string;
  /** Root of the checkout. */
  repoRoot: string;
  /** Full commit SHA that was checked out. */
  commit: string;
  branch: string;
}

/**
 * Shallow-clones a GitHub repository into a temp cache and returns where it is.
 * Private repositories need the signed-in user's `token`; their clones are cached per token,
 * so one user's private code is never served to someone else from the cache.
 * Concurrent requests for the same repo share one clone. Nothing from the repo is executed:
 * git hooks never come with a clone, LFS downloads and credential prompts are disabled, and
 * symlinks are checked out as plain files.
 */
export async function cloneRepo(ref: RepoRef, meta: RepoMeta | null, token?: string): Promise<CloneResult> {
  if (meta && meta.sizeKb > MAX_REPO_SIZE_KB) {
    throw new RepoError(
      `${meta.fullName} is about ${Math.round(meta.sizeKb / 1024)} MB, over the ${Math.round(MAX_REPO_SIZE_KB / 1024)} MB limit. Try a folder link instead (…/tree/<branch>/<folder>).`,
    );
  }
  const auth = cloneAuth(meta, token);
  const namespace = auth ? `u-${createHash("sha256").update(auth).digest("hex").slice(0, 16)}` : "pub";
  const key = `${namespace}__${ref.owner}__${ref.repo}__${(ref.ref ?? "HEAD").replace(/[^A-Za-z0-9._-]/g, "_")}`.toLowerCase();
  const pending = inFlight.get(key);
  if (pending) return withSubdir(await pending, ref);

  const job = cloneInto(key, ref, auth).finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return withSubdir(await job, ref);
}

/** Authenticate only when needed: private repos, or when the API couldn't tell us. */
function cloneAuth(meta: RepoMeta | null, token?: string): string | undefined {
  return token && (meta === null || meta.private) ? token : undefined;
}

function withSubdir(result: CloneResult, ref: RepoRef): CloneResult {
  if (!ref.subdir) return result;
  const dir = path.join(result.repoRoot, ref.subdir);
  if (!dir.startsWith(result.repoRoot + path.sep) || !existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new RepoError(`Folder "${ref.subdir}" does not exist in ${ref.owner}/${ref.repo}.`);
  }
  return { ...result, dir };
}

async function gitInfo(dir: string): Promise<{ commit: string; branch: string }> {
  const [{ stdout: commit }, { stdout: branch }] = await Promise.all([
    run("git", ["-C", dir, "rev-parse", "HEAD"]),
    run("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]),
  ]);
  return { commit: commit.trim(), branch: branch.trim() };
}

/**
 * Git config passed through the environment (not argv, so it doesn't show in `ps`, and not
 * written to the clone's .git/config): an Authorization header for github.com only.
 */
export function gitAuthEnv(token: string | undefined): Record<string, string> {
  if (!token) return {};
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}

async function cloneInto(key: string, ref: RepoRef, token: string | undefined): Promise<CloneResult> {
  const dest = path.join(CACHE_ROOT, key);
  if (existsSync(path.join(dest, ".git")) && Date.now() - statSync(dest).mtimeMs < CACHE_TTL_MS) {
    return { dir: dest, repoRoot: dest, ...(await gitInfo(dest)) };
  }

  await mkdir(CACHE_ROOT, { recursive: true });
  const tmp = `${dest}.tmp-${randomUUID()}`;
  const url = `https://github.com/${ref.owner}/${ref.repo}.git`;
  try {
    await run(
      "git",
      [
        // Check symlinks out as plain files so a repo cannot point the analyser at files on this machine.
        "-c", "core.symlinks=false",
        "clone", "--depth", "1", "--single-branch", "--no-tags",
        ...(ref.ref ? ["--branch", ref.ref] : []),
        "--", url, tmp,
      ],
      {
        timeout: 180_000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1", GIT_ASKPASS: "echo", ...gitAuthEnv(token) },
      },
    );
  } catch (err) {
    await rm(tmp, { recursive: true, force: true });
    const stderr = (err as { stderr?: string }).stderr ?? "";
    if (/Remote branch .* not found/i.test(stderr)) {
      throw new RepoError(`Branch or tag "${ref.ref}" was not found in ${ref.owner}/${ref.repo}.`);
    }
    if (/could not read Username|Repository not found|Authentication failed|403|401/i.test(stderr)) {
      throw new RepoError(
        token
          ? `GitHub refused access to ${ref.owner}/${ref.repo}. Your account may not have access, or the sign-in expired.`
          : `Could not access ${ref.owner}/${ref.repo}. If it's private, sign in with GitHub first.`,
      );
    }
    if ((err as { killed?: boolean }).killed) throw new RepoError("Downloading the repository took too long.");
    throw new RepoError(`git clone failed: ${stderr.trim().split("\n").pop() || (err as Error).message}`);
  }

  await rm(dest, { recursive: true, force: true });
  await rename(tmp, dest);
  return { dir: dest, repoRoot: dest, ...(await gitInfo(dest)) };
}

/** How many commits of history are fetched and read for bug-risk scoring. */
export const HISTORY_DEPTH = 300;
const deepening = new Map<string, Promise<void>>();

/**
 * Deepens the shallow clone to HISTORY_DEPTH commits so the bug-risk layer has history to read.
 * Only commits and trees come down (`--filter=blob:none`): `git log --name-only` needs no file
 * contents. Fetching the analysed commit by SHA works for branch and tag clones alike.
 * A no-op when the clone is already deep enough or not shallow.
 */
export async function deepenHistory(clone: CloneResult, meta: RepoMeta | null, token?: string): Promise<void> {
  const pending = deepening.get(clone.repoRoot);
  if (pending) return pending;
  const job = (async () => {
    const git = (args: string[]) => run("git", ["-C", clone.repoRoot, ...args]);
    if ((await git(["rev-parse", "--is-shallow-repository"])).stdout.trim() !== "true") return;
    if (Number((await git(["rev-list", "--count", "HEAD"])).stdout) >= HISTORY_DEPTH) return;
    await run(
      "git",
      ["-C", clone.repoRoot, "fetch", "--quiet", "--no-tags", `--depth=${HISTORY_DEPTH}`, "--filter=blob:none", "origin", clone.commit],
      {
        timeout: 120_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1", GIT_ASKPASS: "echo", ...gitAuthEnv(cloneAuth(meta, token)) },
      },
    );
  })().finally(() => deepening.delete(clone.repoRoot));
  deepening.set(clone.repoRoot, job);
  return job;
}
