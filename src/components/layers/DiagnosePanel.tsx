"use client";

import { useRef, useState, type ReactNode } from "react";
import { Icon, timeAgo } from "@/components/app/ui";
import type { SidebarContext } from "@/components/mapper/DiagramView";
import { FileRow, Heading, Note, PanelButton } from "@/components/mapper/panel";
import type { HistoryData } from "@/lib/analyze";
import type { Outcome } from "@/lib/diagnose/bayes";
import { DEFAULT_DIAGNOSIS_PARAMS, type DiagnosisParams, type FileRisk } from "@/lib/diagnose/diagnose";
import type { ProjectSource } from "@/lib/repo/overview";
import { baseName, formatFactor, formatProb, heatBackground, hops, relPath } from "./format";
import type { Layers } from "./useLayers";

const RANKED_PREVIEW = 10;
const FACTOR_PREVIEW = 6;

function commitLink(source: ProjectSource, sha: string): string | null {
  return source.kind === "github" ? `${source.url}/commit/${sha}` : null;
}

function ProbBar({ p, max }: { p: number; max: number }) {
  return (
    <span className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-[var(--hover)]">
      <span className="block h-full rounded-full bg-[var(--heat)]" style={{ width: `${max > 0 ? Math.max(3, (p / max) * 100) : 0}%` }} />
    </span>
  );
}

function OutcomeIcon({ outcome }: { outcome: Outcome }) {
  return outcome === "fail" ? (
    <span title="failed" className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[var(--danger-soft)] text-[var(--danger)]">
      <Icon.Close className="h-2.5 w-2.5" />
    </span>
  ) : (
    <span title="passed" className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[var(--added-soft)] text-[var(--added)]">
      <Icon.Check className="h-2.5 w-2.5" />
    </span>
  );
}

function Row({ label, sub, value, children }: { label: ReactNode; sub?: ReactNode; value: ReactNode; children?: ReactNode }) {
  return (
    <li className="rounded-lg bg-[var(--hover)] px-2.5 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-medium">{label}</div>
          {sub && <div className="text-[11px] text-[var(--muted)]">{sub}</div>}
        </div>
        <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums">{value}</span>
      </div>
      {children}
    </li>
  );
}

/** "Why is this file suspected?" — the prior, each test's Bayes factor, and the posterior they give. */
function WhyCard({ risk, total, prefix, source, now, hasOutcomes, failing }: { risk: FileRisk; total: number; prefix: string; source: ProjectSource; now: number; hasOutcomes: boolean; failing: number }) {
  const [allFactors, setAllFactors] = useState(false);
  const h = risk.history;
  const factors = allFactors ? risk.factors : risk.factors.slice(0, FACTOR_PREVIEW);
  return (
    <section className="rounded-xl border border-[var(--border)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-all font-mono text-[13.5px] font-semibold">{baseName(risk.id)}</p>
          <p className="break-all font-mono text-[11px] text-[var(--muted)]">{relPath(risk.id, prefix)}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[22px] font-semibold leading-none tabular-nums">{formatProb(risk.posterior)}</div>
          <div className="mt-1 text-[11px] text-[var(--muted)]">
            #{risk.rank} of {total}
          </div>
        </div>
      </div>

      <ol className="mt-3 space-y-1.5">
        <Row label="Prior: history & size" sub="before any test result" value={formatProb(risk.prior.p)}>
          <div className="mt-1.5 space-y-0.5 text-[11.5px] leading-relaxed text-[var(--muted)]">
            <p>
              {h ? (
                <>
                  <strong className="font-medium text-[var(--foreground)]">{h.fixes}</strong> bug-fix {h.fixes === 1 ? "commit" : "commits"} among {h.changes}{" "}
                  {h.changes === 1 ? "change" : "changes"}
                </>
              ) : (
                "No commits touch this file in the history read"
              )}
              {" · "}
              {risk.loc} lines
            </p>
            <p title="Gamma–Poisson posterior mean: size-based baseline plus recency-weighted bug evidence">
              Expected bugs λ = {risk.prior.sizePart.toFixed(2)} (size) + {risk.prior.historyPart.toFixed(2)} (history)
            </p>
            {h?.recentFixes.map((fix) => {
              const href = commitLink(source, fix.sha);
              const subject = <span className="text-[var(--foreground)]">{fix.subject}</span>;
              return (
                <p key={fix.sha} className="truncate" title={fix.subject}>
                  ↳{" "}
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer" className="hover:underline">
                      {subject}
                    </a>
                  ) : (
                    subject
                  )}{" "}
                  · {timeAgo(new Date(fix.time * 1000).toISOString(), now)}
                </p>
              );
            })}
          </div>
        </Row>
        {factors.map((f) => (
          <Row
            key={f.test}
            label={
              <span className="flex items-center gap-1.5">
                <OutcomeIcon outcome={f.outcome} />
                <span className="truncate font-mono text-[11.5px]">{baseName(f.test)}</span>
              </span>
            }
            sub={`${f.outcome === "fail" ? "failed" : "passed"} · ${hops(f.depth)}`}
            value={formatFactor(f.logBF)}
          />
        ))}
        {risk.factors.length > FACTOR_PREVIEW && (
          <li>
            <button onClick={() => setAllFactors((v) => !v)} className="px-1 text-[11.5px] text-[var(--accent-strong)] hover:underline">
              {allFactors ? "Show fewer" : `+ ${risk.factors.length - FACTOR_PREVIEW} more tests`}
            </button>
          </li>
        )}
        <li className="flex items-center justify-between px-2.5 pt-1 text-[12.5px] font-semibold">
          <span>Posterior</span>
          <span className="font-mono tabular-nums">{formatProb(risk.posterior)}</span>
        </li>
      </ol>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
        {!hasOutcomes
          ? "No test results yet — mark tests below to add evidence."
          : risk.coveredBy === 0
            ? "No test file reaches this file, so test results can neither blame nor clear it."
            : "Each ×factor is a Bayes factor: how much that outcome multiplies the odds the bug is here."}
      </p>
      {failing > 0 && (
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          Ochiai baseline: {risk.ochiai.toFixed(2)}, rank #{risk.ochiaiRank}
        </p>
      )}
    </section>
  );
}

function Slider({ label, hint, value, min, max, step, format, onChange }: { label: string; hint: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="block" title={hint}>
      <span className="flex items-baseline justify-between text-[12px]">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-[var(--muted)]">{format(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
      <span className="block text-[11px] leading-snug text-[var(--muted)]">{hint}</span>
    </label>
  );
}

function ModelSettings({ params, onChange }: { params: DiagnosisParams; onChange: (p: DiagnosisParams) => void }) {
  const set = (key: keyof DiagnosisParams) => (v: number) => onChange({ ...params, [key]: v });
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <details className="group mt-5 rounded-lg border border-[var(--border)]">
      <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">Model settings</summary>
      <div className="space-y-3 px-3 pb-3">
        <Slider label="Activation α" hint="Chance a test fails when it runs the buggy file." value={params.activation} min={0.05} max={0.99} step={0.01} format={pct} onChange={set("activation")} />
        <Slider label="Noise ε" hint="Chance a test fails without running it (flaky tests, missed coverage)." value={params.noise} min={0.001} max={0.3} step={0.001} format={(v) => `${(v * 100).toFixed(1)}%`} onChange={set("noise")} />
        <Slider label="Coverage per hop" hint="How much weaker coverage gets for each import between test and file." value={params.coverageDecay} min={0.1} max={1} step={0.05} format={pct} onChange={set("coverageDecay")} />
        <Slider label="History half-life" hint="A change this much older than the newest commit counts half." value={params.halfLifeDays} min={30} max={720} step={10} format={(v) => `${v} days`} onChange={set("halfLifeDays")} />
        <Slider label="Ordinary change weight ω" hint="How much a non-fix change counts, relative to a bug fix." value={params.changeWeight} min={0} max={1} step={0.05} format={(v) => v.toFixed(2)} onChange={set("changeWeight")} />
        <Slider label="Size baseline κ" hint="How strongly priors lean towards file size instead of history." value={params.priorStrength} min={0.1} max={5} step={0.1} format={(v) => v.toFixed(1)} onChange={set("priorStrength")} />
        <PanelButton onClick={() => onChange(DEFAULT_DIAGNOSIS_PARAMS)}>Reset to defaults</PanelButton>
      </div>
    </details>
  );
}

function TriState({ value, onChange, label }: { value: Outcome | null; onChange: (v: Outcome | null) => void; label: string }) {
  const options: { v: Outcome | null; text: string; title: string; on: string }[] = [
    { v: null, text: "?", title: "unknown", on: "bg-[var(--panel)] text-[var(--foreground)] shadow-sm" },
    { v: "pass", text: "✓", title: "passed", on: "bg-[var(--added-soft)] text-[var(--added)] shadow-sm" },
    { v: "fail", text: "✗", title: "failed", on: "bg-[var(--danger-soft)] text-[var(--danger)] shadow-sm" },
  ];
  return (
    <span className="flex shrink-0 rounded-md bg-[var(--hover)] p-0.5" role="radiogroup" aria-label={`Outcome of ${label}`}>
      {options.map((o) => (
        <button
          key={o.title}
          role="radio"
          aria-checked={value === o.v}
          title={o.title}
          onClick={() => onChange(o.v)}
          className={`h-5 w-6 rounded text-[11px] font-semibold ${value === o.v ? o.on : "text-[var(--muted)] hover:text-[var(--foreground)]"}`}
        >
          {o.text}
        </button>
      ))}
    </span>
  );
}

export function DiagnosePanel({
  layers,
  history,
  exampleReport,
  ctx,
  prefix,
  source,
  labels,
  modules,
  analysedAt,
}: {
  layers: Layers;
  history: HistoryData | null;
  exampleReport?: { name: string; text: string };
  ctx: SidebarContext;
  prefix: string;
  source: ProjectSource;
  labels: Record<string, string>;
  modules: Map<string, string[]>;
  analysedAt: number;
}) {
  const { diagnosis: d, outcomes, setOutcome, setOutcomes, params, setParams, loadReport, reportNote } = layers;
  const [showAll, setShowAll] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { selection } = ctx;
  const selectedRisk = selection?.type === "file" ? d.byId.get(selection.id) : undefined;
  const ranked = showAll ? d.files : d.files.slice(0, RANKED_PREVIEW);
  const unknown = d.tests.length - d.failing - d.passing;

  let selected: ReactNode = null;
  if (selectedRisk) {
    selected = <WhyCard risk={selectedRisk} total={d.files.length} prefix={prefix} source={source} now={analysedAt} hasOutcomes={d.failing + d.passing > 0} failing={d.failing} />;
  } else if (selection?.type === "file") {
    selected = <Note>{relPath(selection.id, prefix)} is not a source file, so it is not ranked.</Note>;
  } else if (selection?.type === "module") {
    const files = (modules.get(selection.id) ?? []).map((f) => d.byId.get(f)).filter((r): r is FileRisk => !!r).sort((a, b) => a.rank - b.rank);
    const total = files.reduce((s, f) => s + f.posterior, 0);
    selected = (
      <section className="rounded-xl border border-[var(--border)] p-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[14px] font-semibold">{labels[selection.id] ?? selection.id}</p>
          <span className="text-[20px] font-semibold leading-none tabular-nums">{formatProb(total)}</span>
        </div>
        <p className="mb-2 text-[11px] text-[var(--muted)]">Chance the bug is somewhere in this module</p>
        {files.map((f) => (
          <FileRow key={f.id} file={relPath(f.id, prefix)} meta={formatProb(f.posterior)} onClick={() => ctx.focusFile(f.id)} />
        ))}
      </section>
    );
  }

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--panel)]">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--border)] px-4">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-[var(--muted)]">Bug risk</span>
        {selection && (
          <button onClick={ctx.clear} className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]" title="Clear selection">
            <Icon.Close className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {selected ?? (
          <p className="text-[13px] leading-relaxed text-[var(--muted)]">
            How likely each file is to hold a bug: its <strong className="font-medium text-[var(--foreground)]">git history</strong> sets the prior, and{" "}
            <strong className="font-medium text-[var(--foreground)]">test results</strong> update it by Bayes&apos; rule. Click a file to see why.
          </p>
        )}

        <Heading>Most likely locations</Heading>
        <ol>
          {ranked.map((f) => (
            <li key={f.id}>
              <FileRow
                file={relPath(f.id, prefix)}
                onClick={() => ctx.focusFile(f.id)}
                meta={
                  <span className="flex items-center gap-2">
                    {d.failing > 0 && (
                      <span className="text-[10px] text-[var(--muted)]" title="Rank by Ochiai, the spectrum-based baseline">
                        O#{f.ochiaiRank}
                      </span>
                    )}
                    <ProbBar p={f.posterior} max={d.maxPosterior} />
                    <span className="w-10 text-right font-mono text-[11px] text-[var(--foreground)]">{formatProb(f.posterior)}</span>
                  </span>
                }
              >
                <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-[var(--muted)]">{f.rank}</span>
              </FileRow>
            </li>
          ))}
        </ol>
        {d.files.length > RANKED_PREVIEW && (
          <button onClick={() => setShowAll((v) => !v)} className="mt-1 px-2 text-[11.5px] text-[var(--accent-strong)] hover:underline">
            {showAll ? "Show top 10" : `Show all ${d.files.length}`}
          </button>
        )}
        <div className="mt-3 flex items-center gap-2 text-[11px] text-[var(--muted)]">
          <span>less</span>
          <span
            className="h-2 flex-1 rounded-full border border-[var(--border)]"
            style={{ background: `linear-gradient(90deg, ${heatBackground(0, "var(--module-bg)")}, ${heatBackground(1, "var(--module-bg)")})` }}
          />
          <span>more likely</span>
        </div>
        <p className="mt-1 text-[11px] text-[var(--muted)]">Boxes share one scale: the likeliest box on screen is darkest.</p>

        <Heading
          action={
            <span className="flex gap-1">
              <PanelButton onClick={() => fileInput.current?.click()} title="Jest/Vitest --json, Mocha JSON or JUnit XML. Read in your browser; nothing is uploaded.">
                Load report
              </PanelButton>
              <PanelButton onClick={() => setOutcomes(new Map(d.tests.map((t) => [t.id, "pass" as const])))} disabled={d.tests.length === 0}>
                All pass
              </PanelButton>
              <PanelButton onClick={() => setOutcomes(new Map())} disabled={outcomes.size === 0}>
                Clear
              </PanelButton>
            </span>
          }
        >
          Test results
        </Heading>
        <input
          ref={fileInput}
          type="file"
          accept=".json,.xml,application/json,text/xml"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) loadReport(await file.text(), file.name);
          }}
        />
        {d.tests.length === 0 ? (
          <Note>No test files were found, so the ranking rests on history and size alone.</Note>
        ) : (
          <>
            <Note>
              {d.failing} failing · {d.passing} passing · {unknown} unknown — a test covers what it imports (directly or through other files).
            </Note>
            {exampleReport && (
              <button onClick={() => loadReport(exampleReport.text, exampleReport.name)} className="mt-1.5 px-0.5 text-[11.5px] text-[var(--accent-strong)] hover:underline">
                Load the sample&apos;s example report ({exampleReport.name})
              </button>
            )}
            {reportNote && <Note tone={reportNote.tone === "error" ? "danger" : "muted"}>{reportNote.text}</Note>}
            <ul className="mt-1.5 space-y-0.5">
              {d.tests.map((t) => (
                <li key={t.id} className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-[var(--hover)]">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]" title={`${t.id} — reaches ${t.covers} source files`}>
                    {relPath(t.id, prefix)}
                  </span>
                  <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--muted)]" title="source files it reaches">
                    {t.covers}
                  </span>
                  <TriState value={t.outcome} onChange={(v) => setOutcome(t.id, v)} label={t.id} />
                </li>
              ))}
            </ul>
          </>
        )}

        <Heading>Git history</Heading>
        {d.history && history ? (
          <Note>
            {d.history.commits} {d.history.commits === 1 ? "commit touches" : "commits touch"} these files, {d.history.fixCommits} of them bug fixes
            {d.history.from && d.history.to
              ? ` (${new Date(d.history.from * 1000).toLocaleDateString(undefined, { month: "short", year: "numeric" })} – ${new Date(d.history.to * 1000).toLocaleDateString(undefined, { month: "short", year: "numeric" })})`
              : ""}
            .{d.history.bulkSkipped > 0 && ` ${d.history.bulkSkipped} bulk ${d.history.bulkSkipped === 1 ? "commit was" : "commits were"} skipped.`}
            {history.truncated && ` Read the latest ${history.read} commits.`}
            {history.source === "fixture" && " This sample ships a recorded history (git-log.txt)."}
          </Note>
        ) : (
          <Note>No git history was available, so the prior follows file size only.</Note>
        )}

        <ModelSettings params={params} onChange={setParams} />
      </div>
    </aside>
  );
}
