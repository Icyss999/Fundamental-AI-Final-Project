"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Icon, Spinner } from "@/components/app/ui";
import type { SidebarContext } from "@/components/mapper/DiagramView";
import { CodeBlock } from "@/components/assistant/Markdown";
import { AskButton, Details, Heading, Note, PanelButton } from "@/components/mapper/panel";
import { formatFact, parseRules, type Proof } from "@/lib/change/engine";
import { describeStep, pathAfter, rewrites, structureMetrics } from "@/lib/change/describe";
import { formatAtom, splitEdge, type Heuristic, type PlanStep, type StateDelta } from "@/lib/change/planner";
import { RULE_BASE } from "@/lib/change/rules";
import type { ProjectAnalysis } from "@/lib/graph/project-analysis";
import { baseName, relPath } from "./format";
import type { Layers } from "./useLayers";

const HEURISTICS: { id: Heuristic; label: string; hint: string }[] = [
  { id: "matching", label: "A* search, matching bound (best)", hint: "Never overestimates, so the plan it finds is the cheapest one." },
  { id: "count", label: "A* search, violation count", hint: "Can overestimate (one move fixes several imports), so plans may cost more." },
  { id: "zero", label: "Uniform-cost search", hint: "No estimate at all: the baseline A* is measured against." },
];

const SYNTAX: [string, string][] = [
  ["layers: ui > logic > data", "Each layer may use itself and the layers below it, never the ones above. Commas join layers of equal rank: a, b."],
  ["forbid: pages -> data", "Files in pages must not use files in data."],
  ["only: services -> data", "Only services (and data itself) may use data."],
  ["allow: pages/legacy.tsx -> data", "An exception that overrides every rule."],
  ["keep: data", "The plan never moves these files."],
];

const ENGINE_RULES = new Map(parseRules(RULE_BASE).map((r) => [r.id, r.text]));

function ProofTree({ proof, prefix, depth = 0 }: { proof: Proof; prefix: string; depth?: number }) {
  const strip = (s: string) => (prefix ? s.split(`${prefix}/`).join("") : s);
  return (
    <div style={{ paddingLeft: depth ? 10 : 0 }} className={depth ? "border-l-2 border-[var(--border)]" : ""}>
      <div className="flex items-baseline gap-1.5 font-mono text-[12px] leading-relaxed">
        <span>{strip(formatFact(proof.fact))}</span>
        {proof.rule ? (
          <span className="font-bold text-[var(--accent-strong)]" title={ENGINE_RULES.get(proof.rule)}>
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
        <div key={a} style={{ paddingLeft: 10 }} className="border-l-2 border-[var(--border)] font-mono text-[12px] leading-relaxed text-[var(--muted)]">
          not {strip(formatFact(a))} (absent)
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
    <li className="rounded-lg border-2 border-[var(--ink)]">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-baseline gap-2 px-3 py-2 text-left" title="Why does this break a rule?">
        <span className={`text-[10px] text-[var(--muted)] transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
          ▶
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
          {relPath(pathAfter(delta, a), prefix)} <span className="font-bold text-[var(--danger)]">→</span> {relPath(pathAfter(delta, b), prefix)}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t-2 border-dashed border-[var(--border)] px-3 py-2.5">
          {reasons.map((r) => (
            <div key={r.rule.id + r.kind}>
              <p className="text-[14px] leading-relaxed">{r.summary}</p>
              <Details label="Show the rule engine's proof">
                <p className="font-mono text-[12px] text-[var(--muted)]">
                  Rule on line {r.rule.line}: {r.rule.text}
                </p>
                <ProofTree proof={r.proof} prefix={prefix} />
              </Details>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <PanelButton onClick={() => ctx.focusFile(a)}>Show {baseName(a)}</PanelButton>
            <PanelButton onClick={() => ctx.focusFile(b)}>Show {baseName(b)}</PanelButton>
            {onAsk && <AskButton onClick={() => onAsk(`Explain why \`${a}\` → \`${b}\` breaks the rules, and how I should fix it in the code.`)}>Ask AI how to fix it</AskButton>}
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
          Move <code className="font-mono font-bold">{baseName(a.file)}</code> to <code className="font-mono font-bold">{relPath(a.to, prefix) || "/"}/</code>
        </>
      ),
      sub: `from ${relPath(a.from, prefix) || "/"}/ · ${rewrites(step)} import ${rewrites(step) === 1 ? "line" : "lines"} to update`,
    };
  }
  return {
    title: (
      <>
        <code className="font-mono font-bold">{baseName(a.file)}</code> uses <code className="font-mono font-bold">{baseName(a.to)}</code> instead of <code className="font-mono font-bold">{baseName(a.from)}</code>
      </>
    ),
    sub: `${baseName(a.to)} already uses ${baseName(a.from)}; let ${baseName(a.file)} get what it needs from there`,
  };
}

function StepIcon({ kind }: { kind: "move" | "redirect" }) {
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 border-[var(--added)] text-[var(--added)]" title={kind === "move" ? "Move a file" : "Use a different file"}>
      {kind === "move" ? (
        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <path d="M2 8h11M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <path d="M3 13V8a3 3 0 0 1 3-3h7M10 2l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

function PlayerButton({ children, ...props }: React.ComponentProps<"button">) {
  return (
    <button {...props} className="grid h-9 w-9 place-items-center rounded-md hover:bg-[var(--hover)] disabled:pointer-events-none disabled:opacity-30">
      {children}
    </button>
  );
}

export function ChangePanel({ layers, ctx, analysis, onAsk }: { layers: Layers; ctx: SidebarContext; analysis: ProjectAnalysis; onAsk?: (prompt: string) => void }) {
  const { policy, evaluation, plan, step, currentStep, violationsNow, planOptions, comparison, planning } = layers;
  const byAI = layers.rulesText !== layers.suggested;
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
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <p className="text-[15px] leading-relaxed">
        {byAI ? "The AI wrote rules for how the parts may depend on each other." : "These rules were guessed from the folder names."} Kosmos checks every import against them, then plans the <b>fewest moves</b> that fix the ones that break them.
      </p>

      <Heading
        action={
          <PanelButton onClick={() => setSyntax((v) => !v)} aria-expanded={syntax}>
            {syntax ? "Hide help" : "How to read them"}
          </PanelButton>
        }
      >
        {byAI ? "The AI's rules" : "The rules"}
      </Heading>
      {syntax && (
        <dl className="mb-3 space-y-2 rounded-lg border-2 border-dashed border-[var(--border)] p-3">
          {SYNTAX.map(([code, text]) => (
            <div key={code}>
              <dt className="font-mono text-[13px] font-bold">{code}</dt>
              <dd className="text-[13px] text-[var(--muted)]">{text}</dd>
            </div>
          ))}
          <p className="pt-1 text-[13px] text-[var(--muted)]">
            Paths are folders or files{prefix ? <> inside <code className="font-mono">{prefix}/</code></> : null}; * stands for one folder; # starts a comment.
          </p>
        </dl>
      )}
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border-2 border-[var(--ink)] bg-[var(--canvas)] px-3 py-2.5 font-mono text-[13px] leading-relaxed" aria-label="Architecture rules">
        {layers.rulesText.trim() || "(no rules)"}
      </pre>
      {policy.errors.length > 0 && (
        <div id="rule-errors" className="mt-1 space-y-1">
          {policy.errors.map((e) => (
            <Note key={e.line} tone="danger">
              Line {e.line}: {e.message}
            </Note>
          ))}
        </div>
      )}

      <Heading>{plan && step > 0 ? `What still breaks them after step ${step}` : "What breaks them"}</Heading>
      {!policy.active ? (
        <Note>There are no rules to check the code against.</Note>
      ) : violationsNow.size === 0 ? (
        <p className="text-[15px] font-bold text-[var(--added)]">Nothing breaks the rules.</p>
      ) : (
        <>
          <Note tone="danger">
            {violationsNow.size} {violationsNow.size === 1 ? "import breaks" : "imports break"} the rules. They are the red arrows on the map; open one to see why.
          </Note>
          {byRule.map(([ruleId, keys]) => {
            const rule = policy.rules.find((r) => r.id === ruleId);
            return (
              <div key={ruleId} className="mt-3">
                <p className="mb-1 truncate font-mono text-[12.5px] text-[var(--muted)]" title={rule?.text}>
                  {rule?.text}
                </p>
                <ul className="space-y-1.5">
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
        <Details label="How does Kosmos check the rules?">
          <p>
            The rules become facts for a small rule engine (Datalog with forward chaining). It derived {evaluation.stats.derived.toLocaleString()} facts from {evaluation.stats.given.toLocaleString()} in{" "}
            {evaluation.stats.strata} strata and {evaluation.stats.rounds} rounds. Its rule base:
          </p>
          <pre className="overflow-x-auto rounded-md bg-[var(--hover)] p-2 font-mono text-[11.5px] leading-relaxed">{RULE_BASE.trim()}</pre>
        </Details>
      )}

      <Heading>The plan</Heading>
      {planning && (
        <p className="flex items-center gap-2 text-[15px]">
          <Spinner className="h-4 w-4" /> Planning…
        </p>
      )}
      {!planning && !plan && <Note>{evaluation.violations.length === 0 ? "Nothing to fix, so there is no plan." : "No plan was made for these rules."}</Note>}

      {plan && (
        <div className="mt-3">
          <p role="status" className={`text-[15px] leading-relaxed ${plan.status === "solved" ? "" : "text-[var(--warn)]"}`}>
            {plan.status === "solved" && (
              <>
                <b>
                  {n} {n === 1 ? "step fixes" : "steps fix"} {plan.initialViolations.length === 1 ? "the problem" : `all ${plan.initialViolations.length} problems`}.
                </b>{" "}
                Press play to watch them on the map.
              </>
            )}
            {plan.status === "partial" && `The search ran out of time; the best plan it found fixes ${plan.initialViolations.length - plan.finalViolations.length} of ${plan.initialViolations.length}.`}
            {plan.status === "unsolvable" &&
              `Moving files and switching imports can't fix everything here. The best plan fixes ${plan.initialViolations.length - plan.finalViolations.length} of ${plan.initialViolations.length}.`}
            {plan.status === "nothing-to-do" && "Nothing to fix."}
          </p>

          {n > 0 && (
            <>
              <div className="mt-2.5 flex items-center gap-0.5 rounded-lg border-2 border-[var(--ink)] px-1 py-0.5">
                <PlayerButton onClick={() => layers.setStep(0)} disabled={step === 0} title="Back to the code as it is" aria-label="Back to the start">
                  <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M3 3h2v10H3zM14 3v10L6 8z" /></svg>
                </PlayerButton>
                <PlayerButton onClick={() => layers.setStep(step - 1)} disabled={step === 0} title="Previous step" aria-label="Previous step">
                  <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M11 3v10L4 8z" /></svg>
                </PlayerButton>
                {layers.playing ? (
                  <PlayerButton onClick={() => layers.setPlaying(false)} title="Pause" aria-label="Pause">
                    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M4 3h3v10H4zM9 3h3v10H9z" /></svg>
                  </PlayerButton>
                ) : (
                  <PlayerButton onClick={play} title="Play the plan" aria-label="Play the plan">
                    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M5 3v10l8-5z" /></svg>
                  </PlayerButton>
                )}
                <PlayerButton onClick={() => layers.setStep(step + 1)} disabled={step >= n} title="Next step" aria-label="Next step">
                  <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M5 3v10l7-5z" /></svg>
                </PlayerButton>
                <PlayerButton onClick={() => layers.setStep(n)} disabled={step >= n} title="Jump to the end" aria-label="Jump to the end">
                  <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M11 3h2v10h-2zM2 3v10l8-5z" /></svg>
                </PlayerButton>
                <span className="ml-auto pr-2 text-[13.5px] font-bold tabular-nums">
                  Step {step} of {n}
                </span>
              </div>

              <ol className="mt-2.5 space-y-1.5">
                <li>
                  <button
                    onClick={() => layers.setStep(0)}
                    className={`flex w-full items-center gap-2.5 rounded-lg border-2 px-3 py-2 text-left text-[14px] ${step === 0 ? "border-[var(--ink)] bg-[var(--yel)] text-[var(--on-yel)]" : "border-transparent hover:bg-[var(--hover)]"}`}
                  >
                    <span className="font-letter w-5 text-center font-extrabold">0</span>
                    <span className="flex-1 font-bold">The code as it is</span>
                    <span className={step === 0 ? "" : "text-[var(--danger)]"}>{plan.initialViolations.length} problems</span>
                  </button>
                </li>
                {plan.steps.map((s, i) => {
                  const { title, sub } = describe(s, prefix);
                  const active = step === i + 1;
                  const patch = layers.patches?.get(i + 1);
                  return (
                    <li key={i}>
                      <button
                        onClick={() => layers.setStep(i + 1)}
                        className={`flex w-full items-start gap-2.5 rounded-lg border-2 px-3 py-2 text-left ${active ? "border-[var(--ink)] bg-[var(--yel)] text-[var(--on-yel)]" : "border-transparent hover:bg-[var(--hover)]"}`}
                      >
                        <span className="font-letter w-5 pt-0.5 text-center font-extrabold">{i + 1}</span>
                        <StepIcon kind={s.action.kind} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14px] leading-snug">{title}</span>
                          <span className={`block text-[12.5px] ${active ? "" : "text-[var(--muted)]"}`}>{sub}</span>
                          <span className={`block text-[12.5px] ${active ? "" : "text-[var(--muted)]"}`}>
                            {patch && <b className={active ? "" : "text-[var(--ai)]"}>patch ready · </b>}
                            fixes {s.fixed.length}
                            {s.introduced.length > 0 && <b className="text-[var(--danger)]"> · breaks {s.introduced.length}</b>} · {s.remaining} left
                          </span>
                        </span>
                      </button>
                      {active && (
                        <div className="ml-8 mt-1.5 space-y-2">
                          {patch && (
                            <div>
                              <p className="flex items-center gap-1.5 text-[13px] font-bold text-[var(--ai)]">
                                <Icon.Sparkle className="h-3.5 w-3.5" /> The code change, written by AI{patch.note ? `: ${patch.note}` : ""}
                              </p>
                              <CodeBlock lang="diff" text={patch.diff} />
                            </div>
                          )}
                          {onAsk && !patch && (
                            <AskButton onClick={() => onAsk(`Write the code changes for step ${i + 1} of the plan: ${describeStep(s, prefix)}. Read the files involved and give me unified diffs.`)}>
                              Ask AI to write this change
                            </AskButton>
                          )}
                          <Details label="How the planner sees this step">
                            <p>
                              Effort {s.cost.toFixed(2)} = 1 for the step + {s.costParts.rewrites.toFixed(2)} for import lines to update + {s.costParts.risk.toFixed(2)} for touching a likely-buggy file.
                            </p>
                            <div className="rounded-md bg-[var(--hover)] px-2 py-1.5 font-mono text-[11.5px] leading-relaxed">
                              <div>{prefix ? s.strips.name.split(`${prefix}/`).join("") : s.strips.name}</div>
                              {(
                                [
                                  ["needs", [...s.strips.pre.map(formatAtom), ...s.strips.preNot.map((x) => `¬${formatAtom(x)}`)]],
                                  ["adds", s.strips.add.map(formatAtom)],
                                  ["removes", s.strips.del.map(formatAtom)],
                                ] as [string, string[]][]
                              ).map(([label, atoms]) => (
                                <div key={label} className="flex gap-1.5">
                                  <span className="w-14 shrink-0 text-[var(--muted)]">{label}</span>
                                  <span className="min-w-0 break-all">{atoms.map((x) => (prefix ? x.split(`${prefix}/`).join("") : x)).join(", ")}</span>
                                </div>
                              ))}
                            </div>
                          </Details>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>

              {outcome && (
                <div className="mt-3 rounded-lg border-2 border-[var(--ink)] p-3">
                  <p className="mb-1.5 text-[14px] font-bold">After the plan</p>
                  <ul className="space-y-1 text-[14px] tabular-nums">
                    {(
                      [
                        ["Broken rules", outcome.before.violations, outcome.after.violations],
                        ["Loops", outcome.before.cycles, outcome.after.cycles],
                        ["Imports across folders", outcome.before.crossFolder, outcome.after.crossFolder],
                      ] as [string, number, number][]
                    ).map(([label, before, after]) => (
                      <li key={label} className="flex justify-between gap-2">
                        <span>{label}</span>
                        <span>
                          <span className="text-[var(--muted)]">{before} →</span> <b>{after}</b>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {plan && (
        <Details label="How was the plan found?">
          <p>
            {HEURISTICS.find((h) => h.id === planOptions.heuristic)?.label}: {HEURISTICS.find((h) => h.id === planOptions.heuristic)?.hint} Touching a file costs up to ×{planOptions.riskWeight.toFixed(2)} extra, scaled by its
            chance of holding a bug.
          </p>
          <p className="mt-2">
            Effort {plan.cost.toFixed(2)}, {plan.stats.expanded.toLocaleString()} states looked at ({plan.stats.generated.toLocaleString()} generated) in {plan.stats.ms} ms.
          </p>
        {comparison && (
          <table className="mt-2 w-full text-[12.5px] tabular-nums">
            <thead>
              <tr className="text-left text-[var(--muted)]">
                <th className="pb-1 font-bold">Search</th>
                <th className="pb-1 text-right font-bold">Effort</th>
                <th className="pb-1 text-right font-bold" title="States expanded">Looked at</th>
                <th className="pb-1 text-right font-bold">ms</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((r) => (
                <tr key={r.heuristic} className="border-t border-[var(--border)]">
                  <td className="py-1">{r.heuristic === "matching" ? "A* matching" : r.heuristic === "count" ? "A* count" : "Uniform-cost"}</td>
                  <td className="py-1 text-right">{r.status === "solved" ? r.cost.toFixed(2) : r.status}</td>
                  <td className="py-1 text-right">{r.expanded.toLocaleString()}</td>
                  <td className="py-1 text-right">{r.ms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        </Details>
      )}
    </div>
  );
}
