"use client";

import { ReactFlowProvider } from "@xyflow/react";
import { useRef, useState } from "react";
import type { AnalysisResult } from "@/lib/analyze";
import { AccountButton } from "./AccountButton";
import { Landing, SAMPLE_SOURCE, type Progress } from "./Landing";
import { ProjectWorkspace, type Tab } from "./ProjectWorkspace";
import { RepoForm } from "./RepoForm";
import { streamAnalysis } from "./stream";
import { useGitHubSession } from "./useGitHubSession";
import { Icon, Logo, Spinner } from "./ui";

const STEP_LABEL: Record<Progress["current"], string> = {
  resolve: "Finding the repository…",
  download: "Downloading the code…",
  extract: "Reading every import…",
  history: "Reading the git history…",
  summarize: "Summarizing the project…",
};

function sourceInputFor(result: AnalysisResult): string {
  const s = result.overview.source;
  if (s.kind !== "github") return "";
  return s.subdir ? `https://github.com/${s.owner}/${s.repo}/tree/${s.branch}/${s.subdir}` : `https://github.com/${s.owner}/${s.repo}`;
}

export function AnalyzerApp() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<{ data: AnalysisResult; id: number; at: number } | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [assistantOpen, setAssistantOpen] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const github = useGitHubSession();

  const analyze = async (source: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setProgress({ source, current: source === SAMPLE_SOURCE ? "extract" : "resolve", details: {} });
    try {
      const data = await streamAnalysis(source, controller.signal, (step, detail) =>
        setProgress((p) => p && { ...p, current: step, details: detail ? { ...p.details, [step]: detail } : p.details }),
      );
      setResult((prev) => ({ data, id: (prev?.id ?? 0) + 1, at: Date.now() }));
      setInput(sourceInputFor(data));
      setTab("overview");
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === controller) setProgress(null);
    }
  };

  const data = result?.data;

  if (!result || !data) {
    return (
      <Landing
        input={input}
        onInputChange={setInput}
        onAnalyze={analyze}
        progress={progress}
        error={error ?? github.error}
        github={github}
        onSignIn={github.signIn}
        onSignOut={github.signOut}
      />
    );
  }

  return (
    <ReactFlowProvider>
      <div className="flex h-dvh flex-col bg-[var(--background)] text-[var(--foreground)]">
        <header className="relative flex h-14 shrink-0 items-center gap-4 border-b border-[var(--border)] bg-[var(--panel)] px-4">
          <button onClick={() => setResult(null)} className="flex shrink-0 items-center gap-2.5" title="Start over">
            <Logo className="h-7 w-7" />
            <span className="hidden text-[14px] font-semibold tracking-tight lg:inline">Architecture Mapper</span>
          </button>
          <span className="hidden h-6 w-px bg-[var(--border)] lg:block" />
          <div className="min-w-0 shrink truncate text-[14px] font-medium" title={data.overview.name}>
            {data.overview.source.kind === "github" ? (
              <span className="inline-flex items-center gap-1.5">
                <Icon.GitHub className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                <span>
                  <span className="text-[var(--muted)]">{data.overview.source.owner}/</span>
                  {data.overview.name}
                </span>
                {data.overview.source.private && (
                  <span title="Private repository" className="text-[var(--muted)]">
                    <Icon.Lock className="h-3.5 w-3.5" />
                  </span>
                )}
              </span>
            ) : (
              data.overview.name
            )}
          </div>

          <nav className="flex shrink-0 rounded-xl bg-[var(--hover)] p-1" aria-label="View">
            {(["overview", "diagram"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                aria-current={tab === t}
                className={`rounded-lg px-3.5 py-1 text-[13px] font-medium transition ${tab === t ? "bg-[var(--panel)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--foreground)]"}`}
              >
                {t === "overview" ? "Overview" : "Diagram"}
              </button>
            ))}
          </nav>

          <button
            onClick={() => setAssistantOpen((v) => !v)}
            aria-pressed={assistantOpen}
            title={assistantOpen ? "Hide the AI assistant" : "Ask the AI assistant about this project"}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-[13px] font-medium transition ${assistantOpen ? "bg-[var(--ai-soft)] text-[var(--ai)]" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]"}`}
          >
            <Icon.Sparkle className="h-4 w-4" />
            AI
          </button>

          <div className="ml-auto flex w-full max-w-[420px] items-center gap-3">
            {progress && (
              <span className="hidden shrink-0 items-center gap-2 text-[12px] text-[var(--muted)] xl:flex">
                <Spinner className="h-3.5 w-3.5" />
                {STEP_LABEL[progress.current]}
              </span>
            )}
            <RepoForm value={input} onChange={setInput} onSubmit={analyze} busy={progress !== null} />
          </div>
          <AccountButton session={github} onSignIn={github.signIn} onSignOut={github.signOut} onChooseRepo={() => setResult(null)} compact />
          {progress && <div className="absolute inset-x-0 bottom-0 h-0.5 animate-pulse bg-[var(--accent)]" />}
        </header>

        {(error ?? github.error) && (
          <div role="alert" className="flex items-center gap-2 border-b border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-2 text-[13px] text-[var(--danger)]">
            <Icon.Alert className="h-4 w-4 shrink-0" />
            <span className="flex-1">{error ?? github.error}</span>
            <button
              onClick={() => {
                setError(null);
                github.dismissError();
              }}
              className="rounded p-1 hover:bg-[var(--danger)]/10"
              title="Dismiss"
            >
              <Icon.Close className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <ProjectWorkspace
          key={result.id}
          data={data}
          analysedAt={result.at}
          tab={tab}
          onTabChange={setTab}
          assistantOpen={assistantOpen}
          onAssistantOpenChange={setAssistantOpen}
        />
      </div>
    </ReactFlowProvider>
  );
}
