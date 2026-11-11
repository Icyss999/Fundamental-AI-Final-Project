/**
 * PHP: `namespace App\X;` + declared classes give fully-qualified names; `use A\B\C;`,
 * `use A\B\{C, D}`, inline `\A\B\C`, same-namespace class names, PSR-4 autoload paths from
 * composer.json, and `require`/`include` of literal paths.
 */

import { basename, closest, dirname, EdgeSet, joinPath, type Edge, type Project } from "../project";

export function php(p: Project): Edge[] {
  const files = p.of("php");
  if (files.length === 0) return [];
  const fqn = new Map<string, string[]>();
  const nsOf = new Map<string, string>();
  const byNs = new Map<string, Map<string, string>>();
  for (const f of files) {
    const ns = p.code(f).match(/^\s*namespace\s+([\w\\]+)\s*[;{]/m)?.[1] ?? "";
    nsOf.set(f.id, ns);
    const local = byNs.get(ns) ?? new Map<string, string>();
    for (const m of p.bare(f).matchAll(/\b(?:class|interface|trait|enum)\s+([A-Za-z_]\w*)/g)) {
      const name = ns ? `${ns}\\${m[1]}` : m[1];
      fqn.set(name.toLowerCase(), [...(fqn.get(name.toLowerCase()) ?? []), f.id]);
      local.set(m[1], f.id);
    }
    byNs.set(ns, local);
  }
  // PSR-4: "App\\": "app/" -> App\Models\User lives in app/Models/User.php.
  const psr4: [string, string][] = [];
  for (const [file, text] of p.manifests) {
    if (basename(file) !== "composer.json") continue;
    try {
      const json = JSON.parse(text) as { autoload?: { "psr-4"?: Record<string, string | string[]> }; "autoload-dev"?: { "psr-4"?: Record<string, string | string[]> } };
      for (const map of [json.autoload?.["psr-4"], json["autoload-dev"]?.["psr-4"]]) {
        for (const [prefix, dirs] of Object.entries(map ?? {})) for (const d of [dirs].flat()) psr4.push([prefix, joinPath(dirname(file), d) ?? ""]);
      }
    } catch {
      // not JSON: skip
    }
  }

  const resolve = (from: string, name: string): string | null => {
    const clean = name.replace(/^\\/, "");
    const known = closest(from, fqn.get(clean.toLowerCase()) ?? []);
    if (known) return known;
    for (const [prefix, dir] of psr4) {
      if (clean.startsWith(prefix)) {
        const hit = p.first([joinPath(dir, `${clean.slice(prefix.length).replace(/\\/g, "/")}.php`)]);
        if (hit) return hit;
      }
    }
    return closest(from, p.bySuffix(`${clean.replace(/\\/g, "/")}.php`));
  };

  const edges = new EdgeSet();
  for (const f of files) {
    const code = p.code(f);
    for (const m of code.matchAll(/^\s*use\s+(?:function\s+|const\s+)?([^;]+);/gm)) {
      const body = m[1].trim();
      const group = body.match(/^([\w\\]+)\\\{([^}]*)\}$/);
      const names = group ? group[2].split(",").map((s) => `${group[1]}\\${s.trim().split(/\s+as\s+/i)[0]}`) : body.split(",").map((s) => s.trim().split(/\s+as\s+/i)[0]);
      for (const n of names) edges.add(f.id, resolve(f.id, n));
    }
    for (const m of p.bare(f).matchAll(/(?<![\w\\])\\?([A-Z]\w*(?:\\[A-Z]\w*)+)/g)) edges.add(f.id, resolve(f.id, m[1]));
    const local = byNs.get(nsOf.get(f.id)!);
    if (local) {
      const ids = p.identifiers(f);
      for (const [cls, file] of local) if (ids.has(cls)) edges.add(f.id, file);
    }
    // `require __DIR__ . '/x.php'` and `require 'x.php'`: next to the file, then from the root.
    for (const m of code.matchAll(/\b(?:require|include)(?:_once)?\s*\(?\s*(?:__DIR__\s*\.\s*)?['"]([^'"]+\.php)['"]/g)) {
      const rel = m[1].replace(/^\/+/, "");
      edges.add(f.id, p.first([joinPath(dirname(f.id), rel), rel]) ?? closest(f.id, p.bySuffix(rel)));
    }
  }
  return edges.list;
}
