/** Languages the mapper reads, by file extension (client-safe: the Overview uses the names). */

import { C_LIKE, HASH, type Syntax } from "./lexer";

export type LangId =
  | "javascript"
  | "typescript"
  | "python"
  | "java"
  | "kotlin"
  | "scala"
  | "groovy"
  | "go"
  | "rust"
  | "c"
  | "cpp"
  | "objc"
  | "csharp"
  | "php"
  | "ruby"
  | "swift"
  | "dart"
  | "vue"
  | "svelte"
  | "astro"
  | "lua"
  | "elixir"
  | "erlang"
  | "haskell"
  | "elm"
  | "clojure"
  | "perl"
  | "r"
  | "julia"
  | "shell"
  | "zig";

export interface Language {
  id: LangId;
  name: string;
  extensions: string[];
  syntax: Syntax;
}

const HTML_LIKE: Syntax = { block: [["<!--", "-->"]], quotes: ['"', "'"] };

export const LANGUAGES: Language[] = [
  { id: "typescript", name: "TypeScript", extensions: ["ts", "tsx", "mts", "cts"], syntax: C_LIKE },
  { id: "javascript", name: "JavaScript", extensions: ["js", "jsx", "mjs", "cjs"], syntax: C_LIKE },
  { id: "python", name: "Python", extensions: ["py", "pyi"], syntax: { line: ["#"], quotes: ['"""', "'''", '"', "'"] } },
  { id: "java", name: "Java", extensions: ["java"], syntax: { ...C_LIKE, quotes: ['"""', '"', "'"] } },
  { id: "kotlin", name: "Kotlin", extensions: ["kt", "kts"], syntax: { ...C_LIKE, nested: true, quotes: ['"""', '"', "'"] } },
  { id: "scala", name: "Scala", extensions: ["scala", "sc"], syntax: { ...C_LIKE, nested: true, quotes: ['"""', '"'] } },
  { id: "groovy", name: "Groovy", extensions: ["groovy", "gvy"], syntax: { ...C_LIKE, quotes: ['"""', "'''", '"', "'"] } },
  { id: "go", name: "Go", extensions: ["go"], syntax: { ...C_LIKE, quotes: ['"', "`", "'"] } },
  { id: "rust", name: "Rust", extensions: ["rs"], syntax: { line: ["//"], block: [["/*", "*/"]], nested: true, quotes: ['"'] } },
  { id: "c", name: "C", extensions: ["c", "h"], syntax: { ...C_LIKE, quotes: ['"', "'"] } },
  { id: "cpp", name: "C++", extensions: ["cc", "cpp", "cxx", "c++", "hpp", "hh", "hxx", "h++", "ipp", "tpp", "inl", "cu", "cuh", "ino"], syntax: { ...C_LIKE, quotes: ['"', "'"] } },
  { id: "objc", name: "Objective-C", extensions: ["m", "mm"], syntax: { ...C_LIKE, quotes: ['"', "'"] } },
  { id: "csharp", name: "C#", extensions: ["cs"], syntax: { ...C_LIKE, quotes: ['"""', '"', "'"] } },
  { id: "php", name: "PHP", extensions: ["php"], syntax: { line: ["//", "#"], block: [["/*", "*/"]], quotes: ['"', "'"] } },
  { id: "ruby", name: "Ruby", extensions: ["rb", "rake"], syntax: { line: ["#"], block: [["=begin", "=end"]], quotes: ['"', "'"] } },
  { id: "swift", name: "Swift", extensions: ["swift"], syntax: { ...C_LIKE, nested: true, quotes: ['"""', '"'] } },
  { id: "dart", name: "Dart", extensions: ["dart"], syntax: { ...C_LIKE, quotes: ['"""', "'''", '"', "'"] } },
  { id: "vue", name: "Vue", extensions: ["vue"], syntax: HTML_LIKE },
  { id: "svelte", name: "Svelte", extensions: ["svelte"], syntax: HTML_LIKE },
  { id: "astro", name: "Astro", extensions: ["astro"], syntax: HTML_LIKE },
  { id: "lua", name: "Lua", extensions: ["lua"], syntax: { line: ["--"], block: [["--[[", "]]"]], quotes: ['"', "'"] } },
  { id: "elixir", name: "Elixir", extensions: ["ex", "exs"], syntax: { line: ["#"], quotes: ['"""', '"'] } },
  { id: "erlang", name: "Erlang", extensions: ["erl", "hrl"], syntax: { line: ["%"], quotes: ['"'] } },
  { id: "haskell", name: "Haskell", extensions: ["hs", "lhs"], syntax: { line: ["--"], block: [["{-", "-}"]], nested: true, quotes: ['"'] } },
  { id: "elm", name: "Elm", extensions: ["elm"], syntax: { line: ["--"], block: [["{-", "-}"]], nested: true, quotes: ['"""', '"'] } },
  { id: "clojure", name: "Clojure", extensions: ["clj", "cljs", "cljc"], syntax: { line: [";"], quotes: ['"'] } },
  { id: "perl", name: "Perl", extensions: ["pl", "pm"], syntax: HASH },
  { id: "r", name: "R", extensions: ["r", "R"], syntax: HASH },
  { id: "julia", name: "Julia", extensions: ["jl"], syntax: { line: ["#"], block: [["#=", "=#"]], nested: true, quotes: ['"""', '"'] } },
  { id: "shell", name: "Shell", extensions: ["sh", "bash", "zsh"], syntax: HASH },
  { id: "zig", name: "Zig", extensions: ["zig"], syntax: { line: ["//"], quotes: ['"'] } },
];

const BY_EXTENSION = new Map(LANGUAGES.flatMap((l) => l.extensions.map((e) => [e, l] as const)));

/** The language of a path, from its extension; null for files that are not code we read. */
export function languageOf(path: string): Language | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1);
  return BY_EXTENSION.get(ext) ?? BY_EXTENSION.get(ext.toLowerCase()) ?? null;
}

/** Display name for the language breakdown ("TSX"/"JSX" kept apart, as before). */
export function languageName(path: string): string {
  if (/\.tsx$/.test(path)) return "TSX";
  if (/\.jsx$/.test(path)) return "JSX";
  return languageOf(path)?.name ?? "Other";
}

export const isJsTs = (path: string) => /\.[cm]?[jt]sx?$/.test(path);
