"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { formatLoc } from "@/components/mapper/layout";
import type { AnalyzeStep } from "@/lib/analyze";
import { activity, AI_STEPS, aiState, lastError, StepPanel, useElapsed, type PanelState } from "./progress";
import { displayName, mapHref } from "./routes";
import { runIs, useOptionalProject, useRun, type Progress } from "./session";
import { Icon, Logo, Wordmark } from "./ui";

const READ_STEPS: { id: AnalyzeStep; label: string }[] = [
  { id: "resolve", label: "Find it" },
  { id: "download", label: "Download" },
  { id: "extract", label: "Read imports" },
  { id: "history", label: "Read history" },
  { id: "summarize", label: "Sum up" },
];

function readState(progress: Progress | null, hasData: boolean, steps: typeof READ_STEPS, i: number): PanelState {
  if (hasData) return "done";
  const current = progress ? steps.findIndex((s) => s.id === progress.current) : -1;
  return i < current ? "done" : i === current ? "active" : "todo";
}

/**
 * /analyze?repo=…: the waiting screen. Kosmos reads the code and its AI sorts the files into named parts; the map
 * opens as soon as that is done, while the AI hunts for bugs and plans the tidy-up in the background.
 */
export function AnalyzeScreen() {
  const repo = useSearchParams().get("repo") ?? "";
  const router = useRouter();
  const { run, start, cancel } = useRun();
  const project = useOptionalProject();

  useEffect(() => {
    if (repo) start(repo);
    else router.replace("/");
  }, [repo, start, router]);

  const mine = runIs(run, repo) ? run : null;
  const session = mine?.data ? project : null;
  const ready = !!session?.ready;
  useEffect(() => {
    if (ready && session) router.replace(mapHref("structure", session.repo));
  }, [ready, session, router]);

  const data = mine?.data ?? null;
  const name = data?.overview.name ?? displayName(repo);
  const status = session?.status ?? "loading";
  const noAI = !!session && (status === "error" || (typeof status === "object" && !status.configured));
  const stages = session?.autopilot.stages ?? null;
  const failed = session?.stageOf("organize") === "failed";
  const working = !mine?.error && !failed && !noAI && !ready;
  const elapsed = useElapsed(working);
  const now = session ? activity(session.assistant.messages) : null;
  const sources = data ? data.graph.nodes.filter((f) => f.role === "source") : [];

  const title = mine?.error
    ? "Kosmos couldn't read that repository."
    : noAI
      ? "The AI isn't set up."
      : failed
        ? "The AI couldn't sort the parts."
        : data
          ? `Kosmos's AI is sorting ${name} into parts.`
          : `Kosmos is reading ${name}.`;

  const leave = () => {
    session?.assistant.stop();
    cancel();
    router.push("/");
  };

  return (
    <main className="flex min-h-dvh flex-col bg-[var(--paper)] text-[var(--foreground)]">
      <nav className="flex items-center justify-between px-4 py-4 md:px-8">
        <Link href="/" className="group/mark flex items-center gap-2.5">
          <Logo className="h-10 w-10" />
          <Wordmark className="text-[26px]" />
        </Link>
        {working && (
          <button onClick={leave} className="k-link text-[15px]">
            Cancel
          </button>
        )}
      </nav>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 pb-16 md:px-8">
        <h1 className="font-letter text-[34px] font-extrabold leading-[1.1] [text-wrap:balance] sm:text-[44px]" aria-live="polite">
          {title}
        </h1>

        {mine?.error ? (
          <>
            <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border-2 border-[var(--danger)] px-4 py-3 text-[15px] text-[var(--danger)]">
              <Icon.Alert className="mt-0.5 h-4 w-4 shrink-0" />
              {mine.error}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button onClick={() => start(repo, true)} className="k-btn k-btn-yellow k-btn-press">
                Try again
              </button>
              <Link href="/" className="k-btn">
                Pick another repository
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-[var(--muted)]">
              {noAI
                ? "Kosmos shows what its AI makes of a codebase, so it needs a DeepSeek API key. Add one and start again, or see the results of Kosmos's own algorithms."
                : failed
                  ? `It ran into a problem${lastError(session?.assistant.messages ?? []) ? `: ${lastError(session?.assistant.messages ?? [])}` : "."} Try again, or open the map with the files in their folders.`
                  : "It reads every import and sorts the files into a few parts that make sense. The map opens as soon as that's done; bug hunting and the tidy-up plan carry on while you look around."}
            </p>

            <section className="mt-8" aria-label="Progress">
              <h2 className="mb-2 text-[14px] font-bold text-[var(--muted)]">Reading the code</h2>
              <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${READ_STEPS.length}, minmax(0, 1fr))` }}>
                {READ_STEPS.map((s, i) => (
                  <StepPanel key={s.id} n={i + 1} label={s.label} state={readState(mine?.progress ?? null, !!data, READ_STEPS, i)} />
                ))}
              </ol>
              {!noAI && (
                <>
                  <h2 className="mb-2 mt-5 text-[14px] font-bold text-[var(--muted)]">The AI at work</h2>
                  <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${READ_STEPS.length}, minmax(0, 1fr))` }}>
                    <StepPanel n={READ_STEPS.length + 1} label={AI_STEPS.organize} state={aiState(stages?.organize)} />
                  </ol>
                </>
              )}
              {working && (
                <p className="mt-4 flex min-h-[1.5em] items-center gap-3 text-[15px]" role="status">
                  <span className="min-w-0 flex-1 truncate">{data ? (now ?? (status === "loading" ? "Getting the AI ready…" : "Starting…")) : (mine?.progress && mine.progress.details[mine.progress.current]) || "Hang on…"}</span>
                  <span className="shrink-0 font-mono text-[13.5px] tabular-nums text-[var(--muted)]">
                    {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
                  </span>
                </p>
              )}
            </section>

            {data && (
              <p className="mt-6 text-[14.5px] text-[var(--muted)]">
                {sources.length} source files · {formatLoc(sources.reduce((s, f) => s + f.loc, 0))} lines
                {data.history ? ` · ${data.history.commits.length} commits read` : ""}
              </p>
            )}

            {noAI && session && (
              <div className="mt-6 space-y-4">
                <pre className="w-fit rounded-lg border-2 border-[var(--ink)] px-3 py-2 font-mono text-[14px]">DEEPSEEK_API_KEY=sk-…</pre>
                <p className="text-[14.5px] text-[var(--muted)]">
                  Put it in <code className="font-mono">.env.local</code> and restart the server.
                </p>
                <button onClick={session.showOwnResults} className="k-btn k-btn-yellow k-btn-press">
                  Show Kosmos&apos;s own results
                </button>
              </div>
            )}

            {failed && session && (
              <div className="mt-6 flex flex-wrap gap-3">
                <button onClick={session.retryPass} className="k-btn k-btn-yellow k-btn-press">
                  Try again
                </button>
                <button onClick={session.showWhatsReady} className="k-btn">
                  Open the map anyway
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
