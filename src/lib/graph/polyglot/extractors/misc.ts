/**
 * The smaller languages, each with its own import form:
 *   Lua      require "a.b"                     -> a/b.lua, a/b/init.lua
 *   Elixir   defmodule A.B / alias, use, calls  -> the file defining the module
 *   Erlang   -include("x.hrl"), mod:fun(...)    -> x.hrl, the file with -module(mod)
 *   Haskell  module A.B / import (qualified) A.B
 *   Elm      module A.B exposing .. / import A.B
 *   Clojure  (ns a.b-c (:require [x.y]))        -> the file declaring namespace x.y
 *   Perl     use A::B / require A::B            -> package A::B, else A/B.pm
 *   R        source("x.R"); Julia include("x.jl"); Shell source/. x.sh; Zig @import("x.zig")
 */

import { closest, dirname, EdgeSet, joinPath, type Edge, type Project, type Source } from "../project";

/** Index of declared module names -> files, from one regex. */
function declarations(p: Project, files: Source[], re: RegExp, group = 1): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const f of files) for (const m of p.code(f).matchAll(re)) index.set(m[group], [...(index.get(m[group]) ?? []), f.id]);
  return index;
}

/** A path next to the importing file, else from the project root, else a unique suffix match. */
function literalPath(p: Project, from: string, rel: string): string | null {
  return p.first([joinPath(dirname(from), rel), joinPath("", rel)]) ?? closest(from, p.bySuffix(rel.replace(/^(\.\.?\/)+/, "")));
}

export function misc(p: Project): Edge[] {
  const edges = new EdgeSet();

  for (const f of p.of("lua")) {
    for (const m of p.code(f).matchAll(/\brequire\s*\(?\s*['"]([\w./-]+)['"]/g)) {
      const path = m[1].replace(/\./g, "/");
      edges.add(f.id, closest(f.id, [...p.bySuffix(`${path}.lua`), ...p.bySuffix(`${path}/init.lua`)]));
    }
  }

  const ex = p.of("elixir");
  const exMods = declarations(p, ex, /\bdefmodule\s+([A-Z][\w.]*)/g);
  for (const f of ex) {
    const code = p.bare(f);
    const aliases = new Map<string, string>();
    for (const m of code.matchAll(/\balias\s+([A-Z][\w.]*)(?:\.\{([^}]*)\})?(?:\s*,\s*as:\s*([A-Z]\w*))?/g)) {
      if (m[2]) for (const s of m[2].split(",")) aliases.set(s.trim(), `${m[1]}.${s.trim()}`);
      else aliases.set(m[3] ?? m[1].split(".").pop()!, m[1]);
    }
    for (const m of code.matchAll(/\b([A-Z]\w*(?:\.[A-Z]\w*)*)/g)) {
      const [head, ...rest] = m[1].split(".");
      const full = [aliases.get(head) ?? head, ...rest].join(".").split(".");
      for (let k = full.length; k > 0; k--) {
        const hit = exMods.get(full.slice(0, k).join("."));
        if (hit) {
          hit.forEach((t) => edges.add(f.id, t));
          break;
        }
      }
    }
  }

  const erl = p.of("erlang");
  const erlMods = declarations(p, erl, /^-module\(\s*(\w+)\s*\)/gm);
  for (const f of erl) {
    for (const m of p.code(f).matchAll(/^-include(?:_lib)?\(\s*"([^"]+)"\s*\)/gm)) edges.add(f.id, literalPath(p, f.id, m[1]));
    for (const m of p.bare(f).matchAll(/\b([a-z]\w*):[a-z]\w*\s*\(/g)) erlMods.get(m[1])?.forEach((t) => edges.add(f.id, t));
  }

  for (const lang of ["haskell", "elm"] as const) {
    const files = p.of(lang);
    const mods = declarations(p, files, /^(?:port\s+)?module\s+([A-Z][\w.]*)/gm);
    const ext = lang === "haskell" ? ["hs", "lhs"] : ["elm"];
    for (const f of files) {
      for (const m of p.code(f).matchAll(/^import\s+(?:qualified\s+)?([A-Z][\w.]*)/gm)) {
        const declared = mods.get(m[1]);
        edges.add(f.id, declared ? closest(f.id, declared) : closest(f.id, ext.flatMap((e) => p.bySuffix(`${m[1].replace(/\./g, "/")}.${e}`))));
      }
    }
  }

  const clj = p.of("clojure");
  const cljNs = declarations(p, clj, /\(\s*ns\s+([\w.*+!?<>=-]+)/g);
  for (const f of clj) {
    for (const m of p.bare(f).matchAll(/[\w*+!?<>=-]+(?:\.[\w*+!?<>=-]+)+/g)) cljNs.get(m[0])?.forEach((t) => edges.add(f.id, t));
  }

  const perl = p.of("perl");
  const pkgs = declarations(p, perl, /^\s*package\s+([\w:]+)/gm);
  for (const f of perl) {
    for (const m of p.code(f).matchAll(/^\s*(?:use|require)\s+([A-Z][\w:]*)/gm)) {
      edges.add(f.id, closest(f.id, pkgs.get(m[1]) ?? p.bySuffix(`${m[1].replace(/::/g, "/")}.pm`)));
    }
  }

  for (const f of p.of("r")) for (const m of p.code(f).matchAll(/\bsource\s*\(\s*['"]([^'"]+)['"]/g)) edges.add(f.id, literalPath(p, f.id, m[1]));
  for (const f of p.of("julia")) for (const m of p.code(f).matchAll(/\binclude\s*\(\s*"([^"]+)"\s*\)/g)) edges.add(f.id, literalPath(p, f.id, m[1]));
  for (const f of p.of("zig")) for (const m of p.code(f).matchAll(/@import\(\s*"([^"]+\.zig)"\s*\)/g)) edges.add(f.id, literalPath(p, f.id, m[1]));
  for (const f of p.of("shell")) {
    for (const m of p.code(f).matchAll(/^\s*(?:source|\.)\s+['"]?([\w./-]+)['"]?/gm)) edges.add(f.id, literalPath(p, f.id, m[1]));
  }
  return edges.list;
}
