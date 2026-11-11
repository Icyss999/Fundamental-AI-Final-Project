"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Icon, Spinner } from "@/components/app/ui";
import type { SidebarContext } from "@/components/mapper/DiagramView";
import { CodeBlock } from "@/components/assistant/Markdown";
import { AskButton, Heading, Note, PanelButton } from "@/components/mapper/panel";
import { formatFact, parseRules, type Proof } from "@/lib/change/engine";
import { describeStep, pathAfter, rewrites, structureMetrics } from "@/lib/change/describe";
import { formatAtom, splitEdge, type Heuristic, type PlanStep, type StateDelta } from "@/lib/change/planner";
import { RULE_BASE } from "@/lib/change/rules";
import type { ProjectAnalysis } from "@/lib/graph/project-analysis";
import { baseName, relPath } from "./format";
import type { Layers } from "./useLayers";

const HEURISTICS: { id: Heuristic; label: string; hint: string }[] = [
  { id: "matching", label: "A* · matching bound", hint: "Admissible: one action can fix at most one import of a matching, so plans are optimal." },
  { id: "count", label: "A* · violation count", hint: "Not admissible: one move can fix several imports, so plans may cost more than needed." },
  { id: "zero", label: "Uniform-cost search", hint: "No heuristic: the baseline A* is compared against." },
];

const SYNTAX: [string, string][] = [
  ["layers: ui > logic > data", "Each layer may import itself and layers below; never above. Use commas for peers: a, b."],
  ["forbid: pages -> data", "Files under pages must not import files under data."],
  ["only: services -> data", "Only services (and data itself) may import data."],
  ["allow: pages/legacy.tsx -> data", "Exception that overrides every rule."],
  ["keep: data", "The planner never moves these files."],
];

const ENGINE_RULES = new Map(parseRules(RULE_BASE).map((r) => [r.id, r.text]));

function ProofTree({ proof, prefix, depth = 0 }: { proof: Proof; prefix: string; depth?: number }) {
  const strip = (s: string) => (prefix ? s.split(`${prefix}/`).join("") : s);
  return (
    <div style={{ paddingLeft: depth ? 10 : 0 }} className={depth ? "border-l border-[var(--border)]" : ""}>
      <div className="flex items-baseline gap-1.5 font-mono text-[10.5px] leading-relaxed">
        <span className="text-[var(--foreground)]">{strip(formatFact(proof.fact))}</span>
        {proof.rule ? (
          <span className="text-[var(--accent-strong)]" title={ENGINE_RULES.get(proof.rule)}>
            [{proof.rule}]
          </span>
        ) : (
          <span className="text-[var(--muted)]">fact</span>
        )}
      </div>
      {proof.premises.map((p) => (
        <ProofTree key={p.fact} proof={p} prefix={prefix} depth={depth + 1} />
      ))}
      {proof.absent.map((a) => (
        <div key={a} style={{ paddingLeft: 10 }} className="border-l border-[var(--border)] font-mono text-[10.5px] leading-relaxed text-[var(--muted)]">
          not {strip(formatFact(a))} <span>(absent)</span>
        </div>
      ))}
    </div>
  );
}

function ViolationRow({ edge, layers, delta, prefix, ctx, onAsk }: { edge: string; layers: Layers; delta: StateDelta | null; prefix: string; ctx: SidebarContext; onAsk?: (prompt: string) => void }) {
  const [open, setOpen] = useState(false);
  const [a, b] = splitEdge(edge);
  const reasons = open ? layers.policy.explain(pathAfter(delta, a), pathAfter(delta, b)) : [];
  return (
    <li className="rounded-md hover:bg-[var(--hover)]">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-baseline gap-1.5 px-2 py-1 text-left" title="Why is this a violation?">
        <span className={`text-[10px] text-[var(--muted)] transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
          {relPath(pathAfter(delta, a), prefix)} <span className="text-[var(--danger)]">→</span> {relPath(pathAfter(delta, b), prefix)}
        </span>
      </button>
      {open && (
        <div className="space-y-2 px-2 pb-2 pl-5">
          {reasons.map((r) => (
            <div key={r.rule.id + r.kind}>
              <p className="text-[12px] leading-relaxed">{r.summary}</p>
              <p className="mb-1 font-mono text-[10.5px] text-[var(--muted)]">
                line {r.rule.line}: {r.rule.text}
              </p>
              <ProofTree proof={r.proof} prefix={prefix} />
            </div>
          ))}
          <div className="flex gap-1">
            <PanelButton onClick={() => ctx.focusFile(a)}>Show {baseName(a)}</PanelButton>
            <PanelButton onClick={() => ctx.focusFile(b)}>Show {baseName(b)}</PanelButton>
            {onAsk && (
              <AskButton onClick={() => onAsk(`Explain why \`${a}\` → \`${b}\` breaks the rules, and how I should fix it in the code.`)}>Ask AI</AskButton>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function describe(step: PlanStep, prefix: string): { title: ReactNode; sub: string } {
  const a = step.action;
  if (a.kind === "move") {
    return {
      title: (
        <>
          Move <code className="font-mono">{baseName(a.file)}</code> to <code className="font-mono">{relPath(a.to, prefix) || "/"}/</code>
        </>
      ),
      sub: `from ${relPath(a.from, prefix) || "/"}/ · rewrites ${rewrites(step)} import paths`,
    };
  }
  return {
    title: (
      <>
        <code className="font-mono">{baseName(a.file)}</code> uses <code className="font-mono">{baseName(a.to)}</code> instead of{" "}
        <code className="font-mono">{baseName(a.from)}</code>
      </>
    ),
    sub: `${relPath(a.to, prefix)} already imports ${baseName(a.from)}; expose what ${baseName(a.file)} needs there`,
  };
}

function StepIcon({ kind }: { kind: "move" | "redirect" }) {
  return (
    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-[var(--added-soft)] text-[var(--added)]" title={kind === "move" ? "MoveFile" : "RedirectImport"}>
      {kind === "move" ? (
        <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M2 8h11M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M3 13V8a3 3 0 0 1 3-3h7M10 2l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

function PlayerButton({ children, ...props }: React.ComponentProps<"button">) {
  return (
    <button {...props} className="grid h-7 w-7 place-items-center rounded-md text-[var(--foreground)] hover:bg-[var(--hover)] disabled:pointer-events-none disabled:opacity-30">
      {children}
    </button>
  );
}

export function ChangePanel({ layers, ctx, analysis, onAsk }: { layers: Layers; ctx: SidebarContext; analysis: ProjectAnalysis; onAsk?: (prompt: string) => void }) {
  const { policy, evaluation, plan, step, currentStep, violationsNow, planOptions, setPlanOptions, comparison, planning } = layers;
  const [syntax, setSyntax] = useState(false);
  const prefix = analysis.prefix;
  const delta = currentStep?.state ?? null;

  const byRule = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const key of [...violationsNow].sort()) {
      const [a, b] = splitEdge(key);
      for (const r of policy.check(pathAfter(delta, a), pathAfter(delta, b))) groups.set(r, [...(groups.get(r) ?? []), key]);
    }
    return [...groups.entries()].sort(([x], [y]) => Number(x.slice(1)) - Number(y.slice(1)));
  }, [violationsNow, policy, delta]);

  const outcome = useMemo(() => {
    if (!plan || plan.steps.length === 0) return null;
    const last = plan.steps[plan.steps.length - 1];
    return { before: structureMetrics(analysis.graph, null, plan.initialViolations.length), after: structureMetrics(analysis.graph, last.state, plan.finalViolations.length) };
  }, [plan, analysis]);

  const n = plan?.steps.length ?? 0;
  const play = () => {
    if (step >= n) layers.setStep(0);
    layers.setPlaying(true);
  };

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--panel)]">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--border)] px-4">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-[var(--muted)]">Refactor</span>
        {ctx.selection && (
          <button onClick={ctx.clear} className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]" title="Clear selection">
            <Icon.Close className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          Write the architecture you want. A <strong className="font-medium text-[var(--foreground)]">rule engine</strong> finds the imports that break it, and{" "}
          <strong className="font-medium text-[var(--foreground)]">A* search</strong> plans the cheapest sequence of file moves and import redirects that fixes them.
        </p>

        <Heading
          action={
            <span className="flex gap-1">
              <PanelButton onClick={() => setSyntax((v) => !v)}>{syntax ? "Hide syntax" : "Syntax"}</PanelButton>
              <PanelButton onClick={() => layers.setRulesText(layers.suggested)} disabled={layers.rulesText === layers.suggested} title="Replace with rules suggested from this project's folders">
                Suggest
              </PanelButton>
            </span>
          }
        >
          Rules
        </Heading>
        {syntax && (
          <dl className="mb-2 space-y-1.5 rounded-lg bg-[var(--hover)] p-2.5">
            {SYNTAX.map(([code, text]) => (
              <div key={code}>
                <dt className="font-mono text-[11px] text-[var(--foreground)]">{code}</dt>
                <dd className="text-[11px] text-[var(--muted)]">{text}</dd>
              </div>
            ))}
            <p className="pt-1 text-[11px] text-[var(--muted)]">Paths are folders or files{prefix ? <> below <code>{prefix}/</code></> : null}; * matches one folder. # starts a comment.</p>
          </dl>
        )}
        <textarea
          value={layers.rulesText}
          onChange={(e) => layers.setRulesText(e.target.value)}
          spellCheck={false}
          rows={Math.min(10, Math.max(5, layers.rulesText.split("\n").length + 1))}
          className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-2.5 py-2 font-mono text-[11.5px] leading-relaxed outline-none focus:border-[var(--accent)]"
          aria-label="Architecture rules"
        />
        {policy.errors.map((e) => (
          <Note key={e.line} tone="danger">
            Line {e.line}: {e.message}
          </Note>
        ))}

        <Heading>{plan && step > 0 ? `Violations after step ${step}` : "Violations"}</Heading>
        {!policy.active ? (
          <Note>Add a rule to check the code against.</Note>
        ) : violationsNow.size === 0 ? (
          <Note>No import breaks these rules.</Note>
        ) : (
          <>
            <Note tone="danger">
              {violationsNow.size} {violationsNow.size === 1 ? "import breaks" : "imports break"} the rules (red arrows). Click one to see the engine&apos;s proof.
            </Note>
            {byRule.map(([ruleId, keys]) => {
              const rule = policy.rules.find((r) => r.id === ruleId);
              return (
                <div key={ruleId} className="mt-2">
                  <p className="truncate px-0.5 font-mono text-[10.5px] text-[var(--muted)]" title={rule?.text}>
                    line {rule?.line}: {rule?.text}
                  </p>
                  <ul>
                    {keys.map((k) => (
                      <ViolationRow key={k} edge={k} layers={layers} delta={delta} prefix={prefix} ctx={ctx} onAsk={onAsk} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </>
        )}
        {policy.active && (
          <p className="mt-2 px-0.5 text-[11px] text-[var(--muted)]">
            Forward chaining: {evaluation.stats.given.toLocaleString()} facts → {evaluation.stats.derived.toLocaleString()} derived in {evaluation.stats.strata} strata,{" "}
            {evaluation.stats.rounds} rounds.
          </p>
        )}

        <Heading>Plan</Heading>
        <div className="space-y-2.5">
          <label className="block">
            <span className="text-[12px]">Search</span>
            <select
              value={planOptions.heuristic}
              onChange={(e) => setPlanOptions({ ...planOptions, heuristic: e.target.value as Heuristic })}
              className="mt-0.5 w-full rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-[12.5px]"
            >
              {HEURISTICS.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
            <span className="block text-[11px] leading-snug text-[var(--muted)]">{HEURISTICS.find((h) => h.id === planOptions.heuristic)?.hint}</span>
          </label>
          <label className="block">
            <span className="flex items-baseline justify-between text-[12px]">
              <span>Avoid risky files</span>
              <span className="font-mono tabular-nums text-[var(--muted)]">×{planOptions.riskWeight.toFixed(2)}</span>
            </span>
            <input
              type="range"
              min={0}
              max={3}
              step={0.25}
              value={planOptions.riskWeight}
              onChange={(e) => setPlanOptions({ ...planOptions, riskWeight: Number(e.target.value) })}
              className="w-full accent-[var(--accent)]"
            />
            <span className="block text-[11px] leading-snug text-[var(--muted)]">Touching a file costs up to this much extra, scaled by its probability in Bug risk.</span>
          </label>
          <div className="flex gap-2">
            <button
              onClick={layers.runPlan}
              disabled={planning || !policy.active || evaluation.violations.length === 0}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[var(--accent-strong)] disabled:opacity-40"
            >
              {planning && <Spinner className="h-3.5 w-3.5" />}
              {planning ? "Searching…" : "Find a plan"}
            </button>
            <PanelButton onClick={layers.runComparison} disabled={planning || evaluation.violations.length === 0} className="px-2.5" title="Run all three searches on the same problem">
              Compare
            </PanelButton>
          </div>
        </div>

        {comparison && (
          <table className="mt-3 w-full text-[11px] tabular-nums">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--muted)]">
                <th className="pb-1 font-medium">Search</th>
                <th className="pb-1 text-right font-medium">Cost</th>
                <th className="pb-1 text-right font-medium" title="States expanded">Expanded</th>
                <th className="pb-1 text-right font-medium" title="Heuristic value of the start state">h(start)</th>
                <th className="pb-1 text-right font-medium">ms</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((r) => (
                <tr key={r.heuristic} className="border-t border-[var(--border)]">
                  <td className="py-1">{HEURISTICS.find((h) => h.id === r.heuristic)?.label.replace("A* · ", "A* ")}</td>
                  <td className="py-1 text-right">{r.status === "solved" ? r.cost.toFixed(2) : r.status}</td>
                  <td className="py-1 text-right">{r.expanded.toLocaleString()}</td>
                  <td className="py-1 text-right">{r.hStart.toFixed(2)}</td>
                  <td className="py-1 text-right">{r.ms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {plan && (
          <div className="mt-3">
            <Note tone={plan.status === "solved" ? "muted" : "warn"}>
              {plan.status === "solved" && `Fixes every violation in ${n} ${n === 1 ? "step" : "steps"}, total cost ${plan.cost.toFixed(2)}.`}
              {plan.status === "partial" && `Search limit reached; best plan found fixes ${plan.initialViolations.length - plan.finalViolations.length} of ${plan.initialViolations.length} violations.`}
              {plan.status === "unsolvable" &&
                `Moves and redirects alone cannot fix every violation (no allowed folder or go-between file). Best plan fixes ${plan.initialViolations.length - plan.finalViolations.length} of ${plan.initialViolations.length}.`}
              {plan.status === "nothing-to-do" && "Nothing to fix."} {plan.stats.expanded.toLocaleString()} states expanded, {plan.stats.generated.toLocaleString()} generated,{" "}
              {plan.stats.ms} ms.
            </Note>

            {n > 0 && (
              <>
                <div className="mt-2 flex items-center gap-0.5 rounded-lg border border-[var(--border)] px-1 py-0.5">
                  <PlayerButton onClick={() => layers.setStep(0)} disabled={step === 0} title="Back to the current code">
                    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M3 3h2v10H3zM14 3v10L6 8z" /></svg>
                  </PlayerButton>
                  <PlayerButton onClick={() => layers.setStep(step - 1)} disabled={step === 0} title="Previous step">
                    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M11 3v10L4 8z" /></svg>
                  </PlayerButton>
                  {layers.playing ? (
                    <PlayerButton onClick={() => layers.setPlaying(false)} title="Pause">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M4 3h3v10H4zM9 3h3v10H9z" /></svg>
                    </PlayerButton>
                  ) : (
                    <PlayerButton onClick={play} title="Play the plan">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M5 3v10l8-5z" /></svg>
                    </PlayerButton>
                  )}
                  <PlayerButton onClick={() => layers.setStep(step + 1)} disabled={step >= n} title="Next step">
                    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M5 3v10l7-5z" /></svg>
                  </PlayerButton>
                  <PlayerButton onClick={() => layers.setStep(n)} disabled={step >= n} title="Jump to the end">
                    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M11 3h2v10h-2zM2 3v10l8-5z" /></svg>
                  </PlayerButton>
                  <span className="ml-auto pr-1.5 text-[11.5px] tabular-nums text-[var(--muted)]">
                    Step {step} of {n}
                  </span>
                </div>

                <ol className="mt-2 space-y-1">
                  <li>
                    <button
                      onClick={() => layers.setStep(0)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] ${step === 0 ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"}`}
                    >
                      <span className="w-5 text-center text-[11px] text-[var(--muted)]">0</span>
                      <span className="flex-1">Current code</span>
                      <span className="text-[11px] text-[var(--danger)]">{plan.initialViolations.length} violations</span>
                    </button>
                  </li>
                  {plan.steps.map((s, i) => {
                    const { title, sub } = describe(s, prefix);
                    const active = step === i + 1;
                    return (
                      <li key={i}>
                        <button
                          onClick={() => layers.setStep(i + 1)}
                          className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left ${active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"}`}
                        >
                          <span className="w-5 pt-0.5 text-center text-[11px] text-[var(--muted)]">{i + 1}</span>
                          <StepIcon kind={s.action.kind} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[12px] leading-snug">{title}</span>
                            <span className="block truncate text-[11px] text-[var(--muted)]" title={sub}>
                              {sub}
                            </span>
                            <span className="block text-[11px] text-[var(--muted)]">
                              {layers.patches?.get(i + 1) && <span className="mr-1 font-medium text-[var(--ai)]">patch ready ·</span>}
                              fixes {s.fixed.length}
                              {s.introduced.length > 0 && <span className="text-[var(--danger)]"> · breaks {s.introduced.length}</span>} · {s.remaining} left
                            </span>
                          </span>
                          <span
                            className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--muted)]"
                            title={`base ${s.costParts.base} + rewrites ${s.costParts.rewrites.toFixed(2)} + risk ${s.costParts.risk.toFixed(2)}`}
                          >
                            {s.cost.toFixed(2)}
                          </span>
                        </button>
                        {active && (
                          <div className="ml-7 mt-1 rounded-md bg-[var(--hover)] px-2 py-1.5 font-mono text-[10.5px] leading-relaxed">
                            <div className="text-[var(--foreground)]">{prefix ? s.strips.name.split(`${prefix}/`).join("") : s.strips.name}</div>
                            {(
                              [
                                ["pre", [...s.strips.pre.map(formatAtom), ...s.strips.preNot.map((a) => `¬${formatAtom(a)}`)]],
                                ["add", s.strips.add.map(formatAtom)],
                                ["del", s.strips.del.map(formatAtom)],
                              ] as [string, string[]][]
                            ).map(([label, atoms]) => (
                              <div key={label} className="flex gap-1.5">
                                <span className="w-6 shrink-0 text-[var(--muted)]">{label}</span>
                                <span className="min-w-0 break-all">{atoms.map((x) => (prefix ? x.split(`${prefix}/`).join("") : x)).join(", ")}</span>
                              </div>
                            ))}
                            {layers.patches?.get(i + 1) && (
                              <div className="mt-2 font-sans">
                                <p className="flex items-center gap-1 text-[11px] font-semibold text-[var(--ai)]">
                                  <Icon.Sparkle className="h-3 w-3" /> Patch written by AI{layers.patches.get(i + 1)!.note ? ` — ${layers.patches.get(i + 1)!.note}` : ""}
                                </p>
                                <CodeBlock lang="diff" text={layers.patches.get(i + 1)!.diff} />
                              </div>
                            )}
                            {onAsk && !layers.patches?.get(i + 1) && (
                              <AskButton
                                className="mt-1.5"
                                onClick={() => onAsk(`Write the code changes for step ${i + 1} of the plan: ${describeStep(s, prefix)}. Read the files involved and give me unified diffs.`)}
                              >
                                Ask AI to write this change
                              </AskButton>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>

                {outcome && (
                  <table className="mt-3 w-full text-[11.5px] tabular-nums">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--muted)]">
                        <th className="pb-1 font-medium">After the plan</th>
                        <th className="pb-1 text-right font-medium">Before</th>
                        <th className="pb-1 text-right font-medium">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          ["Rule violations", outcome.before.violations, outcome.after.violations],
                          ["Import cycles", outcome.before.cycles, outcome.after.cycles],
                          ["Imports across folders", outcome.before.crossFolder, outcome.after.crossFolder],
                        ] as [string, number, number][]
                      ).map(([label, before, after]) => (
                        <tr key={label} className="border-t border-[var(--border)]">
                          <td className="py-1">{label}</td>
                          <td className="py-1 text-right">{before}</td>
                          <td className="py-1 text-right font-semibold">{after}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        )}

        <details className="mt-5 rounded-lg border border-[var(--border)]">
          <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">Rule base (Datalog)</summary>
          <pre className="overflow-x-auto px-3 pb-3 font-mono text-[10px] leading-relaxed text-[var(--muted)]">{RULE_BASE.trim()}</pre>
        </details>
      </div>
    </aside>
  );
}
