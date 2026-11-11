/**
 * C#: types live in namespaces; a file sees its own namespace (and its parents), the namespaces
 * it (or any file, with `global using`) imports, `using static` types and `using X = A.B.C`
 * aliases. A file depends on the files declaring the visible types it names.
 */

import { EdgeSet, type Edge, type Project } from "../project";

export function csharp(p: Project): Edge[] {
  const files = p.of("csharp");
  const typesByNs = new Map<string, Map<string, string[]>>();
  const nsOf = new Map<string, string>();
  const globalUsings = new Set<string>();

  for (const f of files) {
    const code = p.bare(f);
    const ns = p.code(f).match(/^\s*namespace\s+([\w.]+)/m)?.[1] ?? "";
    nsOf.set(f.id, ns);
    const types = typesByNs.get(ns) ?? new Map<string, string[]>();
    for (const m of code.matchAll(/\b(?:class|interface|struct|enum|record(?:\s+(?:class|struct))?)\s+([A-Za-z_]\w*)/g)) {
      types.set(m[1], [...(types.get(m[1]) ?? []), f.id]);
    }
    for (const m of code.matchAll(/\bdelegate\s+[\w<>,.?\[\]\s]+?\s+([A-Za-z_]\w*)\s*[<(]/g)) types.set(m[1], [...(types.get(m[1]) ?? []), f.id]);
    typesByNs.set(ns, types);
    for (const m of p.code(f).matchAll(/^\s*global\s+using\s+(?!static\b)([\w.]+)\s*;/gm)) globalUsings.add(m[1]);
  }

  const edges = new EdgeSet();
  for (const f of files) {
    const code = p.code(f);
    const visible = new Set<string>(globalUsings);
    const ns = nsOf.get(f.id)!;
    const parts = ns ? ns.split(".") : [];
    for (let k = 0; k <= parts.length; k++) visible.add(parts.slice(0, k).join("."));
    const direct: [string, string][] = [];
    for (const m of code.matchAll(/^\s*(?:global\s+)?using\s+(static\s+)?(?:(\w+)\s*=\s*)?([\w.]+)\s*;/gm)) {
      if (m[1] || m[2]) {
        const i = m[3].lastIndexOf(".");
        direct.push([m[3].slice(0, i), m[3].slice(i + 1)]);
      } else visible.add(m[3]);
    }
    for (const [space, type] of direct) for (const t of typesByNs.get(space)?.get(type) ?? []) edges.add(f.id, t);

    const ids = p.identifiers(f);
    for (const space of visible) {
      for (const [type, declaredIn] of typesByNs.get(space) ?? []) {
        if (ids.has(type)) for (const t of declaredIn) edges.add(f.id, t);
      }
    }
  }
  return edges.list;
}
