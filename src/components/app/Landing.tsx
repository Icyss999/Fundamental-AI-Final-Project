import type { AnalyzeStep } from "@/lib/analyze";
import { AccountButton } from "./AccountButton";
import { RepoForm } from "./RepoForm";
import { RepoPicker } from "./RepoPicker";
import { Icon, Logo, Spinner } from "./ui";
import type { GitHubSession } from "./useGitHubSession";

export interface Progress {
  source: string;
  current: AnalyzeStep;
  details: Partial<Record<AnalyzeStep, string>>;
}

const STEPS: { id: AnalyzeStep; label: string }[] = [
  { id: "resolve", label: "Finding the repository" },
  { id: "download", label: "Downloading the code" },
  { id: "extract", label: "Reading every import" },
  { id: "history", label: "Reading the git history" },
  { id: "summarize", label: "Summarizing the project" },
];

export const EXAMPLES: { label: string; hint: string; source: string }[] = [
  { label: "pmndrs/zustand", hint: "State management", source: "https://github.com/pmndrs/zustand" },
  { label: "sindresorhus/ky", hint: "HTTP client", source: "https://github.com/sindresorhus/ky" },
  { label: "shadcn-ui/taxonomy", hint: "Next.js app", source: "https://github.com/shadcn-ui/taxonomy" },
  { label: "vercel/swr", hint: "React data fetching", source: "https://github.com/vercel/swr" },
];

export const SAMPLE_SOURCE = "sample";

export function StepList({ progress }: { progress: Progress }) {
  const steps = progress.source === SAMPLE_SOURCE ? STEPS.slice(2) : STEPS;
  const currentIndex = steps.findIndex((s) => s.id === progress.current);
  return (
    <ol className="space-y-2.5">
      {steps.map((step, i) => {
        const state = i < currentIndex ? "done" : i === currentIndex ? "active" : "todo";
        return (
          <li key={step.id} className="flex items-center gap-3 text-[14px]">
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${
                state === "done"
                  ? "bg-[var(--accent)] text-white"
                  : state === "active"
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border border-[var(--border)] text-[var(--muted)]"
              }`}
            >
              {state === "done" ? <Icon.Check className="h-3.5 w-3.5" /> : state === "active" ? <Spinner className="h-3.5 w-3.5" /> : <span className="text-[11px]">{i + 1}</span>}
            </span>
            <span className={state === "todo" ? "text-[var(--muted)]" : "text-[var(--foreground)]"}>{step.label}</span>
            {progress.details[step.id] && <span className="truncate text-[12px] text-[var(--muted)]">{progress.details[step.id]}</span>}
          </li>
        );
      })}
    </ol>
  );
}

const FEATURES = [
  { title: "Project overview", text: "What the project is, what it's built with, and how big each part is." },
  { title: "Architecture diagram", text: "Folders become modules you can open, rearrange and trace imports through." },
  { title: "Health checks", text: "Import cycles and over-depended-on files, pointed out on the map." },
];

export function Landing({
  input,
  onInputChange,
  onAnalyze,
  progress,
  error,
  github,
  onSignIn,
  onSignOut,
}: {
  input: string;
  onInputChange: (v: string) => void;
  onAnalyze: (source: string) => void;
  progress: Progress | null;
  error: string | null;
  github: GitHubSession;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const pick = (url: string) => {
    onInputChange(url);
    onAnalyze(url);
  };
  return (
    <main className="flex min-h-dvh flex-col bg-[var(--background)] text-[var(--foreground)]">
      <nav className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <Logo className="h-8 w-8" />
          <span className="text-[15px] font-semibold tracking-tight">Architecture Mapper</span>
        </div>
        <AccountButton session={github} onSignIn={onSignIn} onSignOut={onSignOut} />
      </nav>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 pb-16 pt-6">
        <h1 className="text-[34px] font-semibold leading-[1.15] tracking-tight sm:text-[40px]">
          See how any codebase
          <br />
          fits together.
        </h1>
        <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-[var(--muted)]">
          Paste a GitHub repository. You get a plain-language overview of the project and a clean, interactive map of
          how its code is organised — and where it&apos;s tangled.
        </p>

        <div className="mt-8">
          <RepoForm size="lg" value={input} onChange={onInputChange} onSubmit={onAnalyze} busy={progress !== null} />
        </div>

        {error && (
          <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-3 text-[14px] text-[var(--danger)]">
            <Icon.Alert className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="mt-6 min-h-[132px]">
          {progress ? (
            <StepList progress={progress} />
          ) : (
            <div className="space-y-6">
              {github.user ? (
                <RepoPicker onPick={pick} busy={progress !== null} />
              ) : (
                github.status === "ready" && (
                  <div className="flex items-center gap-4 rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--hover)]">
                      <Icon.GitHub className="h-5 w-5" />
                    </span>
                    <p className="flex-1 text-[13px] leading-relaxed text-[var(--muted)]">
                      <span className="font-medium text-[var(--foreground)]">Connect your GitHub</span> to pick from your own
                      repositories — private ones included — and open any file straight on GitHub.
                    </p>
                    <AccountButton session={github} onSignIn={onSignIn} onSignOut={onSignOut} compact />
                  </div>
                )
              )}
              <div>
              <p className="mb-2.5 text-[12px] font-medium uppercase tracking-wider text-[var(--muted)]">{github.user ? "Or try a public one" : "Try one"}</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.source}
                    onClick={() => pick(ex.source)}
                    className="group inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--panel)] px-3.5 py-1.5 text-[13px] transition hover:border-[var(--accent)]"
                  >
                    <Icon.GitHub className="h-3.5 w-3.5 text-[var(--muted)] group-hover:text-[var(--foreground)]" />
                    <span className="font-medium">{ex.label}</span>
                    <span className="text-[var(--muted)]">{ex.hint}</span>
                  </button>
                ))}
                <button
                  onClick={() => onAnalyze(SAMPLE_SOURCE)}
                  className="inline-flex items-center gap-2 rounded-full border border-dashed border-[var(--border)] px-3.5 py-1.5 text-[13px] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--foreground)]"
                  title="A small built-in project with planted architecture problems"
                >
                  Built-in sample project
                </button>
              </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-10 grid gap-4 border-t border-[var(--border)] pt-8 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title}>
              <h3 className="text-[13px] font-semibold">{f.title}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">{f.text}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-[12px] text-[var(--muted)]">
          Works with repositories in JavaScript/TypeScript, Python, Java, Kotlin, Go, Rust, C/C++, C#, PHP, Ruby, Swift, Dart
          and more — public ones right away, private ones after you sign in. The code is downloaded and read, never run, and
          your GitHub token stays on the server.
        </p>
      </div>
    </main>
  );
}
