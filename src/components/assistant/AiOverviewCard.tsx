"use client";

import type { ReactNode } from "react";
import { Spinner } from "@/components/app/ui";
import { relPath } from "@/components/layers/format";
import { describeStep } from "@/lib/change/describe";
import type { PlanResult } from "@/lib/change/planner";
import type { Grouping } from "@/lib/cluster/grouping";
import { SEVERITY_WEIGHT, type Review } from "@/lib/diagnose/review";
import type { StatusState } from "./AssistantPanel";
import type { Autopilot, StageStatus } from "./useAutopilot";

const SEVERITY = { high: "serious", medium: "worth fixing", low: "minor" } as const;

function Block({ title, status, children, action }: { title: string; status?: StageStatus; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="border-t-2 border-dashed border-[var(--border)] pt-3 first:border-0 first:pt-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h4 className="text-[14.5px] font-bold">{title}</h4>
        {status === "running" && (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--muted)]">
            <Spinner className="h-3.5 w-3.5" /> working
          </span>
        )}
        {(status === "stopped" || status === "error") && <span className="text-[13px] font-bold text-[var(--warn)]">{status}</span>}
      </div>
      <div className="text-[14px] leading-relaxed">{children}</div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

function LinkButton(props: React.ComponentProps<"button">) {
  return <button {...props} className="k-link text-[14px]" />;
}

/** What the AI's full pass made of the project: the parts it named, the bugs it found, the tidy-up it planned. */
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
  onShowArchitecture: () => void;
  onShowBugs: () => void;
  onShowRefactor: () => void;
  onFocusFile: (file: string) => void;
}) {
  const ready = typeof status === "object" && status.configured;
  const stages = autopilot.stages;
  // A plan the user made themselves is not the AI's work; it shows only once the AI has done something.
  const hasResults = !!(architecture || review);

  if (!ready) {
    return (
      <p className="text-[14px] leading-relaxed text-[var(--muted)]">
        {status === "loading" ? "Connecting to the AI…" : "Add DEEPSEEK_API_KEY to .env.local and the AI can sort the files into named parts, look for bugs and plan a tidy-up."}
      </p>
    );
  }

  if (!hasResults && !stages) {
    return <p className="text-[14.5px] leading-relaxed text-[var(--muted)]">The AI didn&apos;t work on this project, so the map shows Kosmos&apos;s own results: folders, a guess from the history, and rules from the folder names.</p>;
  }

  const findings = review ? [...review.findings].sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity]) : [];
  const modules = architecture
    ? Object.keys(architecture.labels)
        .map((id) => ({ id, name: architecture.labels[id], purpose: architecture.descriptions?.[id] ?? "", tier: architecture.tiers?.[id] ?? 0, files: Object.values(architecture.partition).filter((m) => m === id).length }))
        .sort((a, b) => a.tier - b.tier)
    : [];

  return (
    <div className="space-y-3">
      <Block title="The parts it named" status={stages?.organize} action={architecture && <LinkButton onClick={onShowArchitecture}>Show them on the map</LinkButton>}>
        {architecture ? (
          <>
            <ul className="space-y-1">
              {modules.slice(0, 8).map((m) => (
                <li key={m.id}>
                  <b>{m.name}</b>
                  <span className="text-[var(--muted)]">
                    {" "}
                    · {m.files} {m.files === 1 ? "file" : "files"}
                    {m.purpose ? `: ${m.purpose}` : ""}
                  </span>
                </li>
              ))}
              {modules.length > 8 && <li className="text-[var(--muted)]">and {modules.length - 8} more</li>}
            </ul>
            <p className="mt-1.5 text-[13px] text-[var(--muted)]" title="MQ: how cleanly files split into groups. Higher is tidier.">
              Tidiness {architecture.mq.toFixed(2)}, against {folderMQ.toFixed(2)} for the folders{clustersMQ !== null && ` and ${clustersMQ.toFixed(2)} for the clusters`}.
            </p>
          </>
        ) : (
          <p className="text-[var(--muted)]">{stages?.organize === "running" ? "Sorting and naming…" : "Not done yet."}</p>
        )}
      </Block>

      <Block title="Bugs it found" status={stages?.bugs} action={review && <LinkButton onClick={onShowBugs}>Open Bug risk</LinkButton>}>
        {review ? (
          findings.length > 0 ? (
            <ul className="space-y-1.5">
              {findings.slice(0, 4).map((f, i) => (
                <li key={i}>
                  <span className="block leading-snug">
                    {f.title} <span className={f.severity === "high" ? "font-bold text-[var(--danger)]" : "text-[var(--muted)]"}>({SEVERITY[f.severity]})</span>
                  </span>
                  <button onClick={() => onFocusFile(f.file)} className="block max-w-full truncate font-mono text-[13px] text-[var(--muted)] underline decoration-[1.5px] underline-offset-2">
                    {relPath(f.file, prefix)}
                    {f.line ? `:${f.line}` : ""}
                  </button>
                </li>
              ))}
              <li className="text-[13px] text-[var(--muted)]">
                {findings.length} {findings.length === 1 ? "finding" : "findings"} in {review.reviewed.length} files read.
              </li>
            </ul>
          ) : (
            <p className="text-[var(--muted)]">It read {review.reviewed.length} files and found nothing wrong.</p>
          )
        ) : (
          <p className="text-[var(--muted)]">{stages?.bugs === "running" ? "Reading the riskiest files…" : "Not done yet."}</p>
        )}
      </Block>

      <Block title="The tidy-up plan" status={stages?.refactor} action={plan && <LinkButton onClick={onShowRefactor}>Open Refactor</LinkButton>}>
        {plan ? (
          plan.steps.length > 0 ? (
            <>
              <p>
                {plan.steps.length} {plan.steps.length === 1 ? "step" : "steps"}, fixing {plan.initialViolations.length - plan.finalViolations.length} of {plan.initialViolations.length} rule breaks;{" "}
                {patches} with code changes.
              </p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[13.5px] text-[var(--muted)]">
                {plan.steps.slice(0, 5).map((s, i) => (
                  <li key={i} className="truncate" title={describeStep(s, prefix)}>
                    {describeStep(s, prefix)}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="text-[var(--muted)]">The code already follows the rules. Nothing to tidy.</p>
          )
        ) : (
          <p className="text-[var(--muted)]">{stages?.refactor === "running" ? "Writing rules and planning…" : "Not done yet."}</p>
        )}
      </Block>

    </div>
  );
}
