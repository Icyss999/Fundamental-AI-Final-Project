/**
 * Vue, Svelte and Astro components: the imports in their <script> blocks (and Astro frontmatter),
 * resolved like a bundler would: relative paths and the common `@/` / `~/` aliases for src/, with
 * the usual extensions and index files.
 */

import { dirname, EdgeSet, joinPath, type Edge, type Project } from "../project";

const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".vue", ".svelte", ".astro", "/index.ts", "/index.js", "/index.vue", "/index.svelte"];

export function resolveModule(p: Project, from: string, spec: string): string | null {
  let base: string | null;
  if (spec.startsWith(".")) base = joinPath(dirname(from), spec);
  else if (/^[@~]\//.test(spec)) base = p.first(["src", "app", ""].flatMap((root) => EXTENSIONS.map((e) => `${joinPath(root, spec.slice(2))}${e}`))) ?? null;
  else return null;
  if (base === null) return null;
  return p.first(EXTENSIONS.map((e) => `${base}${e}`));
}

export function web(p: Project): Edge[] {
  const edges = new EdgeSet();
  for (const f of p.of("vue", "svelte", "astro")) {
    const blocks = [...f.text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const front = f.text.match(/^---\n([\s\S]*?)\n---/);
    if (front) blocks.push(front[1]);
    for (const block of blocks) {
      for (const m of block.matchAll(/(?:\bimport\b[^'"]*?\bfrom\s*|\bimport\s*\(?\s*|\bexport\b[^'"]*?\bfrom\s*)['"]([^'"]+)['"]/g)) {
        edges.add(f.id, resolveModule(p, f.id, m[1]));
      }
    }
  }
  return edges.list;
}
