/**
 * Java, Kotlin, Scala, Groovy: `package a.b`, `import a.b.C`, `import a.b.*` / `a.b._`,
 * `import static a.b.C.m`, Scala `import a.b.{C, D => E}`. Classes in the same package need no
 * import, so a file also depends on same-package files whose declared types it names.
 */

import { basename, closest, EdgeSet, type Edge, type Project } from "../project";

const DECLARATION = /\b(?:class|interface|enum|record|object|trait|@interface|typealias)\s+([A-Z_$][\w$]*)/g;
/** Top-level functions and properties (Kotlin/Scala/Groovy), imported by name. */
const TOP_LEVEL = /^(?:(?:private|internal|public|inline|suspend|operator|infix|tailrec|const|lazy|implicit|final)\s+)*(?:fun|def|val|var)\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?([A-Za-z_$][\w$]*)/gm;

export function jvm(p: Project): Edge[] {
  const files = p.of("java", "kotlin", "scala", "groovy");
  const fqn = new Map<string, string[]>();
  const byPackage = new Map<string, string[]>();
  const declared = new Map<string, Set<string>>();
  const packageOf = new Map<string, string>();

  for (const f of files) {
    const code = p.bare(f);
    const pkg = [...p.code(f).matchAll(/^\s*package\s+([\w.]+)/gm)].map((m) => m[1]).join(".");
    packageOf.set(f.id, pkg);
    byPackage.set(pkg, [...(byPackage.get(pkg) ?? []), f.id]);
    const names = new Set<string>([basename(f.id).replace(/\.\w+$/, "")]);
    for (const m of code.matchAll(DECLARATION)) names.add(m[1]);
    for (const m of code.matchAll(TOP_LEVEL)) names.add(m[1]);
    declared.set(f.id, names);
    for (const n of names) {
      const key = pkg ? `${pkg}.${n}` : n;
      fqn.set(key, [...(fqn.get(key) ?? []), f.id]);
    }
  }

  const edges = new EdgeSet();
  for (const f of files) {
    const code = p.code(f);
    for (const m of code.matchAll(/^\s*import\s+(?:static\s+)?([\w.]+?)(\.\*|\._|\.\{([^}]*)\})?\s*(?:;|$|\s+as\s)/gm)) {
      const base = m[1];
      if (m[2] === ".*" || m[2] === "._") {
        // A whole package (or all members of a class).
        const pkgFiles = byPackage.get(base);
        if (pkgFiles) pkgFiles.forEach((t) => edges.add(f.id, t));
        else edges.add(f.id, closest(f.id, fqn.get(base) ?? []));
        continue;
      }
      const names = m[3] ? m[3].split(",").map((s) => s.trim().split(/\s*=>\s*/)[0]).filter(Boolean).map((s) => `${base}.${s}`) : [base];
      for (const name of names) {
        // a.b.C, or a.b.C.member / a.b.C.Nested: the longest prefix that names a declaration.
        const segs = name.split(".");
        for (let k = segs.length; k > 0; k--) {
          const hit = closest(f.id, fqn.get(segs.slice(0, k).join(".")) ?? []);
          if (hit) {
            edges.add(f.id, hit);
            break;
          }
        }
      }
    }
    // Same package: types used without an import.
    const ids = p.identifiers(f);
    for (const other of byPackage.get(packageOf.get(f.id)!) ?? []) {
      if (other === f.id) continue;
      for (const n of declared.get(other)!) {
        if (/^[A-Z]/.test(n) && ids.has(n)) {
          edges.add(f.id, other);
          break;
        }
      }
    }
  }
  return edges.list;
}
