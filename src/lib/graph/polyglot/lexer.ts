/**
 * Just enough lexing to read imports in any language: strip comments (keeping strings, so import
 * paths survive), blank string contents (so `import x` inside a docstring is not an import), and
 * collect identifiers. Newlines are always kept, so line-anchored regexes still work.
 */

export interface Syntax {
  /** Line comment openers, e.g. "//" or "#". */
  line?: string[];
  /** Block comments [open, close]. */
  block?: [string, string][];
  /** Block comments may nest (Swift, Rust, Haskell). */
  nested?: boolean;
  /** String delimiters, longest first matters only for triple quotes (handled automatically). */
  quotes?: string[];
}

export const C_LIKE: Syntax = { line: ["//"], block: [["/*", "*/"]], quotes: ['"', "'", "`"] };
export const HASH: Syntax = { line: ["#"], quotes: ['"', "'"] };

/**
 * One pass over the text: comments become spaces (newlines kept); strings are copied as they are,
 * or with their contents blanked when `blankStrings` is set.
 */
export function scrub(text: string, syntax: Syntax, blankStrings = false): string {
  const line = syntax.line ?? [];
  const block = syntax.block ?? [];
  const quotes = [...(syntax.quotes ?? [])].sort((a, b) => b.length - a.length);
  const out: string[] = [];
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  let i = 0;
  const n = text.length;
  outer: while (i < n) {
    for (const open of line) {
      if (text.startsWith(open, i)) {
        const end = text.indexOf("\n", i);
        const stop = end === -1 ? n : end;
        out.push(" ".repeat(stop - i));
        i = stop;
        continue outer;
      }
    }
    for (const [open, close] of block) {
      if (text.startsWith(open, i)) {
        let depth = 1;
        let j = i + open.length;
        while (j < n && depth > 0) {
          if (syntax.nested && text.startsWith(open, j)) {
            depth++;
            j += open.length;
          } else if (text.startsWith(close, j)) {
            depth--;
            j += close.length;
          } else j++;
        }
        out.push(blank(text.slice(i, j)));
        i = j;
        continue outer;
      }
    }
    for (const q of quotes) {
      if (text.startsWith(q, i)) {
        // Triple-quoted strings run to the matching triple; others stop at an unescaped quote or a newline.
        const triple = q.length === 3;
        let j = i + q.length;
        while (j < n) {
          if (text[j] === "\\" && !triple) {
            j += 2;
            continue;
          }
          if (text.startsWith(q, j)) break;
          if (!triple && q !== "`" && text[j] === "\n") break;
          j++;
        }
        const closed = j < n && text.startsWith(q, j);
        const end = closed ? j + q.length : Math.min(j, n);
        out.push(blankStrings ? q + blank(text.slice(i + q.length, Math.min(j, n))) + (closed ? q : "") : text.slice(i, end));
        i = end;
        continue outer;
      }
    }
    out.push(text[i]);
    i++;
  }
  return out.join("");
}

/** Identifiers in code (call on scrubbed text with strings blanked). */
export function identifiers(code: string): Set<string> {
  return new Set(code.match(/[A-Za-z_$][\w$]*/g) ?? []);
}
