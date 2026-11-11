/**
 * Import graphs for every language other than JS/TS (which dependency-cruiser handles): walks the
 * project, reads code files, and runs each language's extractor over one in-memory Project.
 * Server only (reads the disk); the extractors themselves are pure.
 */

import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { cfamily } from "./extractors/cfamily";
import { csharp } from "./extractors/csharp";
import { dart } from "./extractors/dart";
import { go } from "./extractors/go";
import { jvm } from "./extractors/jvm";
import { misc } from "./extractors/misc";
import { php } from "./extractors/php";
import { python } from "./extractors/python";
import { ruby } from "./extractors/ruby";
import { rust } from "./extractors/rust";
import { swift } from "./extractors/swift";
import { web } from "./extractors/web";
import { isJsTs, languageOf } from "./languages";
import { basename, Project, type Edge, type Source } from "./project";

/** Folders of dependencies, build output, caches and virtualenvs — never project source. */
export const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "vendor", "third_party", "third-party", "target", "build", "dist", "out", "obj",
  ".venv", "venv", "virtualenv", "__pycache__", ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache", "site-packages",
  ".gradle", ".idea", ".vs", ".vscode", "Pods", "Carthage", "DerivedData", ".build", ".swiftpm", ".dart_tool", ".pub-cache",
  "deps", "_build", ".elixir_ls", ".stack-work", "dist-newstyle", "elm-stuff", ".cargo", "coverage", ".next", ".nuxt",
  ".svelte-kit", ".turbo", ".cache", ".terraform", "bower_components", "jspm_packages",
]);
const MANIFESTS = new Set(["go.mod", "Cargo.toml", "composer.json", "pubspec.yaml"]);
const MAX_ENTRIES = 120_000;
const MAX_CODE_FILES = 15_000;
const MAX_FILE_BYTES = 1_000_000;

const EXTRACTORS = { python, jvm, go, rust, cfamily, csharp, php, ruby, swift, dart, web, misc };

/** Runs every extractor; one that throws loses only its own language's edges. */
export function extractEdges(project: Project, warnings: string[] = []): Edge[] {
  const edges: Edge[] = [];
  for (const [name, run] of Object.entries(EXTRACTORS)) {
    try {
      edges.push(...run(project));
    } catch (err) {
      warnings.push(`Imports of ${name} files could not be read: ${(err as Error).message}`);
    }
  }
  return edges;
}

export interface PolyglotResult {
  /** Code files read (not JS/TS), with their text for line counts. */
  sources: Source[];
  edges: Edge[];
  warnings: string[];
}

export async function extractPolyglot(root: string): Promise<PolyglotResult> {
  const warnings: string[] = [];
  const paths: string[] = [];
  const stack = [""];
  let truncated = false;
  while (stack.length > 0) {
    const rel = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = await readdir(/*turbopackIgnore: true*/ path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name) && !(e.name.startsWith(".") && e.name !== ".github")) stack.push(child);
      } else if (e.isFile()) {
        paths.push(child);
        if (paths.length >= MAX_ENTRIES) {
          truncated = true;
          stack.length = 0;
          break;
        }
      }
    }
  }
  if (truncated) warnings.push(`The project has more than ${MAX_ENTRIES.toLocaleString("en")} files; only part of it was read.`);

  const code = paths.filter((p) => languageOf(p) && !isJsTs(p)).sort();
  if (code.length > MAX_CODE_FILES) warnings.push(`Only the first ${MAX_CODE_FILES.toLocaleString("en")} of ${code.length.toLocaleString("en")} code files were mapped.`);
  const read = async (rel: string): Promise<string | null> => {
    try {
      const file = path.join(root, rel);
      if ((await stat(/*turbopackIgnore: true*/ file)).size > MAX_FILE_BYTES) return null;
      const text = await readFile(/*turbopackIgnore: true*/ file, "utf8");
      return text.slice(0, 8000).includes("\0") ? null : text;
    } catch {
      return null;
    }
  };

  const sources: Source[] = [];
  const todo = code.slice(0, MAX_CODE_FILES);
  for (let i = 0; i < todo.length; i += 64) {
    const batch = await Promise.all(todo.slice(i, i + 64).map(async (id) => ({ id, text: await read(id) })));
    for (const { id, text } of batch) if (text !== null) sources.push({ id, lang: languageOf(id)!.id, text });
  }
  const manifests = new Map<string, string>();
  for (const rel of paths.filter((p) => MANIFESTS.has(basename(p))).slice(0, 300)) {
    const text = await read(rel);
    if (text !== null) manifests.set(rel, text);
  }

  const project = new Project(sources, paths, manifests);
  return { sources, edges: extractEdges(project, warnings), warnings };
}
