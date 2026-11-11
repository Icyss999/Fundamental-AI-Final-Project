/**
 * Go: a package is a folder, imported by module path (go.mod `module` + folder). To keep edges
 * file-level, `pkg.Ident` in the importer points at the file that declares `Ident`; files of one
 * package see each other's top-level names without importing, so those count too.
 */

import { basename, dirname, EdgeSet, joinPath, type Edge, type Project, type Source } from "../project";

const GO_KEYWORDS = new Set(["init", "main", "_"]);

function declarations(code: string): Set<string> {
  const names = new Set<string>();
  // Package-level funcs only: methods (`func (r T) Name`) are reached through a receiver.
  for (const m of code.matchAll(/^func\s+([A-Za-z_]\w*)/gm)) names.add(m[1]);
  for (const m of code.matchAll(/^(?:type|var|const)\s+([A-Za-z_]\w*)/gm)) names.add(m[1]);
  // Grouped declarations: type ( ... ), var ( ... ), const ( ... )
  for (const m of code.matchAll(/^(?:type|var|const)\s*\(([\s\S]*?)^\)/gm)) {
    for (const line of m[1].matchAll(/^\s+([A-Za-z_]\w*)/gm)) names.add(line[1]);
  }
  for (const k of GO_KEYWORDS) names.delete(k);
  return names;
}

export function go(p: Project): Edge[] {
  const files = p.of("go");
  if (files.length === 0) return [];
  const modules: { path: string; dir: string }[] = [];
  for (const [file, text] of p.manifests) {
    if (basename(file) !== "go.mod") continue;
    const m = text.match(/^\s*module\s+(\S+)/m);
    if (m) modules.push({ path: m[1].replace(/^"|"$/g, ""), dir: dirname(file) });
  }
  modules.sort((a, b) => b.path.length - a.path.length);

  const byDir = new Map<string, Source[]>();
  for (const f of files) byDir.set(dirname(f.id), [...(byDir.get(dirname(f.id)) ?? []), f]);
  const decl = new Map<string, Set<string>>();
  const pkgName = new Map<string, string>();
  for (const f of files) {
    const bare = p.bare(f);
    decl.set(f.id, declarations(bare));
    pkgName.set(f.id, p.code(f).match(/^\s*package\s+(\w+)/m)?.[1] ?? "");
  }
  const isTest = (id: string) => id.endsWith("_test.go");

  const dirFor = (importPath: string): string | null => {
    for (const m of modules) {
      if (importPath === m.path) return m.dir;
      if (importPath.startsWith(`${m.path}/`)) return joinPath(m.dir, importPath.slice(m.path.length + 1));
    }
    return null;
  };

  const edges = new EdgeSet();
  for (const f of files) {
    const code = p.code(f);
    const bare = p.bare(f);
    const imports: { alias: string | null; path: string }[] = [];
    for (const m of code.matchAll(/^\s*import\s+(?:([\w.]+)\s+)?"([^"]+)"/gm)) imports.push({ alias: m[1] ?? null, path: m[2] });
    for (const block of code.matchAll(/^\s*import\s*\(([\s\S]*?)\)/gm)) {
      for (const m of block[1].matchAll(/^\s*(?:([\w.]+)\s+)?"([^"]+)"/gm)) imports.push({ alias: m[1] ?? null, path: m[2] });
    }

    for (const imp of imports) {
      const dir = dirFor(imp.path);
      const targets = dir === null ? undefined : byDir.get(dir)?.filter((t) => !isTest(t.id));
      if (!targets || targets.length === 0) continue;
      const alias = imp.alias ?? pkgName.get(targets[0].id) ?? basename(imp.path);
      let hit = false;
      if (alias !== "_" && alias !== ".") {
        const used = new Set([...bare.matchAll(new RegExp(`\\b${alias.replace(/\W/g, "")}\\.([A-Z]\\w*)`, "g"))].map((m) => m[1]));
        for (const t of targets) {
          if ([...decl.get(t.id)!].some((n) => used.has(n))) {
            edges.add(f.id, t.id);
            hit = true;
          }
        }
      } else if (alias === ".") {
        const ids = p.identifiers(f);
        for (const t of targets) {
          if ([...decl.get(t.id)!].some((n) => ids.has(n))) {
            edges.add(f.id, t.id);
            hit = true;
          }
        }
      }
      // Blank imports (side effects) or nothing matched: depend on the package as a whole.
      if (!hit) for (const t of targets.slice(0, 8)) edges.add(f.id, t.id);
    }

    // Same package, other files: unqualified use of their top-level names.
    const ids = p.identifiers(f);
    for (const other of byDir.get(dirname(f.id)) ?? []) {
      if (other.id === f.id || pkgName.get(other.id) !== pkgName.get(f.id) || (isTest(other.id) && !isTest(f.id))) continue;
      if ([...decl.get(other.id)!].some((n) => n.length > 2 && ids.has(n))) edges.add(f.id, other.id);
    }
  }
  return edges.list;
}
