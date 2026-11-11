/** The in-memory project the language extractors read (pure, so they can be tested without a disk). */

import { identifiers, scrub } from "./lexer";
import { languageOf, type LangId } from "./languages";

export interface Source {
  id: string;
  lang: LangId;
  text: string;
}

export interface Edge {
  source: string;
  target: string;
}

export class Project {
  readonly sources = new Map<string, Source>();
  /** Every file path in the project (code or not), for resolving imports of non-code files' neighbours. */
  readonly paths: ReadonlySet<string>;
  private readonly byBase = new Map<string, string[]>();
  private readonly codeCache = new Map<string, string>();
  private readonly bareCache = new Map<string, string>();
  private readonly idCache = new Map<string, Set<string>>();

  constructor(
    sources: Iterable<Source>,
    paths: Iterable<string>,
    /** Build files the resolvers need (go.mod, Cargo.toml, composer.json, pubspec.yaml), by path. */
    readonly manifests: ReadonlyMap<string, string> = new Map(),
  ) {
    for (const s of sources) this.sources.set(s.id, s);
    this.paths = new Set([...paths, ...this.sources.keys()]);
    for (const p of this.paths) {
      const base = basename(p);
      this.byBase.set(base, [...(this.byBase.get(base) ?? []), p]);
    }
  }

  static fromFiles(files: Record<string, string>, manifests: Record<string, string> = {}): Project {
    const sources: Source[] = [];
    for (const [id, text] of Object.entries(files)) {
      const lang = languageOf(id);
      if (lang) sources.push({ id, lang: lang.id, text });
    }
    return new Project(sources, [...Object.keys(files), ...Object.keys(manifests)], new Map(Object.entries(manifests)));
  }

  of(...langs: LangId[]): Source[] {
    return [...this.sources.values()].filter((s) => langs.includes(s.lang));
  }

  has(path: string): boolean {
    return this.paths.has(path);
  }

  /** Comments removed, strings kept. */
  code(s: Source): string {
    let c = this.codeCache.get(s.id);
    if (c === undefined) {
      c = scrub(s.text, languageOf(s.id)!.syntax);
      this.codeCache.set(s.id, c);
    }
    return c;
  }

  /** Comments removed and string contents blanked. */
  bare(s: Source): string {
    let c = this.bareCache.get(s.id);
    if (c === undefined) {
      c = scrub(s.text, languageOf(s.id)!.syntax, true);
      this.bareCache.set(s.id, c);
    }
    return c;
  }

  identifiers(s: Source): Set<string> {
    let ids = this.idCache.get(s.id);
    if (!ids) {
      ids = identifiers(this.bare(s));
      this.idCache.set(s.id, ids);
    }
    return ids;
  }

  /** Paths equal to `suffix` or ending in "/" + suffix. */
  bySuffix(suffix: string): string[] {
    const clean = suffix.replace(/^\/+/, "");
    return (this.byBase.get(basename(clean)) ?? []).filter((p) => p === clean || p.endsWith(`/${clean}`));
  }

  /** The first candidate path that exists. */
  first(candidates: Iterable<string | null>): string | null {
    for (const c of candidates) if (c && this.paths.has(c)) return c;
    return null;
  }
}

export function basename(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

export function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

/** Joins and normalises a relative path; null if it climbs out of the project. */
export function joinPath(dir: string, rel: string): string | null {
  const parts = dir ? dir.split("/") : [];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

/** Of several matches, the one closest to `from` (longest shared folder prefix), then the shortest. */
export function closest(from: string, candidates: readonly string[]): string | null {
  if (candidates.length === 0) return null;
  const shared = (a: string) => {
    const x = dirname(from).split("/");
    const y = a.split("/");
    let k = 0;
    while (k < x.length && k < y.length && x[k] === y[k]) k++;
    return k;
  };
  return [...candidates].sort((a, b) => shared(b) - shared(a) || a.length - b.length || a.localeCompare(b))[0];
}

/** Collects edges, dropping self-imports and duplicates. */
export class EdgeSet {
  private readonly keys = new Set<string>();
  readonly list: Edge[] = [];

  add(source: string, target: string | null | undefined) {
    if (!target || target === source) return;
    const key = `${source}\0${target}`;
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.list.push({ source, target });
  }
}

/** Line-anchored matches of `re` (global, multiline) in `code`, as capture arrays. */
export function matches(code: string, re: RegExp): RegExpExecArray[] {
  return [...code.matchAll(re)];
}
