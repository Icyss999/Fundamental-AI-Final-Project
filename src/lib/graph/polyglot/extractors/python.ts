/**
 * Python: `import a.b`, `from a.b import c`, `from . import x`, `from ..pkg import y`.
 * A file's importable name starts at the first folder above it that is not a package (has no
 * __init__.py); names relative to the project root and to src/ are indexed too, for layouts
 * that run from there.
 */

import { closest, dirname, EdgeSet, type Edge, type Project, type Source } from "../project";

function moduleNames(p: Project, id: string): string[] {
  const noExt = id.replace(/\.pyi?$/, "");
  const parts = noExt.split("/");
  if (parts[parts.length - 1] === "__init__") parts.pop();
  if (parts.length === 0) return [];
  // Climb while the containing folder is a package.
  let start = parts.length - 1;
  while (start > 0 && p.has(`${parts.slice(0, start).join("/")}/__init__.py`)) start--;
  const names = new Set([parts.slice(start).join("."), parts.join(".")]);
  if (parts[0] === "src" && parts.length > 1) names.add(parts.slice(1).join("."));
  return [...names];
}

export function python(p: Project): Edge[] {
  const files = p.of("python");
  const index = new Map<string, string[]>();
  for (const f of files) for (const name of moduleNames(p, f.id)) index.set(name, [...(index.get(name) ?? []), f.id]);
  const edges = new EdgeSet();
  const lookup = (from: string, name: string) => closest(from, index.get(name) ?? []);

  /** The package folder a relative import starts from: `.` = the file's package, `..` its parent... */
  const relativeBase = (f: Source, dots: number) => {
    let dir = dirname(f.id);
    for (let i = 1; i < dots; i++) dir = dirname(dir);
    return dir;
  };
  const fileFor = (dir: string, dotted: string) => {
    const path = [dir, ...dotted.split(".").filter(Boolean)].filter(Boolean).join("/");
    return p.first([`${path}.py`, `${path}.pyi`, `${path}/__init__.py`, `${path}/__init__.pyi`]);
  };

  for (const f of files) {
    // Join parenthesised and backslash-continued import lists onto one line.
    const code = p
      .bare(f)
      .replace(/\(([^()]*)\)/g, (_, inner: string) => `(${inner.replace(/\n/g, " ")})`)
      .replace(/\\\n/g, " ");

    for (const m of code.matchAll(/^[ \t]*import[ \t]+([^\n]+)/gm)) {
      for (const part of m[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        // The most specific module that exists: a.b.c, else a.b, else a.
        const segs = name.split(".");
        for (let k = segs.length; k > 0; k--) {
          const hit = lookup(f.id, segs.slice(0, k).join("."));
          if (hit) {
            edges.add(f.id, hit);
            break;
          }
        }
      }
    }

    for (const m of code.matchAll(/^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+\(?([^\n)]+)\)?/gm)) {
      const dots = m[1].length;
      const mod = m[2];
      const names = m[3].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter((s) => s && s !== "*");
      if (dots > 0) {
        const base = relativeBase(f, dots);
        let any = false;
        for (const n of names) {
          const sub = fileFor(base, mod ? `${mod}.${n}` : n);
          if (sub) {
            edges.add(f.id, sub);
            any = true;
          }
        }
        if (!any || mod) edges.add(f.id, fileFor(base, mod));
        continue;
      }
      let any = false;
      for (const n of names) {
        const sub = lookup(f.id, `${mod}.${n}`);
        if (sub) {
          edges.add(f.id, sub);
          any = true;
        }
      }
      if (!any) {
        const segs = mod.split(".");
        for (let k = segs.length; k > 0; k--) {
          const hit = lookup(f.id, segs.slice(0, k).join("."));
          if (hit) {
            edges.add(f.id, hit);
            break;
          }
        }
      }
    }
  }
  return edges.list;
}
