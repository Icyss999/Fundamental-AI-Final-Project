"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ChangePanel } from "@/components/layers/ChangePanel";
import { DiagnosePanel } from "@/components/layers/DiagnosePanel";
import { baseName, formatProb, relPath } from "@/components/layers/format";
import { Inspector } from "@/components/mapper/Inspector";
import { describeStep } from "@/lib/change/describe";
import { AUTOPILOT_STAGES } from "@/lib/ai/autopilot";
import { useMap } from "./MapShell";
import { activity, AI_STEPS, aiState, lastError, StepPanel, useElapsed } from "./progress";
import { mapHref } from "./routes";
import { useProject } from "./session";
import { SidePanel } from "./SidePanel";
import { Burst, SentenceText, StoryBox, TourBox } from "./Story";
import { Spinner } from "./ui";

/** A mode page: its story box (which steps aside while a panel is open, unless there is room) and its panel. */
function ModePage({ story, panel }: { story: ReactNode; panel: ReactNode }) {
  const map = useMap();
  return (
    <>
      <div className={map.panel ? "contents max-[1700px]:hidden" : "contents"}>{story}</div>
      {map.panel === "mode" && panel}
    </>
  );
}

const linkOnYellow = "k-link !text-[var(--on-yel)] text-[14.5px]";

const ANALYZING = {
  bugs: {
    running: "Kosmos is hunting for bugs…",
    waiting: "The bug hunt starts in a moment…",
    failed: "The AI couldn't finish the bug hunt.",
    what: "It reads the riskiest files line by line and marks each real problem it finds. They'll show up here, outlined in red.",
  },
  refactor: {
    running: "Kosmos is planning a tidy-up…",
    waiting: "The tidy-up plan comes after the bug hunt…",
    failed: "The AI couldn't finish the tidy-up plan.",
    what: "It writes rules that fit the parts it found, checks every import against them, and plans the fewest moves that fix what breaks them, with the code change for each step.",
  },
} as const;

/** Covers the map while the AI works on this page's stage in the background (or could not finish it). */
function AnalyzingPanel({ stage }: { stage: "bugs" | "refactor" }) {
  const project = useProject();
  const map = useMap();
  const state = project.stageOf(stage);
  const failed = state === "failed";
  const elapsed = useElapsed(!failed);
  const now = activity(project.assistant.messages);
  const copy = ANALYZING[stage];
  return (
    <section aria-live="polite" className="absolute inset-0 z-20 grid place-items-center overflow-y-auto bg-[color-mix(in_srgb,var(--canvas)_86%,transparent)] p-4">
      <div className="k-fade w-full max-w-xl rounded-xl border-[2.5px] border-[var(--ink)] bg-[var(--paper)] p-5 shadow-[5px_5px_0_var(--ink)] md:p-6">
        <h1 className="font-letter text-[26px] font-extrabold leading-tight [text-wrap:balance] md:text-[30px]">{failed ? copy.failed : state === "running" ? copy.running : copy.waiting}</h1>
        <p className="mt-2 text-[15.5px] leading-relaxed text-[var(--muted)]">
          {failed ? `It ran into a problem${lastError(project.assistant.messages) ? `: ${lastError(project.assistant.messages)}` : "."}` : copy.what}
        </p>
        <ol className="mt-5 grid grid-cols-3 gap-2" aria-label="The AI's steps">
          {AUTOPILOT_STAGES.map((st, i) => (
            <StepPanel key={st.id} n={i + 1} label={AI_STEPS[st.id]} state={aiState(project.autopilot.stages?.[st.id])} />
          ))}
        </ol>
        {!failed && (
          <p className="mt-3 flex items-center gap-3 text-[14.5px]" role="status">
            <span className="min-w-0 flex-1 truncate">{state === "running" ? (now ?? "Thinking…") : "Waiting for the step before it…"}</span>
            <span className="shrink-0 font-mono text-[13px] tabular-nums text-[var(--muted)]">
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
            </span>
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {failed && (
            <button onClick={project.retryPass} className="k-btn k-btn-yellow k-btn-press">
              Try again
            </button>
          )}
          <Link href={mapHref("structure", project.repo)} className={failed ? "k-btn" : "k-btn k-btn-yellow k-btn-press"}>
            Look at the parts meanwhile
          </Link>
          <button onClick={() => map.setPanel("ai")} className="k-link text-[14.5px]">
            Watch it work
          </button>
        </div>
      </div>
    </section>
  );
}

/** True while this page should wait for the AI (or show that it could not finish). */
const waitingFor = (state: ReturnType<ReturnType<typeof useProject>["stageOf"]>) => state === "waiting" || state === "running" || state === "failed";

/** /map/structure: the parts the AI designed, the story of how they fit, and the tour. */
export function StructureView() {
  const { data, diagramAnalysis, groupings, selection } = useProject();
  const map = useMap();
  const labels = diagramAnalysis.labels;
  const story =
    map.tour !== null && map.tourSteps.length > 0 ? (
      <TourBox steps={map.tourSteps} index={map.tour} onIndex={map.setTour} onExit={map.endTour} labels={labels} onModule={map.focusModule} onFile={map.focusFile} />
    ) : (
      <StoryBox
        title={`Here's how ${data.overview.name} is put together.`}
        actions={
          <>
            {map.tourSteps.length > 0 && (
              <button onClick={map.startTour} className="k-btn k-btn-ink k-btn-press" aria-keyshortcuts="T">
                Take the tour →
              </button>
            )}
            <button onClick={() => map.setPanel("project")} className={linkOnYellow}>
              About this project
            </button>
          </>
        }
      >
        {groupings.kind === "ai" && <p>The AI sorted the files into these parts and named them.</p>}
        {map.story.map((s, i) => (
          <p key={i}>
            <SentenceText sentence={s} labels={labels} onModule={map.focusModule} onFile={map.focusFile} />
          </p>
        ))}
      </StoryBox>
    );
  return (
    <ModePage
      story={story}
      panel={
        <SidePanel title={selection ? (selection.type === "module" ? "This part" : "This file") : "How to read the map"} onClose={() => map.setPanel(null)}>
          <Inspector analysis={diagramAnalysis} source={data.overview.source} selection={selection} onFocusFile={map.focusFile} onFocusModule={map.focusModule} />
        </SidePanel>
      }
    />
  );
}

/** /map/bug-risk: the bugs the AI found, and where a bug most likely hides. */
export function RiskView() {
  const project = useProject();
  if (waitingFor(project.stageOf("bugs"))) return <AnalyzingPanel stage="bugs" />;
  return <RiskResults />;
}

function RiskResults() {
  const project = useProject();
  const { layers, overviewAnalysis, diagramAnalysis, data, analysedAt, readSource } = project;
  const map = useMap();
  const prefix = overviewAnalysis.prefix;
  const d = layers.diagnosis;
  const top = d.files.slice(0, 3);
  const tested = d.failing + d.passing > 0;
  const review = layers.review;
  const bugs = review?.findings ?? [];
  const title = bugs.length > 0 ? `The AI found ${bugs.length} ${bugs.length === 1 ? "bug" : "bugs"}.` : review ? "The AI found no bugs." : top.length === 0 ? "No files to weigh up." : "Where bugs probably hide.";
  const story = (
    <StoryBox
      title={title}
      actions={
        <button onClick={() => map.setPanel("mode")} className="k-btn k-btn-ink k-btn-press">
          {bugs.length > 0 ? "Show the bugs" : "See the full list"}
        </button>
      }
    >
      {bugs.length > 0 && <p>It read the riskiest files and marked each problem, line by line. Their boxes are outlined in red.</p>}
      {review && bugs.length === 0 && <p>It read {review.reviewed.length} of the riskiest files and found nothing wrong.</p>}
      <p>
        {tested
          ? `It weighed ${d.failing} failing and ${d.passing} passing test ${d.failing + d.passing === 1 ? "file" : "files"}, the git history and its own review.`
          : d.history
            ? `It weighed ${d.history.fixCommits} past bug ${d.history.fixCommits === 1 ? "fix" : "fixes"} in ${d.history.commits} commits, how big each file is${review ? ", and its own review" : ""}.`
            : `No git history came with this project, so it weighed file size${review ? " and its own review" : ""}.`}{" "}
        The more red dots on a box, the likelier.
      </p>
      {top.length > 0 && (
        <ol className="space-y-1">
          {top.map((f, i) => (
            <li key={f.id} className="flex items-baseline gap-2.5">
              <span className="font-letter w-4 shrink-0 font-extrabold">{i + 1}</span>
              <button onClick={() => map.focusFile(f.id)} className="min-w-0 truncate text-left font-mono text-[14.5px] font-bold underline decoration-[1.5px] underline-offset-[3px]" title={relPath(f.id, prefix)}>
                {baseName(f.id)}
              </button>
              <span className="ml-auto shrink-0 tabular-nums">{formatProb(f.posterior)}</span>
            </li>
          ))}
        </ol>
      )}
    </StoryBox>
  );
  return (
    <ModePage
      story={story}
      panel={
        <SidePanel title="Bug risk" onClose={() => map.setPanel(null)}>
          <DiagnosePanel
            layers={layers}
            history={data.history}
            ctx={map.ctx}
            prefix={prefix}
            source={data.overview.source}
            labels={diagramAnalysis.labels}
            modules={diagramAnalysis.modules}
            analysedAt={analysedAt}
            onAsk={map.askAI}
            readSource={readSource}
          />
        </SidePanel>
      }
    />
  );
}

/** /map/refactor: the rules the AI wrote, what breaks them, and its plan, played on the map. */
export function RefactorView() {
  const project = useProject();
  if (waitingFor(project.stageOf("refactor"))) return <AnalyzingPanel stage="refactor" />;
  return <RefactorResults />;
}

function RefactorResults() {
  const { layers, overviewAnalysis } = useProject();
  const map = useMap();
  const prefix = overviewAnalysis.prefix;
  const { policy, evaluation, plan, step, currentStep, planning, playing } = layers;
  const n = plan?.steps.length ?? 0;
  const broken = evaluation.violations.length;
  const finished = !!plan && plan.status === "solved" && n > 0 && step === n;
  const byAI = layers.rulesText !== layers.suggested;
  const rules = byAI ? "the rules the AI wrote" : "rules guessed from the folder names";
  const open = () => map.setPanel("mode");
  const seeRules = (
    <button onClick={open} className={linkOnYellow}>
      See the rules
    </button>
  );

  let story: ReactNode;
  if (planning) {
    story = (
      <StoryBox title="Planning the tidy-up…">
        <p className="flex items-center gap-2">
          <Spinner className="h-4 w-4" /> Searching for the fewest moves that keep {rules}.
        </p>
      </StoryBox>
    );
  } else if (!policy.active || policy.errors.length > 0) {
    story = (
      <StoryBox title="No rules to check." actions={seeRules}>
        <p>The AI didn&apos;t leave rules that Kosmos could read, so there is nothing to check the imports against.</p>
      </StoryBox>
    );
  } else if (broken === 0) {
    story = (
      <StoryBox title="Everything follows the rules." sticker={<Burst>All tidy!</Burst>} actions={seeRules}>
        <p>
          Kosmos checked every import against {policy.rules.length} {policy.rules.length === 1 ? "rule" : "rules"}: {rules}. Nothing breaks them.
        </p>
      </StoryBox>
    );
  } else if (!plan || n === 0) {
    story = (
      <StoryBox title={`${broken} ${broken === 1 ? "import breaks" : "imports break"} the rules.`} actions={seeRules}>
        <p>They&apos;re the red arrows on the map, checked against {rules}.</p>
        <p>{plan ? "The search couldn't find moves that fix them all; the rules may ask for something files can't do by moving." : "No plan was made for them."}</p>
      </StoryBox>
    );
  } else {
    const play = () => {
      if (step >= n) layers.setStep(0);
      layers.setPlaying(true);
    };
    story = (
      <StoryBox
        title={finished ? "Done: the rules are kept." : plan.status === "solved" ? `${n} ${n === 1 ? "step fixes" : "steps fix"} it.` : `${n} ${n === 1 ? "step fixes" : "steps fix"} most of it.`}
        sticker={finished && plan.finalViolations.length === 0 ? <Burst>All tidy!</Burst> : undefined}
        actions={
          <>
            {playing ? (
              <button onClick={() => layers.setPlaying(false)} className="k-btn k-btn-ink k-btn-press">
                Pause
              </button>
            ) : (
              <button onClick={play} className="k-btn k-btn-ink k-btn-press">
                {step === 0 ? "Play the plan" : step >= n ? "Play again" : "Keep playing"}
              </button>
            )}
            <button onClick={open} className={linkOnYellow}>
              Open the plan
            </button>
          </>
        }
      >
        <p className="font-bold tabular-nums">{step === 0 ? `${broken} ${broken === 1 ? "import breaks" : "imports break"} ${rules}.` : `Step ${step} of ${n}`}</p>
        <p>{currentStep ? describeStep(currentStep, prefix) : "Each step moves a file or swaps one import for another. Press play and watch the boxes glide."}</p>
      </StoryBox>
    );
  }
  return (
    <ModePage
      story={story}
      panel={
        <SidePanel title="Refactor" onClose={() => map.setPanel(null)} wide>
          <ChangePanel layers={layers} ctx={map.ctx} analysis={overviewAnalysis} onAsk={map.askAI} />
        </SidePanel>
      }
    />
  );
}
