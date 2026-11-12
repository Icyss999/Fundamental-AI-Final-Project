"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "@/components/app/ui";

/**
 * The subset of Markdown the assistant writes: paragraphs, headings, lists (one nesting level),
 * code blocks (diffs coloured), tables, quotes, links, `code`, **bold**, *italic*. Never renders
 * HTML. Inline code naming a project file or module becomes a link into the diagram.
 */

export interface Target {
  type: "file" | "module";
  id: string;
}

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; level: number; text: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: { text: string; sub: string[] }[] }
  | { kind: "quote"; text: string }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "hr" };

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/;
const ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const isBlockStart = (line: string, next?: string) =>
  FENCE.test(line) || HEADING.test(line) || ITEM.test(line) || RULE.test(line) || line.startsWith(">") || (line.trim().startsWith("|") && next !== undefined && TABLE_SEP.test(next));

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(FENCE);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      blocks.push({ kind: "code", lang: fence[2].toLowerCase(), text: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(HEADING);
    if (h) {
      blocks.push({ kind: "h", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const header = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      blocks.push({ kind: "table", header, rows });
      continue;
    }
    const first = line.match(ITEM);
    if (first) {
      const ordered = /\d/.test(first[2]);
      const items: { text: string; sub: string[] }[] = [];
      while (i < lines.length) {
        const m = lines[i].match(ITEM);
        if (m && m[1].length >= 2 && items.length > 0) items[items.length - 1].sub.push(m[3]);
        else if (m && /\d/.test(m[2]) === ordered) items.push({ text: m[3], sub: [] });
        else if (!m && /^\s{2,}\S/.test(lines[i]) && items.length > 0) {
          const last = items[items.length - 1];
          if (last.sub.length) last.sub[last.sub.length - 1] += ` ${lines[i].trim()}`;
          else last.text += ` ${lines[i].trim()}`;
        } else break;
        i++;
      }
      blocks.push({ kind: "list", ordered, start: ordered ? parseInt(first[2], 10) : 1, items });
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) quote.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ kind: "quote", text: quote.join("\n") });
      continue;
    }
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i], lines[i + 1])) para.push(lines[i++]);
    blocks.push({ kind: "p", text: para.join("\n") });
  }
  return blocks;
}

const INLINE = /(`+)([\s\S]+?)\1|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|(?<![\w*])\*(?!\s)([^*\n]+?)\*(?!\w)|(?<!\w)_(?!\s)([^_\n]+?)_(?!\w)|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

interface Ctx {
  resolve: (text: string) => Target | null;
  onTarget: (target: Target) => void;
}

function Inline({ text, ctx }: { text: string; ctx: Ctx }) {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = k++;
    if (m[2] !== undefined) {
      const code = m[2].trim();
      const target = ctx.resolve(code);
      out.push(
        target ? (
          <button
            key={key}
            onClick={() => ctx.onTarget(target)}
            title={target.type === "file" ? `Show ${target.id} in the diagram` : `Show module ${code} in the diagram`}
            className="rounded-[4px] border-[1.5px] border-[var(--ink)] bg-[var(--yel-soft)] px-1 font-mono text-[0.88em] font-bold hover:bg-[var(--yel)] hover:text-[var(--on-yel)]"
          >
            {code}
          </button>
        ) : (
          <code key={key} className="rounded bg-[var(--hover)] px-1 py-px font-mono text-[0.9em]">
            {code}
          </code>
        ),
      );
    } else if (m[3] !== undefined || m[4] !== undefined) {
      out.push(
        <strong key={key} className="font-bold">
          <Inline text={m[3] ?? m[4]} ctx={ctx} />
        </strong>,
      );
    } else if (m[5] !== undefined || m[6] !== undefined) {
      out.push(
        <em key={key}>
          <Inline text={m[5] ?? m[6]} ctx={ctx} />
        </em>,
      );
    } else {
      out.push(
        <a key={key} href={m[8]} target="_blank" rel="noreferrer" className="font-bold underline decoration-2 underline-offset-[3px]">
          {m[7]}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

function lineClass(lang: string, line: string): string {
  if (lang !== "diff" && lang !== "patch") return "";
  if (line.startsWith("+++") || line.startsWith("---")) return "text-[var(--muted)]";
  if (line.startsWith("+")) return "bg-[var(--added-soft)] text-[var(--added)]";
  if (line.startsWith("-")) return "bg-[var(--danger-soft)] text-[var(--danger)]";
  if (line.startsWith("@@")) return "text-[var(--accent-strong)]";
  return "";
}

export function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: nothing to do
    }
  };
  return (
    <div className="my-2 overflow-hidden rounded-lg border-2 border-[var(--ink)] bg-[var(--canvas)]">
      <div className="flex items-center justify-between border-b-2 border-[var(--ink)] px-2.5 py-1">
        <span className="font-mono text-[12px] text-[var(--muted)]">{lang || "code"}</span>
        <button onClick={copy} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12.5px] font-bold text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]">
          {copied ? <Icon.Check className="h-3 w-3" /> : <Icon.Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto py-1.5 font-mono text-[12.5px] leading-[1.55]">
        {text.split("\n").map((line, i) => (
          <div key={i} className={`px-2.5 ${lineClass(lang, line)}`}>
            {line || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}

export function Markdown({ text, resolve, onTarget }: { text: string } & Ctx) {
  const ctx = { resolve, onTarget };
  return (
    <div className="space-y-2.5 text-[15px] leading-[1.55] [overflow-wrap:anywhere]">
      {parseBlocks(text).map((b, i) => {
        switch (b.kind) {
          case "p":
            return (
              <p key={i} className="whitespace-pre-line">
                <Inline text={b.text} ctx={ctx} />
              </p>
            );
          case "h":
            return (
              <p key={i} className={`font-letter pt-1 font-extrabold ${b.level <= 2 ? "text-[17px]" : "text-[15.5px]"}`}>
                <Inline text={b.text} ctx={ctx} />
              </p>
            );
          case "code":
            return <CodeBlock key={i} lang={b.lang} text={b.text} />;
          case "list": {
            const List = b.ordered ? "ol" : "ul";
            return (
              <List key={i} start={b.ordered ? b.start : undefined} className={`space-y-1 pl-5 ${b.ordered ? "list-decimal" : "list-disc"} marker:text-[var(--muted)]`}>
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Inline text={item.text} ctx={ctx} />
                    {item.sub.length > 0 && (
                      <ul className="mt-1 list-[circle] space-y-0.5 pl-5">
                        {item.sub.map((s, n) => (
                          <li key={n}>
                            <Inline text={s} ctx={ctx} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </List>
            );
          }
          case "quote":
            return (
              <blockquote key={i} className="whitespace-pre-line border-l-2 border-[var(--border)] pl-3 text-[var(--muted)]">
                <Inline text={b.text} ctx={ctx} />
              </blockquote>
            );
          case "table":
            return (
              <div key={i} className="overflow-x-auto">
                <table className="w-full text-[13.5px] tabular-nums">
                  <thead>
                    <tr className="text-left text-[12.5px] text-[var(--muted)]">
                      {b.header.map((h, j) => (
                        <th key={j} className="border-b border-[var(--border)] py-1 pr-3 font-medium">
                          <Inline text={h} ctx={ctx} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, j) => (
                      <tr key={j} className="border-b border-[var(--border)] last:border-0">
                        {row.map((c, n) => (
                          <td key={n} className="py-1 pr-3 align-top">
                            <Inline text={c} ctx={ctx} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "hr":
            return <hr key={i} className="border-[var(--border)]" />;
        }
      })}
    </div>
  );
}
