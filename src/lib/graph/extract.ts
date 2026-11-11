import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cruise, type ICruiseOptions, type ICruiseResult } from "dependency-cruiser";
import extractTSConfig from "dependency-cruiser/config-utl/extract-ts-config";
import ts from "typescript";
import { extractPolyglot } from "./polyglot";
import type { DepGraph, FileNode, FileRole, ImportEdge } from "./types";

/** Folders that never contain project source we want on the diagram. */
const IGNORED_PATHS = "(^|/)(node_modules|\\.next|\\.nuxt|\\.svelte-kit|\\.turbo|\\.git|dist|build|out|coverage)(/|$)";
/**
 * The JS/TS files dependency-cruiser reads (plus components it resolves imports to); other
 * languages come from the polyglot extractor. Assets (CSS, SVG, JSON...) are left off the graph.
 */
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/;

/** Test files, by each ecosystem's convention. */
const TEST_FILE = new RegExp(
  [
    String.raw`(^|/)(__tests__|__mocks__|__fixtures__|tests?|Tests?|test-d|specs?|e2e|cypress|playwright|testing|androidTest|testFixtures)/`,
    String.raw`\.(test|spec|e2e|test-d)\.[cm]?[jt]sx?$`,
    String.raw`(^|/)test_[^/]*\.py$|_test\.py$|(^|/)conftest\.py$`,
    String.raw`_test\.(go|dart|exs|rb|c|cc|cpp)$|_unittest\.(cc|cpp)$|_spec\.rb$`,
    String.raw`[a-z0-9](Test|Tests|IT|Spec|Specs)\.(java|kt|kts|scala|groovy|cs|swift|php|m|mm|hs)$`,
    String.raw`(^|/)[^/]+\.(Tests?|UnitTests|IntegrationTests)/`,
  ].join("|"),
);
const STORY_FILE = /\.stories\.[cm]?[jt]sx?$|(^|\/)\.storybook\//;
const EXAMPLE_FILE = /(^|\/)(examples?|samples?|demos?|docs?|website|playground|sandbox|benchmarks?|benches|bench|fixtures?)\/|(^|\/)[^/]+\.(Examples?|Samples?|Demos?|Benchmarks?)\//;
const DECLARATION_FILE = /\.d\.[cm]?ts$|\.pyi$/;
const CONFIG_FILE = new RegExp(
  [
    String.raw`(^|/)[^/]*\.config\.[cm]?[jt]s$|(^|/)\.[^/]+rc\.[cm]?[jt]s$|(^|/)(jest|vitest)\.setup\.[cm]?[jt]sx?$|^scripts/`,
    // Build scripts and generated migrations of other ecosystems.
    String.raw`(^|/)(setup|noxfile|fabfile)\.py$|(^|/)build\.rs$|(^|/)Package\.swift$|\.gradle\.kts$|\.gradle$|(^|/)(migrations|db/migrate)/`,
  ].join("|"),
);

export function classifyFile(id: string): FileRole {
  if (DECLARATION_FILE.test(id)) return "declaration";
  if (STORY_FILE.test(id)) return "story";
  if (TEST_FILE.test(id)) return "test";
  if (EXAMPLE_FILE.test(id)) return "example";
  if (CONFIG_FILE.test(id)) return "config";
  return "source";
}

export function makeFileNode(id: string, loc = 0): FileNode {
  const slash = id.lastIndexOf("/");
  return {
    id,
    dir: slash === -1 ? "" : id.slice(0, slash),
    name: slash === -1 ? id : id.slice(slash + 1),
    role: classifyFile(id),
    loc,
  };
}

export interface ExtractResult {
  graph: DepGraph;
  /** Non-fatal problems worth telling the user about. */
  warnings: string[];
}

/**
 * The project's file-level import graph in every supported language. JS/TS goes through
 * dependency-cruiser (the rest through the polyglot extractor, merged in at the end).
 * Only project files are kept: npm packages, Node built-ins and unresolvable imports are dropped.
 * When the project has a usable tsconfig.json it is passed to dependency-cruiser so path aliases
 * such as `@/lib/db` resolve to real files.
 */
export async function extractGraph(projectRoot: string): Promise<ExtractResult> {
  const root = path.resolve(projectRoot);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }
  const warnings: string[] = [];

  const tsConfigFile = resolveTsConfig(root, warnings);
  const tsConfig = tsConfigFile ? extractTSConfig(tsConfigFile) : undefined;

  const options: ICruiseOptions = {
    baseDir: root,
    exclude: { path: IGNORED_PATHS },
    doNotFollow: { path: "node_modules" },
    // Keep type-only imports: they are still architectural dependencies.
    tsPreCompilationDeps: true,
    ...(tsConfigFile ? { tsConfig: { fileName: tsConfigFile } } : {}),
  };

  const result = await cruise(["."], options, {}, tsConfig ? { tsConfig } : undefined);
  if (typeof result.output === "string") {
    throw new Error("dependency-cruiser returned text output instead of a cruise result");
  }

  const graph = toDepGraph(root, result.output);
  await Promise.all(
    graph.nodes.map(async (n) => {
      try {
        n.loc = countLines(await readFile(path.join(root, n.id), "utf8"));
      } catch {
        n.loc = 0;
      }
    }),
  );

  // Every other language: Python, Java/Kotlin, Go, Rust, C/C++, C#, PHP, Ruby, Swift, Dart...
  const other = await extractPolyglot(root);
  warnings.push(...other.warnings);
  const merged = mergeGraphs(graph, other.sources.map((s) => makeFileNode(s.id, countLines(s.text))), other.edges);
  if (merged.nodes.length === 0) {
    warnings.push("No source files in a supported language were found.");
  }
  return { graph: merged, warnings };
}

/**
 * Picks the tsconfig to hand dependency-cruiser. The project's own file is used when it loads.
 * When it does not — usually because `extends` points at a package that a fresh clone has not
 * installed — only `baseUrl`/`paths` matter for resolving aliases, so those are copied into a
 * standalone temp config. Returns null when there is nothing alias-related to resolve.
 */
function resolveTsConfig(root: string, warnings: string[]): string | null {
  const own = path.join(root, "tsconfig.json");
  if (!existsSync(own)) return null;
  try {
    extractTSConfig(own);
    return own;
  } catch {
    // fall through to the alias-only config
  }

  const { config } = ts.readConfigFile(own, ts.sys.readFile);
  const options = config?.compilerOptions ?? {};
  if (!options.paths && !options.baseUrl) return null;
  try {
    const dir = path.join(os.tmpdir(), "architecture-mapper", "tsconfig");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${createHash("sha1").update(own).digest("hex").slice(0, 16)}.json`);
    writeFileSync(
      file,
      JSON.stringify({
        compilerOptions: {
          baseUrl: path.resolve(root, options.baseUrl ?? "."),
          paths: options.paths ?? {},
          allowJs: true,
          jsx: "preserve",
        },
        include: [path.join(root, "**/*")],
      }),
    );
    extractTSConfig(file);
    return file;
  } catch {
    warnings.push("tsconfig.json could not be read, so path aliases (like @/…) may not resolve.");
    return null;
  }
}

/** Adds files and imports found by the other-language extractor (imports between known files only). */
export function mergeGraphs(graph: DepGraph, files: FileNode[], edges: readonly { source: string; target: string }[]): DepGraph {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const f of files) if (!nodes.has(f.id)) nodes.set(f.id, f);
  const keys = new Set(graph.edges.map((e) => `${e.source}\0${e.target}`));
  const all = [...graph.edges];
  for (const e of edges) {
    const key = `${e.source}\0${e.target}`;
    if (e.source === e.target || keys.has(key) || !nodes.has(e.source) || !nodes.has(e.target)) continue;
    keys.add(key);
    all.push({ source: e.source, target: e.target, typeOnly: false });
  }
  return { ...graph, nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)), edges: all };
}

export function countLines(text: string): number {
  let count = 0;
  for (const line of text.split("\n")) if (line.trim() !== "") count++;
  return count;
}

function isProjectFile(p: string): boolean {
  return SOURCE_FILE.test(p) && !new RegExp(IGNORED_PATHS).test(p);
}

/** Converts dependency-cruiser's result into our graph model. Exported for tests. */
export function toDepGraph(root: string, cruiseResult: ICruiseResult): DepGraph {
  const nodes = new Map<string, FileNode>();
  const edges = new Map<string, ImportEdge>();

  for (const mod of cruiseResult.modules) {
    if (mod.coreModule || mod.couldNotResolve || !isProjectFile(mod.source)) continue;
    const id = toPosix(mod.source);
    nodes.set(id, makeFileNode(id));
  }

  for (const mod of cruiseResult.modules) {
    const source = toPosix(mod.source);
    if (!nodes.has(source)) continue;
    for (const dep of mod.dependencies) {
      const target = toPosix(dep.resolved);
      if (dep.coreModule || dep.couldNotResolve || !nodes.has(target) || target === source) continue;
      const key = `${source}\0${target}`;
      const typeOnly = dep.dependencyTypes.includes("type-only");
      const existing = edges.get(key);
      // A file may import the same target twice (value + type import); it is value-level if any is.
      edges.set(key, { source, target, typeOnly: existing ? existing.typeOnly && typeOnly : typeOnly });
    }
  }

  return {
    root,
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()],
  };
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/").replace(/^\.\//, "");
}
