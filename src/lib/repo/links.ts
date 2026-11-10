import { ROOT_MODULE } from "@/lib/graph/partition";
import type { ProjectSource } from "./overview";

/**
 * Link to a file ("blob") or folder ("tree") on GitHub, pinned to the analysed commit so it shows
 * exactly the code that was mapped. `path` is relative to the analysed folder. Null for non-GitHub sources.
 * (Kept free of Node imports so client components can use it.)
 */
export function githubLink(source: ProjectSource, path: string, kind: "blob" | "tree"): string | null {
  if (source.kind !== "github") return null;
  const full = [source.subdir, path].filter(Boolean).join("/");
  const encoded = full.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `${source.url}/${kind}/${source.commit}${encoded ? `/${encoded}` : ""}`;
}

/** Folder link for a module id (the root module maps to the analysed folder itself). */
export function githubModuleLink(source: ProjectSource, module: string): string | null {
  return githubLink(source, module === ROOT_MODULE ? "" : module, "tree");
}
