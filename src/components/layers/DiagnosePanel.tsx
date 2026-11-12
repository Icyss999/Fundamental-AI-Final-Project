"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Icon, Spinner, timeAgo } from "@/components/app/ui";
import { CodeBlock } from "@/components/assistant/Markdown";
import type { SidebarContext } from "@/components/mapper/DiagramView";
import { AskButton, Details, FileRow, Heading, Note, PanelButton } from "@/components/mapper/panel";
import type { HistoryData } from "@/lib/analyze";
import type { Outcome } from "@/lib/diagnose/bayes";
import { reviewLogBayesFactor } from "@/lib/diagnose/bayes";
import type { FileRisk } from "@/lib/diagnose/diagnose";
import { SEVERITY_WEIGHT, type Finding } from "@/lib/diagnose/review";
import type { ProjectSource } from "@/lib/repo/overview";
import { baseName, formatFactor, formatProb, hops, relPath } from "./format";
import type { Layers } from "./useLayers";

const RANKED_PREVIEW = 8;

function commitLink(source: ProjectSource, sha: string): string | null {
  return source.kind === "github" ? `${source.url}/commit/${sha}` : null;
}

/** Likelihood as a strip of halftone dots: the same print as the map. */
function Dots({ p, max }: { p: number; max: number }) {
  return <span aria-hidden className="k-halftone h-3 w-14 shrink-0 rounded-[3px] border-[1.5px] border-[var(--ink)]" style={{ "--dot": max > 0 ? p / max : 0 } as CSSProperties} />;
}

function OutcomeIcon({ outcome }: { outcome: Outcome }) {
  return outcome === "fail" ? (
    <span title="failed" className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-[1.5px] border-[var(--danger)] text-[var(--danger)]">
      <Icon.Close className="h-3 w-3" />
    </span>
  ) : (
    <span title="passed" className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-[1.5px] border-[var(--added)] text-[var(--added)]">
      <Icon.Check className="h-3 w-3" />
    </span>
  );
}

/** "Why is this file suspected?" in plain words; the prior and every Bayes factor under the fold. */
function WhyCard({ risk, total, prefix, source, now, hasOutcomes, failing, onAsk }: { risk: FileRisk; total: number; prefix: string; source: ProjectSource; now: number; hasOutcomes: boolean; failing: number; onAsk?: () => void }) {
  const h = risk.history;
  const fails = risk.factors.filter((f) => f.outcome === "fail");
  const passes = risk.factors.filter((f) => f.outcome === "pass");
  const reasons: ReactNode[] = [];
  reasons.push(
    h && h.changes > 0 ? (
      <>
        <b>Its history:</b> {h.fixes} of its {h.changes} recorded changes {h.fixes === 1 ? "was a bug fix" : "were bug fixes"}.
      </>
    ) : (
      <>
        <b>Its history:</b> no changes recorded, so only its size ({risk.loc} lines) counts.
      </>
    ),
  );
  if (fails.length > 0) reasons.push(<><b>{fails.length} failing {fails.length === 1 ? "test uses" : "tests use"} it,</b> which raises the odds.</>);
  if (passes.length > 0) reasons.push(<>{passes.length} passing {passes.length === 1 ? "test uses" : "tests use"} it, which lowers the odds.</>);
  if (hasOutcomes && risk.coveredBy === 0) reasons.push(<>No test reaches this file, so test results can&apos;t move its odds.</>);
  if (risk.review) reasons.push(risk.review.flagged ? <><b>The AI review flagged it:</b> {risk.review.titles.join("; ")}.</> : <>The AI read it and found nothing wrong.</>);

  return (
    <section className="rounded-xl border-[2.5px] border-[var(--ink)] p-4 shadow-[4px_4px_0_var(--ink)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-all font-mono text-[17px] font-bold">{baseName(risk.id)}</p>
          <p className="break-all font-mono text-[12.5px] text-[var(--muted)]">{relPath(risk.id, prefix)}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-letter text-[30px] font-extrabold leading-none tabular-nums">{formatProb(risk.posterior)}</div>
          <div className="mt-1 text-[13px] text-[var(--muted)]">
            #{risk.rank} of {total}
          </div>
        </div>
      </div>
      <p className="mt-3 text-[14px] font-bold">Why Kosmos suspects it</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-[14.5px] leading-relaxed marker:text-[var(--muted)]">
        {reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      {h && h.recentFixes.length > 0 && (
        <div className="mt-2 space-y-0.5 text-[13px] text-[var(--muted)]">
          {h.recentFixes.slice(0, 3).map((fix) => {
            const href = commitLink(source, fix.sha);
            return (
              <p key={fix.sha} className="truncate" title={fix.subject}>
                ↳{" "}
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer" className="text-[var(--foreground)] underline underline-offset-2">
                    {fix.subject}
                  </a>
                ) : (
                  <span className="text-[var(--foreground)]">{fix.subject}</span>
                )}{" "}
                · {timeAgo(new Date(fix.time * 1000).toISOString(), now)}
              </p>
            );
          })}
        </div>
      )}
      {onAsk && (
        <AskButton className="mt-3" onClick={onAsk}>
          Ask AI to inspect this file
        </AskButton>
      )}
      <Details>
        <p>
          Kosmos uses Bayes&apos; rule. It starts from a <b>prior</b> of {formatProb(risk.prior.p)} (expected bugs λ = {risk.prior.sizePart.toFixed(2)} from size + {risk.prior.historyPart.toFixed(2)}{" "}
          from recency-weighted fixes), then multiplies the odds by a <b>Bayes factor</b> for each test result:
        </p>
        <ul className="space-y-1">
          {risk.factors.map((f) => (
            <li key={f.test} className="flex items-center gap-2">
              <OutcomeIcon outcome={f.outcome} />
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{baseName(f.test)}</span>
              <span className="shrink-0 text-[12.5px] text-[var(--muted)]">{hops(f.depth)}</span>
              <span className="w-12 shrink-0 text-right font-mono font-bold tabular-nums">{formatFactor(f.logBF)}</span>
            </li>
          ))}
          {risk.review && (
            <li className="flex items-center gap-2">
              <Icon.Sparkle className="h-4 w-4 shrink-0 text-[var(--ai)]" />
              <span className="flex-1">AI code review</span>
              <span className="w-12 shrink-0 text-right font-mono font-bold tabular-nums">{formatFactor(risk.review.logBF)}</span>
            </li>
          )}
        </ul>
        <p>
          The result, normalised over all files, is the posterior: <b>{formatProb(risk.posterior)}</b>.
          {failing > 0 && ` The classic Ochiai method ranks this file #${risk.ochiaiRank} (score ${risk.ochiai.toFixed(2)}).`}
        </p>
      </Details>
    </section>
  );
}


const SEVERITY_WORD = { high: "serious", medium: "worth fixing", low: "minor" } as const;

/** The lines around a bug, the bug's line printed in red. */
function BugCode({ file, line, read }: { file: string; line: number; read: (path: string) => Promise<string> }) {
  const [got, setGot] = useState<{ text: string } | { error: string } | null>(null);
  useEffect(() => {
    let live = true;
    read(file).then(
      (text) => live && setGot({ text }),
      (e: unknown) => live && setGot({ error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [file, read]);

  if (!got) {
    return (
      <p className="flex items-center gap-2 text-[13.5px] text-[var(--muted)]">
        <Spinner className="h-3.5 w-3.5" /> Fetching the code…
      </p>
    );
  }
  if ("error" in got) return <Note>Couldn&apos;t show the code: {got.error}</Note>;
  const all = got.text.split("\n");
  const start = Math.max(1, line - 3);
  const end = Math.min(all.length, line + 3);
  return (
    <pre className="overflow-x-auto rounded-lg border-2 border-[var(--ink)] bg-[var(--canvas)] py-1.5 font-mono text-[12.5px] leading-[1.6]" aria-label={`${baseName(file)}, lines ${start} to ${end}; line ${line} has the bug`}>
      {all.slice(start - 1, end).map((text, i) => {
        const n = start + i;
        const bug = n === line;
        return (
          <div key={n} className={`flex border-l-4 pr-3 ${bug ? "border-[var(--red)] bg-[var(--danger-soft)] font-bold text-[var(--red)]" : "border-transparent"}`}>
            <span className={`w-10 shrink-0 select-none pr-3 text-right ${bug ? "" : "text-[var(--muted)]"}`}>{n}</span>
            <span className="whitespace-pre">{text || " "}</span>
          </div>
        );
      })}
    </pre>
  );
}

/** One bug the AI found: where, what, the code with the line in red, and the suggested fix. */
function FindingRow({ finding: f, prefix, onFocus, read }: { finding: Finding; prefix: string; onFocus: (file: string) => void; read?: (path: string) => Promise<string> }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`rounded-lg border-2 ${f.severity === "high" ? "border-[var(--red)]" : "border-[var(--ink)]"}`}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left">
        <Icon.Alert className={`mt-0.5 h-4 w-4 shrink-0 ${f.severity === "low" ? "text-[var(--muted)]" : "text-[var(--red)]"}`} />
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-bold leading-snug">{f.title}</span>
          <span className="block truncate font-mono text-[12.5px] text-[var(--muted)]">
            {relPath(f.file, prefix)}
            {f.line ? `, line ${f.line}` : ""} · {SEVERITY_WORD[f.severity]}
          </span>
        </span>
        <span className="shrink-0 pt-0.5 text-[12.5px] font-bold text-[var(--muted)]">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="space-y-2.5 border-t-2 border-dashed border-[var(--border)] px-3 py-2.5">
          {f.line && read && <BugCode file={f.file} line={f.line} read={read} />}
          <p className="whitespace-pre-line text-[14px] leading-relaxed">{f.detail}</p>
          {f.fix && (
            <div>
              <p className="mb-1 text-[13px] font-bold">Suggested fix</p>
              <CodeBlock lang="diff" text={f.fix} />
            </div>
          )}
          <PanelButton onClick={() => onFocus(f.file)}>Show {baseName(f.file)} on the map</PanelButton>
        </div>
      )}
    </li>
  );
}

export function DiagnosePanel({
  layers,
  history,
  ctx,
  prefix,
  source,
  labels,
  modules,
  analysedAt,
  onAsk,
  readSource,
}: {
  layers: Layers;
  history: HistoryData | null;
  ctx: SidebarContext;
  prefix: string;
  source: ProjectSource;
  labels: Record<string, string>;
  modules: Map<string, string[]>;
  analysedAt: number;
  onAsk?: (prompt: string) => void;
  /** Source text of a project file, to show the code around a bug. */
  readSource?: (path: string) => Promise<string>;
}) {
  const { diagnosis: d, params } = layers;
  const [showAll, setShowAll] = useState(false);
  const { selection } = ctx;
  const selectedRisk = selection?.type === "file" ? d.byId.get(selection.id) : undefined;
  const ranked = showAll ? d.files : d.files.slice(0, RANKED_PREVIEW);

  let selected: ReactNode = null;
  if (selectedRisk) {
    const id = selectedRisk.id;
    selected = (
      <WhyCard
        risk={selectedRisk}
        total={d.files.length}
        prefix={prefix}
        source={source}
        now={analysedAt}
        hasOutcomes={d.failing + d.passing > 0}
        failing={d.failing}
        onAsk={onAsk && (() => onAsk(`Inspect \`${id}\`: read it (and the failing tests that reach it, if any) and tell me where a bug most likely is and how to fix it.`))}
      />
    );
  } else if (selection?.type === "file") {
    selected = <Note>{relPath(selection.id, prefix)} is a test or config file, so Kosmos doesn&apos;t rank it.</Note>;
  } else if (selection?.type === "module") {
    const files = (modules.get(selection.id) ?? []).map((f) => d.byId.get(f)).filter((r): r is FileRisk => !!r).sort((a, b) => a.rank - b.rank);
    const total = files.reduce((s, f) => s + f.posterior, 0);
    selected = (
      <section className="rounded-xl border-[2.5px] border-[var(--ink)] p-4 shadow-[4px_4px_0_var(--ink)]">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[18px] font-bold">{labels[selection.id] ?? selection.id}</p>
          <span className="font-letter text-[28px] font-extrabold leading-none tabular-nums">{formatProb(total)}</span>
        </div>
        <p className="mb-2 text-[13.5px] text-[var(--muted)]">Chance the bug is somewhere in this part</p>
        {files.map((f) => (
          <FileRow key={f.id} file={relPath(f.id, prefix)} meta={formatProb(f.posterior)} onClick={() => ctx.focusFile(f.id)} />
        ))}
      </section>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      {selected ?? (
        <p className="text-[15px] leading-relaxed">
          The AI read the riskiest files for real bugs. The ranking weighs each file&apos;s <b>history of fixes</b>, its <b>size</b>, the <b>test results</b> the AI found and its own review. Click a file to see why it is suspected.
        </p>
      )}

      <Heading>Bugs found</Heading>
      {!layers.review ? (
        <Note>The AI didn&apos;t review the code this time, so the red dots are only a guess from the history and file sizes.</Note>
      ) : layers.review.findings.length === 0 ? (
        <Note>The AI read {layers.review.reviewed.length} {layers.review.reviewed.length === 1 ? "file" : "files"} and found nothing wrong.</Note>
      ) : (
        <>
          <p className="text-[14px] leading-relaxed">
            <b className="text-[var(--red)]">
              {layers.review.findings.length} {layers.review.findings.length === 1 ? "bug" : "bugs"}
            </b>{" "}
            in {layers.review.reviewed.length} {layers.review.reviewed.length === 1 ? "file" : "files"} the AI read. Their boxes are outlined in red. Open one to see the line.
          </p>
          <ul className="mt-2 space-y-2">
            {[...layers.review.findings]
              .sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity])
              .map((f, i) => (
                <FindingRow key={`${f.file}:${f.line ?? ""}:${i}`} finding={f} prefix={prefix} onFocus={ctx.focusFile} read={readSource} />
              ))}
          </ul>
          <Details label="How do the bugs change the guess?">
            <p>
              Each file the AI flags counts as evidence: its odds go up to {formatFactor(reviewLogBayesFactor(SEVERITY_WEIGHT.high, params))} for a serious bug. A file it read and found clean goes{" "}
              {formatFactor(reviewLogBayesFactor(null, params))}.
            </p>
          </Details>
        </>
      )}

      <Heading>Most likely places</Heading>
      <ol className="space-y-0.5">
        {ranked.map((f) => (
          <li key={f.id}>
            <FileRow
              file={relPath(f.id, prefix)}
              onClick={() => ctx.focusFile(f.id)}
              meta={
                <span className="flex items-center gap-2">
                  <Dots p={f.posterior} max={d.maxPosterior} />
                  <span className="w-11 text-right font-mono text-[13px] font-bold text-[var(--foreground)]">{formatProb(f.posterior)}</span>
                </span>
              }
            >
              <span className="w-5 shrink-0 text-right text-[13px] tabular-nums text-[var(--muted)]">{f.rank}</span>
            </FileRow>
          </li>
        ))}
      </ol>
      {d.files.length > RANKED_PREVIEW && (
        <button onClick={() => setShowAll((v) => !v)} className="k-link mt-2 px-2 text-[14px]">
          {showAll ? `Show the top ${RANKED_PREVIEW}` : `Show all ${d.files.length}`}
        </button>
      )}
      <p className="mt-2 flex items-center gap-2 px-2 text-[13px] text-[var(--muted)]">
        <Dots p={1} max={1} /> More dots on the map means more likely.
      </p>
      {d.failing > 0 && (
        <Details label="How does this compare with the classic method?">
          <p>
            Ochiai, the standard spectrum-based method, ranks files only by which failing tests touch them. Kosmos also weighs each file&apos;s history and the passing tests. Ochiai&apos;s ranks for
            the files above:
          </p>
          <ul className="space-y-0.5 font-mono text-[12.5px]">
            {ranked.slice(0, 8).map((f) => (
              <li key={f.id} className="flex justify-between gap-2">
                <span className="truncate">{baseName(f.id)}</span>
                <span className="shrink-0">
                  Kosmos #{f.rank} · Ochiai #{f.ochiaiRank}
                </span>
              </li>
            ))}
          </ul>
        </Details>
      )}

      <Heading>Test results</Heading>
      {d.tests.length === 0 ? (
        <Note>This project has no test files, so the guess rests on history, size and the AI&apos;s review.</Note>
      ) : d.failing + d.passing === 0 ? (
        <Note>
          {d.tests.length} test {d.tests.length === 1 ? "file" : "files"}, but no results were available to the AI, so tests don&apos;t move the odds.
        </Note>
      ) : (
        <>
          <Note>
            {layers.report ? `From ${layers.report.name}: ` : ""}
            {d.failing} failed, {d.passing} passed{d.tests.length - d.failing - d.passing > 0 ? `, ${d.tests.length - d.failing - d.passing} not known` : ""}.
          </Note>
          <ul className="mt-2.5 space-y-1">
            {d.tests
              .filter((t) => t.outcome)
              .map((t) => (
                <li key={t.id} className="flex items-center gap-2 rounded-md px-1 py-0.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={`${t.id} — reaches ${t.covers} source files`}>
                    {relPath(t.id, prefix)}
                  </span>
                  <OutcomeIcon outcome={t.outcome!} />
                </li>
              ))}
          </ul>
        </>
      )}

      <Heading>History</Heading>
      {d.history && history ? (
        <Note>
          {d.history.commits} {d.history.commits === 1 ? "change touches" : "changes touch"} these files, {d.history.fixCommits} of them bug fixes
          {d.history.from && d.history.to
            ? ` (${new Date(d.history.from * 1000).toLocaleDateString(undefined, { month: "short", year: "numeric" })} to ${new Date(d.history.to * 1000).toLocaleDateString(undefined, { month: "short", year: "numeric" })})`
            : ""}
          .{d.history.bulkSkipped > 0 && ` ${d.history.bulkSkipped} bulk ${d.history.bulkSkipped === 1 ? "change was" : "changes were"} skipped.`}
          {history.truncated && ` Only the latest ${history.read} were read.`}
          {history.source === "fixture" && " This sample ships a recorded history."}
        </Note>
      ) : (
        <Note>No git history was available, so the starting guess follows file size only.</Note>
      )}
    </div>
  );
}
