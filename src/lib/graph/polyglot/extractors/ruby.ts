/**
 * Ruby: `require_relative`, `require`/`load` of project files, and — since Rails autoloads —
 * constants: a file depends on the files that declare (`class`/`module`) the constants it names.
 */

import { closest, dirname, EdgeSet, joinPath, type Edge, type Project } from "../project";

/** Core and framework constants a project may reopen; linking every use to the reopening file is noise. */
const COMMON = new Set(["String", "Array", "Hash", "Integer", "Float", "Object", "Module", "Class", "Kernel", "Time", "Date", "DateTime", "File", "Dir", "IO", "Struct", "Exception", "StandardError", "Comparable", "Enumerable", "Rails", "ActiveRecord", "ActiveSupport", "ApplicationRecord", "ApplicationController"]);

export function ruby(p: Project): Edge[] {
  const files = p.of("ruby");
  const declared = new Map<string, string[]>();
  for (const f of files) {
    for (const m of p.bare(f).matchAll(/^\s*(?:class|module)\s+([A-Z][\w:]*)/gm)) {
      for (const name of new Set([m[1], m[1].split("::").pop()!])) {
        if (!COMMON.has(name)) declared.set(name, [...(declared.get(name) ?? []), f.id]);
      }
    }
  }
  const edges = new EdgeSet();
  for (const f of files) {
    const code = p.code(f);
    for (const m of code.matchAll(/\brequire_relative\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const base = joinPath(dirname(f.id), m[1]);
      edges.add(f.id, p.first([base?.endsWith(".rb") ? base : `${base}.rb`]));
    }
    for (const m of code.matchAll(/\b(?:require|load)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const rel = m[1].endsWith(".rb") ? m[1] : `${m[1]}.rb`;
      edges.add(f.id, p.first([joinPath("lib", rel), joinPath("app", rel), rel]) ?? closest(f.id, p.bySuffix(rel)));
    }
    for (const m of p.bare(f).matchAll(/\b([A-Z]\w*(?:::[A-Z]\w*)*)/g)) {
      const name = m[1];
      const hits = declared.get(name) ?? declared.get(name.split("::").pop()!);
      if (hits && hits.length <= 3) hits.forEach((t) => edges.add(f.id, t));
    }
  }
  return edges.list;
}
