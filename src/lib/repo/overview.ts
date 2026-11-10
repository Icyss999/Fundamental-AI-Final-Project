import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DepGraph } from "@/lib/graph/types";
import type { RepoMeta } from "./github";

export type TechCategory = "Language" | "Framework" | "UI" | "Styling" | "State & data" | "Backend" | "Testing" | "Tooling";

export interface TechItem {
  name: string;
  category: TechCategory;
}

export type ProjectSource =
  | { kind: "github"; owner: string; repo: string; url: string; branch: string; commit: string; subdir?: string; private: boolean }
  | { kind: "local"; path: string };

export interface ProjectOverview {
  name: string;
  source: ProjectSource;
  /** One-line description (GitHub "About", else package.json). */
  description: string | null;
  readme: { file: string; title: string | null; summary: string | null } | null;
  github: Pick<RepoMeta, "stars" | "forks" | "language" | "topics" | "license" | "homepage" | "pushedAt"> | null;
  packageInfo: { name: string | null; version: string | null; scripts: string[] } | null;
  techStack: TechItem[];
  languages: { name: string; files: number; loc: number }[];
}

const README_NAMES = ["README.md", "readme.md", "Readme.md", "README.mdx", "README.markdown", "README.rst", "README.txt", "README"];

// ---------------------------------------------------------------------------------------------
// README

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Markdown/HTML inline text -> plain text. */
function plainInline(s: string): string {
  return decodeEntities(
    s
      .replace(/<[^>]+>/g, " ") // HTML tags
      .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "") // linked badges
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
      .replace(/!\[[^\]]*\]\[[^\]]*\]/g, "") // reference images
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1") // reference links
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\*\*|__/g, "")
      .replace(/(^|[\s(])[*_](\S[^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2"),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function truncateAtSentence(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

/**
 * Pulls a title and the opening prose out of a README: skips badges, images, headings,
 * lists, tables and code, and returns plain text (never HTML).
 */
export function summarizeReadme(markdown: string): { title: string | null; summary: string | null } {
  const text = markdown
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^(```|~~~)[\s\S]*?^\1/gm, "");

  // The title is the README's first heading, and only if that heading is top-level (#, ===, <h1>);
  // otherwise the first heading is usually a section like "Recipes" or "Install".
  let title: string | null = null;
  const firstHeading = text.match(/^(#{1,6})\s+(.+?)\s*#*\s*$|^(.+)\n(=+|-+)\s*$|<h([1-6])[^>]*>([\s\S]*?)<\/h\5>/im);
  if (firstHeading) {
    const [, hashes, atx, setext, underline, htmlLevel, html] = firstHeading;
    const isTopLevel = hashes ? hashes.length === 1 : setext ? underline.startsWith("=") : htmlLevel === "1";
    if (isTopLevel) title = plainInline(atx ?? setext ?? html ?? "") || null;
  }

  const paragraphs: string[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (/^#{1,6}\s/.test(trimmed) || /^\S.*\n[=-]+$/.test(trimmed)) continue; // headings
    if (/^(\||[-*+]\s|\d+[.)]\s|-{3,}|\*{3,}|_{3,})/.test(trimmed)) continue; // tables, lists, rules
    if (/^<(h\d|table|ul|ol|pre|picture|img)\b/i.test(trimmed) && !/<p\b/i.test(trimmed)) continue;
    if (/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(trimmed)) continue; // GitHub alert boxes
    const quoted = trimmed.startsWith(">"); // taglines usually live in a blockquote
    const prose = plainInline(trimmed.replace(/^>\s?/gm, ""));
    if (prose.length < (quoted ? 20 : 40) || !/[a-z]{3}/i.test(prose) || /^https?:\/\/\S+$/.test(prose)) continue;
    if (/^(table of contents|contents)\b/i.test(prose)) continue;
    paragraphs.push(prose);
    if (paragraphs.length === 2 || paragraphs.join(" ").length > 200) break;
  }

  // Paragraphs that end without punctuation (taglines) still need a full stop before the next one.
  const joined = paragraphs.map((p, i) => (i < paragraphs.length - 1 && !/[.!?:…]$/.test(p) ? `${p}.` : p)).join(" ");
  const summary = paragraphs.length > 0 ? truncateAtSentence(joined, 700) : null;
  return { title, summary };
}

// ---------------------------------------------------------------------------------------------
// Tech stack

type Matcher = string | RegExp;
const TECH: [Matcher, string, TechCategory][] = [
  ["next", "Next.js", "Framework"],
  ["nuxt", "Nuxt", "Framework"],
  ["@sveltejs/kit", "SvelteKit", "Framework"],
  ["astro", "Astro", "Framework"],
  [/^@remix-run\//, "Remix", "Framework"],
  ["gatsby", "Gatsby", "Framework"],
  ["expo", "Expo", "Framework"],
  ["react-native", "React Native", "Framework"],
  ["electron", "Electron", "Framework"],
  ["@angular/core", "Angular", "Framework"],
  ["react", "React", "UI"],
  ["vue", "Vue", "UI"],
  ["svelte", "Svelte", "UI"],
  ["solid-js", "Solid", "UI"],
  ["preact", "Preact", "UI"],
  ["@mui/material", "Material UI", "UI"],
  ["@chakra-ui/react", "Chakra UI", "UI"],
  [/^@radix-ui\//, "Radix UI", "UI"],
  ["@headlessui/react", "Headless UI", "UI"],
  ["framer-motion", "Framer Motion", "UI"],
  ["three", "three.js", "UI"],
  ["tailwindcss", "Tailwind CSS", "Styling"],
  ["styled-components", "styled-components", "Styling"],
  ["@emotion/react", "Emotion", "Styling"],
  ["sass", "Sass", "Styling"],
  ["@reduxjs/toolkit", "Redux Toolkit", "State & data"],
  ["redux", "Redux", "State & data"],
  ["zustand", "Zustand", "State & data"],
  ["jotai", "Jotai", "State & data"],
  ["mobx", "MobX", "State & data"],
  ["@tanstack/react-query", "TanStack Query", "State & data"],
  ["swr", "SWR", "State & data"],
  ["@apollo/client", "Apollo Client", "State & data"],
  ["graphql", "GraphQL", "State & data"],
  [/^@trpc\//, "tRPC", "State & data"],
  ["zod", "Zod", "State & data"],
  ["axios", "Axios", "State & data"],
  ["express", "Express", "Backend"],
  ["fastify", "Fastify", "Backend"],
  ["koa", "Koa", "Backend"],
  ["hono", "Hono", "Backend"],
  ["@nestjs/core", "NestJS", "Backend"],
  ["@prisma/client", "Prisma", "Backend"],
  ["prisma", "Prisma", "Backend"],
  ["drizzle-orm", "Drizzle", "Backend"],
  ["mongoose", "Mongoose", "Backend"],
  ["typeorm", "TypeORM", "Backend"],
  ["sequelize", "Sequelize", "Backend"],
  ["next-auth", "NextAuth.js", "Backend"],
  ["stripe", "Stripe", "Backend"],
  ["socket.io", "Socket.IO", "Backend"],
  ["vitest", "Vitest", "Testing"],
  ["jest", "Jest", "Testing"],
  ["mocha", "Mocha", "Testing"],
  ["@playwright/test", "Playwright", "Testing"],
  ["cypress", "Cypress", "Testing"],
  [/^@testing-library\//, "Testing Library", "Testing"],
  ["vite", "Vite", "Tooling"],
  ["webpack", "webpack", "Tooling"],
  ["esbuild", "esbuild", "Tooling"],
  ["rollup", "Rollup", "Tooling"],
  ["tsup", "tsup", "Tooling"],
  ["turbo", "Turborepo", "Tooling"],
  ["@biomejs/biome", "Biome", "Tooling"],
  ["eslint", "ESLint", "Tooling"],
  ["prettier", "Prettier", "Tooling"],
];

/** Categories that describe what the project *is built with*, so dev-only dependencies don't count. */
const RUNTIME_CATEGORIES: ReadonlySet<TechCategory> = new Set(["Framework", "UI", "Styling", "State & data", "Backend"]);

/**
 * @param runtimeDeps dependencies + peerDependencies (decide frameworks, UI, data, backend)
 * @param devDeps devDependencies (only count for testing and tooling — test suites often pull in
 *                frameworks the project itself doesn't use)
 */
export function detectTechStack(runtimeDeps: Iterable<string>, devDeps: Iterable<string>, usesTypeScript: boolean): TechItem[] {
  const runtime = [...runtimeDeps];
  const all = [...runtime, ...devDeps];
  const found = new Map<string, TechItem>();
  found.set(usesTypeScript ? "TypeScript" : "JavaScript", {
    name: usesTypeScript ? "TypeScript" : "JavaScript",
    category: "Language",
  });
  for (const [match, name, category] of TECH) {
    if (found.has(name)) continue;
    const pool = RUNTIME_CATEGORIES.has(category) ? runtime : all;
    if (pool.some((d) => (typeof match === "string" ? d === match : match.test(d)))) found.set(name, { name, category });
  }
  return [...found.values()];
}

// ---------------------------------------------------------------------------------------------
// Assembly

interface PackageJson {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
}

async function readJson(file: string): Promise<PackageJson | null> {
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

// The paths below point into analysed repositories, not into this app, so they carry
// `turbopackIgnore` to stop Next's file tracing from bundling the whole project for deployment.

/** package.json files of the project plus first-level workspace packages (apps/*, packages/*…). */
function packageJsonFiles(dir: string): string[] {
  const files = [path.join(/*turbopackIgnore: true*/ dir, "package.json")];
  for (const ws of ["apps", "packages", "libs", "services"]) {
    const wsDir = path.join(/*turbopackIgnore: true*/ dir, ws);
    if (!existsSync(/*turbopackIgnore: true*/ wsDir) || !statSync(/*turbopackIgnore: true*/ wsDir).isDirectory()) continue;
    for (const entry of readdirSync(/*turbopackIgnore: true*/ wsDir).slice(0, 50)) {
      files.push(path.join(/*turbopackIgnore: true*/ wsDir, entry, "package.json"));
    }
  }
  return files.filter((f) => existsSync(/*turbopackIgnore: true*/ f));
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "TypeScript", mts: "TypeScript", cts: "TypeScript", tsx: "TSX",
  js: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", jsx: "JSX",
};

export function languageBreakdown(graph: DepGraph): ProjectOverview["languages"] {
  const langs = new Map<string, { files: number; loc: number }>();
  for (const n of graph.nodes) {
    const name = LANGUAGE_BY_EXT[n.id.slice(n.id.lastIndexOf(".") + 1)] ?? "Other";
    const entry = langs.get(name) ?? { files: 0, loc: 0 };
    entry.files++;
    entry.loc += n.loc;
    langs.set(name, entry);
  }
  return [...langs.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.loc - a.loc);
}

export async function buildOverview(opts: {
  dir: string;
  /** Repo root, when `dir` is a sub-folder of it (README/package.json fall back to it). */
  repoRoot?: string;
  graph: DepGraph;
  source: ProjectSource;
  meta: RepoMeta | null;
}): Promise<ProjectOverview> {
  const { dir, graph, source, meta } = opts;
  const searchDirs = [...new Set([dir, opts.repoRoot ?? dir])];

  let readme: ProjectOverview["readme"] = null;
  outer: for (const d of searchDirs) {
    for (const name of README_NAMES) {
      const file = path.join(/*turbopackIgnore: true*/ d, name);
      if (!existsSync(/*turbopackIgnore: true*/ file)) continue;
      const stat = statSync(/*turbopackIgnore: true*/ file);
      if (stat.isFile() && stat.size < 2_000_000) {
        const markdown = await readFile(/*turbopackIgnore: true*/ file, "utf8");
        readme = { file: path.relative(opts.repoRoot ?? dir, file) || name, ...summarizeReadme(markdown) };
        break outer;
      }
    }
  }

  const pkgFiles = searchDirs.flatMap(packageJsonFiles);
  const pkgs = (await Promise.all(pkgFiles.map(readJson))).filter((p): p is PackageJson => p !== null);
  const main = pkgs[0] ?? null;
  const runtimeDeps = new Set<string>();
  const devDeps = new Set<string>();
  const ownNames = new Set(pkgs.map((p) => str(p.name)).filter(Boolean));
  const add = (into: Set<string>, field: Record<string, unknown> | undefined) => {
    if (field && typeof field === "object") Object.keys(field).forEach((d) => !ownNames.has(d) && into.add(d));
  };
  for (const p of pkgs) {
    add(runtimeDeps, p.dependencies);
    add(runtimeDeps, p.peerDependencies);
    add(devDeps, p.devDependencies);
  }

  const usesTypeScript = graph.nodes.some((n) => /\.[cm]?tsx?$/.test(n.id)) || existsSync(path.join(dir, "tsconfig.json"));
  const name =
    source.kind === "github"
      ? source.subdir
        ? `${source.repo}/${source.subdir}`
        : source.repo
      : (str(main?.name) ?? path.basename(dir));

  return {
    name,
    source,
    description: meta?.description ?? str(main?.description),
    readme,
    github: meta
      ? { stars: meta.stars, forks: meta.forks, language: meta.language, topics: meta.topics, license: meta.license, homepage: meta.homepage, pushedAt: meta.pushedAt }
      : null,
    packageInfo: main
      ? { name: str(main.name), version: str(main.version), scripts: Object.keys(main.scripts ?? {}).slice(0, 12) }
      : null,
    techStack: detectTechStack(runtimeDeps, devDeps, usesTypeScript),
    languages: languageBreakdown(graph),
  };
}
