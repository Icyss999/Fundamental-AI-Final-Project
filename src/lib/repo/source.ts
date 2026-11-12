import { realpath, stat, readFile } from "node:fs/promises";
import path from "node:path";
import { fetchRepoFile, isValidRepoName, RepoError } from "./github";
import type { ProjectSource } from "./overview";

/** Largest file the assistant may read. */
export const MAX_SOURCE_BYTES = 400_000;

const SHA = /^[0-9a-f]{40}$/;

/** A relative POSIX path with no way out of its folder, or null. */
export function safeRelativePath(input: unknown): string | null {
  if (typeof input !== "string" || input.length === 0 || input.length > 1000) return null;
  if (input.includes("\0") || input.includes("\\") || input.startsWith("/") || /^[A-Za-z]:/.test(input)) return null;
  const parts = input.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  return input;
}

/**
 * Reads a project file for the assistant. `file` is relative to the analysed folder, as file ids are.
 * GitHub projects are read at the analysed commit; (in development) local folders from disk, never
 * outside the project folder.
 */
export async function readProjectFile(source: unknown, file: unknown, token?: string): Promise<string> {
  const rel = safeRelativePath(file);
  if (!rel) throw new RepoError("That is not a file path inside the project.");
  if (typeof source !== "object" || source === null) throw new RepoError("Missing project source.");
  const s = source as Partial<ProjectSource>;

  if (s.kind === "github") {
    const { owner, repo, commit, subdir } = s as Extract<ProjectSource, { kind: "github" }>;
    if (typeof owner !== "string" || typeof repo !== "string" || !isValidRepoName(owner, repo)) throw new RepoError("Invalid repository.");
    if (typeof commit !== "string" || !SHA.test(commit)) throw new RepoError("Invalid commit.");
    if (subdir !== undefined && !safeRelativePath(subdir)) throw new RepoError("Invalid folder.");
    return fetchRepoFile(owner, repo, commit, subdir ? `${subdir}/${rel}` : rel, MAX_SOURCE_BYTES, token);
  }

  if (s.kind === "local" && typeof s.path === "string") {
    if (!path.isAbsolute(s.path) || process.env.NODE_ENV === "production") throw new RepoError("Local folders can only be read in development mode.");
    return readInside(s.path, rel);
  }
  throw new RepoError("Unknown project source.");
}

async function readInside(root: string, rel: string): Promise<string> {
  let realRoot: string;
  let real: string;
  try {
    realRoot = await realpath(/*turbopackIgnore: true*/ root);
    real = await realpath(/*turbopackIgnore: true*/ path.join(realRoot, rel));
  } catch {
    throw new RepoError(`${rel} was not found.`);
  }
  // realpath resolves symlinks, so a link pointing out of the project is caught here too.
  if (!real.startsWith(realRoot + path.sep)) throw new RepoError("That file is outside the project.");
  const info = await stat(/*turbopackIgnore: true*/ real);
  if (!info.isFile()) throw new RepoError(`${rel} is not a file.`);
  if (info.size > MAX_SOURCE_BYTES) throw new RepoError(`${rel} is too large to read (${Math.round(info.size / 1024)} KB).`);
  return readFile(/*turbopackIgnore: true*/ real, "utf8");
}
