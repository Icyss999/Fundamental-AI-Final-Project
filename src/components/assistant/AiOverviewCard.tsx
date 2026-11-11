"use client";

import type { ReactNode } from "react";
import { Card, Icon, Spinner } from "@/components/app/ui";
import { relPath } from "@/components/layers/format";
import { describeStep } from "@/lib/change/describe";
import type { PlanResult } from "@/lib/change/planner";
import type { Grouping } from "@/lib/cluster/grouping";
import { SEVERITY_WEIGHT, type Review } from "@/lib/diagnose/review";
import type { StatusState } from "./AssistantPanel";
import type { Autopilot, StageStatus } from "./useAutopilot";

const SEVERITY_DOT = { high: "bg-[var(--danger)]", medium: "bg-[var(--warn)]", low: "bg-[var(--muted)]" } as const;

function Column({ title, status, children, action }: { title: string; status?: StageStatus; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl bg-[var(--hover)] p-3.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{title}</h3>
        {status === "running" && (
          <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ai)]">
            <Spinner className="h-3 w-3" /> working
          </span>
        )}
        {(status === "stopped" || status === "error") && <span className="text-[11px] text-[var(--warn)]">{status}</span>}
      </div>
      <div className="min-h-0 flex-1 text-[12.5px] leading-relaxed">{children}</div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

function LinkButton(props: React.ComponentProps<"button">) {
  return <button {...props} className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--ai)] hover:underline" />;
}

/** What the AI autopilot made of the project: its architecture, the bugs it found, and the refactoring it planned. */
export function AiOverviewCard({
  status,
  autopilot,
  architecture,
  clustersMQ,
  folderMQ,
  review,
  plan,
  patches,
  prefix,
  onRun,
  onShowArchitecture,
  onShowBugs,
  onShowRefactor,
  onFocusFile,
}: {
  status: StatusState;
  autopilot: Autopilot;
  architecture: Grouping | null;
  clustersMQ: number | null;
  folderMQ: number;
  review: Review | null;
  plan: PlanResult | null;
  patches: number;
  prefix: string;
  onRun: () => void;
  onShowArchitecture: () => void;
  onShowBugs: () => void;
  onShowRefactor: () => void;
  onFocusFile: (file: string) => void;
}) {
  const ready = typeof status === "object" && status.configured;
  const stages = autopilot.stages;
  const hasResults = !!(architecture || review || plan);
  const title = (
    <span className="inline-flex items-center gap-1.5">
      <Icon.Sparkle className="h-4 w-4 text-[var(--ai)]" /> AI autopilot
    </span>
  );

  if (!ready) {
    return (
      <Card title={title}>
        <p className="text-[13px] text-[var(--muted)]">
          {status === "loading" ? "Connecting to the assistant…" : "Add DEEPSEEK_API_KEY to .env.local to let the AI rearrange the diagram, hunt for bugs and plan the refactoring."}
        </p>
      </Card>
    );
  }

  const action = autopilot.running ? (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ai)]">
      <Spinner className="h-3.5 w-3.5" /> Running…
    </span>
  ) : (
    <button onClick={onRun} className="rounded-lg bg-[var(--ai)] px-3 py-1 text-[12.5px] font-medium text-white hover:brightness-110">
      {hasResults ? "Run again" : "Run autopilot"}
    </button>
  );

  if (!hasResults && !stages) {
    return (
      <Card title={title} action={action}>
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          Let the AI take over: it rearranges the diagram into the project&apos;s real architecture (MQ clustering, then named modules and tiers), reviews the riskiest code for bugs (findings feed the
          Bayesian ranking), and plans the refactoring with A* — with a patch for every step.
        </p>
      </Card>
    );
  }

  const findings = review ? [...review.findings].sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity]) : [];
  const modules = architecture
    ? Object.keys(architecture.labels)
        .map((id) => ({ id, name: architecture.labels[id], purpose: architecture.descriptions?.[id] ?? "", tier: architecture.tiers?.[id] ?? 0, files: Object.values(architecture.partition).filter((m) => m === id).length }))
        .sort((a, b) => a.tier - b.tier)
    : [];

  return (
    <Card title={title} action={action}>
      <div className="grid gap-3 md:grid-cols-3">
        <Column
          title="Architecture"
          status={stages?.organize}
          action={architecture && <LinkButton onClick={onShowArchitecture}>Show in the diagram →</LinkButton>}
        >
          {architecture ? (
            <>
              <ul className="space-y-1">
                {modules.slice(0, 8).map((m) => (
                  <li key={m.id} className="min-w-0">
                    <span className="mr-1.5 rounded bg-[var(--panel)] px-1 font-mono text-[10px] text-[var(--muted)]" title="Tier: 0 is the top of the diagram">
                      {m.tier}
                    </span>
                    <span className="font-medium">{m.name}</span>
                    <span className="text-[var(--muted)]">
                      {" "}
                      · {m.files} {m.files === 1 ? "file" : "files"}
                      {m.purpose ? ` — ${m.purpose}` : ""}
                    </span>
                  </li>
                ))}
                {modules.length > 8 && <li className="text-[var(--muted)]">+ {modules.length - 8} more</li>}
              </ul>
              <p className="mt-2 text-[11.5px] text-[var(--muted)]" title="TurboMQ: higher = more cohesive modules with fewer imports between them">
                MQ {architecture.mq.toFixed(2)}
                {clustersMQ !== null && ` · clusters ${clustersMQ.toFixed(2)}`} · folders {folderMQ.toFixed(2)}
              </p>
            </>
          ) : (
            <p className="text-[var(--muted)]">{stages?.organize === "running" ? "Clustering and naming modules…" : "Not organised yet."}</p>
          )}
        </Column>

        <Column title="Bugs" status={stages?.bugs} action={review && <LinkButton onClick={onShowBugs}>Open Bug risk →</LinkButton>}>
          {review ? (
            findings.length > 0 ? (
              <>
                <ul className="space-y-1.5">
                  {findings.slice(0, 4).map((f, i) => (
                    <li key={i} className="flex min-w-0 items-start gap-2">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[f.severity]}`} />
                      <span className="min-w-0">
                        <span className="block leading-snug">{f.title}</span>
                        <button onClick={() => onFocusFile(f.file)} className="block truncate font-mono text-[11px] text-[var(--muted)] hover:text-[var(--ai)]">
                          {relPath(f.file, prefix)}
                          {f.line ? `:${f.line}` : ""}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11.5px] text-[var(--muted)]">
                  {findings.length} {findings.length === 1 ? "finding" : "findings"} in {review.reviewed.length} files read
                </p>
              </>
            ) : (
              <p className="text-[var(--muted)]">Reviewed {review.reviewed.length} files and found no problems.</p>
            )
          ) : (
            <p className="text-[var(--muted)]">{stages?.bugs === "running" ? "Reading the riskiest files…" : "Not reviewed yet."}</p>
          )}
        </Column>

        <Column title="Refactoring" status={stages?.refactor} action={plan && <LinkButton onClick={onShowRefactor}>Open Refactor →</LinkButton>}>
          {plan ? (
            plan.steps.length > 0 ? (
              <>
                <p>
                  {plan.steps.length} {plan.steps.length === 1 ? "step" : "steps"}, cost {plan.cost.toFixed(2)} · fixes {plan.initialViolations.length - plan.finalViolations.length} of {plan.initialViolations.length} violations
                </p>
                <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-[12px] text-[var(--muted)]">
                  {plan.steps.slice(0, 5).map((s, i) => (
                    <li key={i} className="truncate" title={describeStep(s, prefix)}>
                      {describeStep(s, prefix)}
                    </li>
                  ))}
                </ol>
                <p className="mt-2 text-[11.5px] text-[var(--muted)]">
                  {patches} of {plan.steps.length} steps have a patch
                </p>
              </>
            ) : (
              <p className="text-[var(--muted)]">The code already follows the rules — nothing to refactor.</p>
            )
          ) : (
            <p className="text-[var(--muted)]">{stages?.refactor === "running" ? "Writing rules and planning…" : "No plan yet."}</p>
          )}
        </Column>
      </div>
    </Card>
  );
}
