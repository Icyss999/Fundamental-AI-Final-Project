/**
 * Dart: `import`/`export`/`part` of relative paths and `package:<name>/path.dart`, where <name>
 * is a package in this project (pubspec.yaml `name:`) whose code lives in lib/.
 */

import { basename, dirname, EdgeSet, joinPath, type Edge, type Project } from "../project";

export function dart(p: Project): Edge[] {
  const files = p.of("dart");
  const packages = new Map<string, string>();
  for (const [file, text] of p.manifests) {
    if (basename(file) !== "pubspec.yaml") continue;
    const name = text.match(/^name:\s*([\w-]+)/m)?.[1];
    if (name) packages.set(name, joinPath(dirname(file), "lib") ?? "lib");
  }
  const edges = new EdgeSet();
  for (const f of files) {
    for (const m of p.code(f).matchAll(/^\s*(?:import|export|part)\s+['"]([^'"]+)['"]/gm)) {
      const uri = m[1];
      if (uri.startsWith("dart:")) continue;
      const pkg = uri.match(/^package:([\w-]+)\/(.+)$/);
      if (pkg) {
        const lib = packages.get(pkg[1]);
        if (lib !== undefined) edges.add(f.id, p.first([joinPath(lib, pkg[2])]));
      } else edges.add(f.id, p.first([joinPath(dirname(f.id), uri)]));
    }
  }
  return edges.list;
}
