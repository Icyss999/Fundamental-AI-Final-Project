/**
 * Rust: modules follow files (`a/b.rs` or `a/b/mod.rs` is module `a::b` of its crate; `lib.rs`
 * and `main.rs` are the root). `mod x;` pulls a child file in; paths in `use` trees and in code
 * (`crate::`, `self::`, `super::`, or a workspace crate's name) point at the deepest module file
 * they name. Crates come from Cargo.toml `[package] name` (`-` becomes `_`).
 */

import { basename, dirname, EdgeSet, joinPath, type Edge, type Project } from "../project";

interface Crate {
  name: string;
  /** The crate's src/ folder. */
  src: string;
}

/** Expands a use tree: `a::{b, c::{d, e as f}, self}` -> ["a::b", "a::c::d", "a::c::e", "a"]. */
export function expandUse(tree: string): string[] {
  // Aliases first (`e as f` names e), then whitespace.
  const t = tree.replace(/\s+as\s+\w+/g, "").replace(/\s+/g, "");
  const open = t.indexOf("{");
  if (open === -1) return [t.replace(/::\*$/, "").replace(/::self$/, "")].filter(Boolean);
  const prefix = t.slice(0, open).replace(/::$/, "");
  const inner = t.slice(open + 1, t.lastIndexOf("}"));
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= inner.length; i++) {
    const c = inner[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if ((c === "," && depth === 0) || i === inner.length) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  return parts
    .filter(Boolean)
    .flatMap((part) => (part === "self" ? [prefix] : expandUse(part).map((x) => (prefix ? `${prefix}::${x}` : x))))
    .filter(Boolean);
}

export function rust(p: Project): Edge[] {
  const files = p.of("rust");
  if (files.length === 0) return [];
  const crates: Crate[] = [];
  for (const [file, text] of p.manifests) {
    if (basename(file) !== "Cargo.toml") continue;
    const pkg = text.match(/\[package\][^[]*?\bname\s*=\s*"([^"]+)"/);
    if (pkg) crates.push({ name: pkg[1].replace(/-/g, "_"), src: joinPath(dirname(file), "src")! });
  }
  // Without a Cargo.toml, every src/ folder holding lib.rs or main.rs is a crate.
  if (crates.length === 0) {
    for (const f of files) if (/(^|\/)src\/(lib|main)\.rs$/.test(f.id)) crates.push({ name: "", src: dirname(f.id) });
  }

  const crateOf = (id: string): Crate | null => {
    let best: Crate | null = null;
    for (const c of crates) if ((id === c.src || id.startsWith(`${c.src}/`)) && (!best || c.src.length > best.src.length)) best = c;
    return best;
  };
  /** Module path of a file inside its crate's src/ (null for files outside any src/: tests, examples, build.rs). */
  const modulePath = (id: string, crate: Crate | null): string[] | null => {
    if (!crate) return null;
    const rel = id.slice(crate.src.length + 1).replace(/\.rs$/, "").split("/");
    if (rel.length === 1 && (rel[0] === "lib" || rel[0] === "main")) return [];
    if (rel[0] === "bin") return [];
    if (rel[rel.length - 1] === "mod") rel.pop();
    return rel;
  };
  /** The file holding module `segs` of `crate`, or the deepest existing ancestor module. */
  const moduleFile = (crate: Crate, segs: string[]): string | null => {
    for (let k = segs.length; k >= 0; k--) {
      const base = [crate.src, ...segs.slice(0, k)].join("/");
      const hit = k === 0 ? p.first([`${crate.src}/lib.rs`, `${crate.src}/main.rs`]) : p.first([`${base}.rs`, `${base}/mod.rs`]);
      if (hit) return hit;
    }
    return null;
  };
  const byName = new Map(crates.filter((c) => c.name).map((c) => [c.name, c]));

  const edges = new EdgeSet();
  for (const f of files) {
    const own = crateOf(f.id);
    // Integration tests, examples and benches use the package's crate by name; treat them as outside it.
    const outside = /(^|\/)(tests|examples|benches)\//.test(f.id) || basename(f.id) === "build.rs";
    const crate = outside ? null : own;
    const here = modulePath(f.id, crate);
    const isModRoot = /(^|\/)(mod|lib|main)\.rs$/.test(f.id);
    const code = p.bare(f);

    // `mod child;` (not inline `mod child { ... }`).
    if (crate && here) {
      for (const m of code.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm)) {
        const dir = isModRoot ? dirname(f.id) : f.id.replace(/\.rs$/, "");
        edges.add(f.id, p.first([`${dir}/${m[1]}.rs`, `${dir}/${m[1]}/mod.rs`]));
      }
    }

    const resolve = (path: string) => {
      let segs = path.split("::").filter(Boolean);
      if (segs.length === 0) return;
      let target: Crate;
      let base: string[] = [];
      if (segs[0] === "crate") {
        if (!crate || !here) return;
        target = crate;
        segs = segs.slice(1);
      } else if (segs[0] === "self" || segs[0] === "super") {
        if (!crate || !here) return;
        target = crate;
        base = [...here];
        if (segs[0] === "self") segs = segs.slice(1);
        while (segs[0] === "super") {
          base.pop();
          segs = segs.slice(1);
        }
      } else if (byName.has(segs[0])) {
        target = byName.get(segs[0])!;
        segs = segs.slice(1);
      } else if (crate && here && here.length === 0 && p.first([`${crate.src}/${segs[0]}.rs`, `${crate.src}/${segs[0]}/mod.rs`])) {
        // In the crate root, `use child::x` names a top-level module.
        target = crate;
      } else return;
      edges.add(f.id, moduleFile(target, [...base, ...segs]));
    };

    for (const m of code.matchAll(/\buse\s+([^;]+);/g)) for (const path of expandUse(m[1])) resolve(path);
    for (const m of code.matchAll(/\b((?:crate|self|super|[a-z_][a-z0-9_]*)(?:::[A-Za-z_]\w*)+)/g)) {
      if (byName.has(m[1].split("::")[0]) || /^(crate|self|super)::/.test(m[1])) resolve(m[1]);
    }
  }
  return edges.list;
}
