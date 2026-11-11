/**
 * C, C++, Objective-C, CUDA: `#include "x.h"`, `#include <lib/x.h>`, `#import`. Quoted includes
 * resolve next to the file first; both forms then try common include roots and finally a unique
 * path-suffix match (system headers match no project file, so they drop out).
 */

import { closest, dirname, EdgeSet, joinPath, type Edge, type Project } from "../project";

const INCLUDE_ROOTS = ["include", "inc", "src", "lib", "source", "Sources", "headers", ""];

export function cfamily(p: Project): Edge[] {
  const files = p.of("c", "cpp", "objc");
  const edges = new EdgeSet();
  for (const f of files) {
    for (const m of p.code(f).matchAll(/^[ \t]*#[ \t]*(?:include|import|include_next)[ \t]*([<"])([^>"\n]+)[>"]/gm)) {
      const target = m[2].trim();
      const local = m[1] === '"' ? joinPath(dirname(f.id), target) : null;
      const rooted = INCLUDE_ROOTS.map((r) => joinPath(r, target));
      const hit = p.first([local, ...rooted]) ?? closest(f.id, p.bySuffix(target).filter((c) => p.sources.has(c)));
      edges.add(f.id, hit);
    }
  }
  return edges.list;
}
