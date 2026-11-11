/**
 * Swift: files of one module see each other without imports, so a file depends on the files
 * declaring the types it names (an `extension X` depends on X's declaration). Swift Package
 * Manager targets (Sources/<Target>/) are separate modules: names resolve inside the target first,
 * then in targets it imports.
 */

import { EdgeSet, type Edge, type Project } from "../project";

const targetOf = (id: string) => id.match(/(?:^|\/)(?:Sources|Tests)\/([^/]+)\//)?.[1] ?? "";

export function swift(p: Project): Edge[] {
  const files = p.of("swift");
  const declared = new Map<string, Map<string, string[]>>();
  for (const f of files) {
    const t = targetOf(f.id);
    const types = declared.get(t) ?? new Map<string, string[]>();
    for (const m of p.bare(f).matchAll(/\b(?:class|struct|enum|protocol|actor|typealias)\s+([A-Z_]\w*)/g)) {
      types.set(m[1], [...(types.get(m[1]) ?? []), f.id]);
    }
    declared.set(t, types);
  }

  const edges = new EdgeSet();
  for (const f of files) {
    const t = targetOf(f.id);
    const scopes = new Set([t]);
    for (const m of p.code(f).matchAll(/^\s*(?:@testable\s+)?import\s+(\w+)/gm)) if (declared.has(m[1])) scopes.add(m[1]);
    // Tests/<Name>Tests usually test Sources/<Name>.
    if (/(?:^|\/)Tests\//.test(f.id) && declared.has(t.replace(/Tests$/, ""))) scopes.add(t.replace(/Tests$/, ""));
    const ids = p.identifiers(f);
    for (const scope of scopes) {
      for (const [type, files2] of declared.get(scope) ?? []) {
        if (ids.has(type)) for (const d of files2) edges.add(f.id, d);
      }
    }
  }
  return edges.list;
}
