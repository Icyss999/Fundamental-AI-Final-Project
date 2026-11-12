"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { fetchAssistantStatus } from "@/components/assistant/client";
import { AccountButton } from "./AccountButton";
import { RepoForm } from "./RepoForm";
import { RepoPicker } from "./RepoPicker";
import { analyzeHref, mapHref } from "./routes";
import { useOptionalProject, useRun } from "./session";
import { Icon, Logo, Wordmark } from "./ui";

const EXAMPLES: { label: string; hint: string; source: string }[] = [
  { label: "pmndrs/zustand", hint: "state", source: "https://github.com/pmndrs/zustand" },
  { label: "sindresorhus/ky", hint: "HTTP", source: "https://github.com/sindresorhus/ky" },
  { label: "vercel/swr", hint: "data fetching", source: "https://github.com/vercel/swr" },
  { label: "shadcn-ui/taxonomy", hint: "Next.js app", source: "https://github.com/shadcn-ui/taxonomy" },
];

/** A greeting that follows the visitor's clock (rendered only in the browser, so it never mismatches). */
function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Up late?" : h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening.";
}
const noSubscribe = () => () => {};

/** What you get, drawn small: rows of parts, a loop, and a shelf everyone uses. */
function CoverMap() {
  const box = (label: string, color: string, extra = "") => (
    <span className={`flex h-11 items-center rounded-[8px] border-[2.5px] border-[var(--ink)] px-3 text-[14px] font-bold ${extra}`} style={{ background: `color-mix(in srgb, var(${color}) 28%, var(--module-bg))` }}>
      {label}
    </span>
  );
  return (
    <figure className="relative rounded-[6px] border-[2.5px] border-[var(--ink)] bg-[var(--canvas)] p-5 pt-12 shadow-[6px_6px_0_var(--ink)]" aria-label="An example map: pages on top, then components, then services and state in a loop, with data and lib on a shelf at the bottom">
      <figcaption className="font-letter absolute -top-3.5 left-5 rounded-[4px] border-[2.5px] border-[var(--on-yel)] bg-[var(--yel)] px-3 py-1 text-[15px] font-extrabold text-[var(--on-yel)]">
        Here&apos;s how your project fits together.
      </figcaption>
      <div className="flex flex-col items-center gap-5" aria-hidden>
        {box("pages", "--c0", "w-32 justify-center")}
        <svg className="-my-4 h-5 w-3 text-[var(--ink)]" viewBox="0 0 12 20">
          <path d="M6 0v14M1 11l5 7 5-7" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        {box("components", "--c1", "w-40 justify-center")}
        <svg className="-my-4 h-5 w-3 text-[var(--ink)]" viewBox="0 0 12 20">
          <path d="M6 0v14M1 11l5 7 5-7" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        <div className="flex items-center gap-1">
          {box("services", "--c3")}
          <span className="flex flex-col items-center px-1 text-[12px] font-extrabold text-[var(--red)]">
            loop
            <svg className="h-3 w-12" viewBox="0 0 48 12">
              <path d="M8 6h32M9 1L2 6l7 5M39 1l7 5-7 5" fill="none" stroke="currentColor" strokeWidth="2.5" />
            </svg>
          </span>
          {box("state", "--c2")}
        </div>
      </div>
      <div className="mt-6 flex gap-2 border-t-2 border-dashed border-[var(--border)] pt-4" aria-hidden>
        {box("data", "--c4", "h-9 flex-1 justify-center text-[13px]")}
        {box("lib", "--c5", "h-9 flex-1 justify-center text-[13px]")}
      </div>
      <p className="mt-2 text-center text-[13px] text-[var(--muted)]" aria-hidden>
        shelf: parts most others use
      </p>
    </figure>
  );
}

/** `/`: paste a repository (or pick one) and go to the waiting screen. */
export function Landing() {
  const { input, setInput, github } = useRun();
  const project = useOptionalProject();
  const router = useRouter();
  const onSignIn = github.signIn;
  const onSignOut = github.signOut;
  const error = github.error;
  const onAnalyze = (source: string) => router.push(analyzeHref(source));
  const hello = useSyncExternalStore(noSubscribe, greeting, () => "");
  // Promise the AI's work only when it is set up.
  const [aiReady, setAiReady] = useState(false);
  useEffect(() => {
    let live = true;
    fetchAssistantStatus()
      .then((s) => live && setAiReady(s.configured))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const pick = (url: string) => {
    setInput(url);
    onAnalyze(url);
  };
  return (
    <main className="flex min-h-dvh flex-col bg-[var(--paper)] text-[var(--foreground)]">
      <nav className="flex items-center justify-between px-4 py-4 md:px-8">
        <span className="group/mark flex items-center gap-2.5">
          <Logo className="h-10 w-10" />
          <Wordmark className="text-[26px]" />
        </span>
        <AccountButton session={github} onSignIn={onSignIn} onSignOut={onSignOut} compact />
      </nav>

      <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-4 pb-14 pt-4 md:px-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-16">
        <div className="min-w-0">
          <p className="font-letter min-h-[1.4em] text-[19px] font-bold text-[var(--muted)]">{hello}</p>
          <h1 className="font-letter mt-1 text-[40px] font-extrabold leading-[1.06] tracking-[-0.01em] [text-wrap:balance] sm:text-[54px]">Paste a repo. See how it all fits together.</h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-[var(--muted)]">
            {aiReady
              ? "Kosmos reads the code, and its AI sorts the files into named parts, hunts for bugs and plans a safe tidy-up. Then you get one tidy map of what it found."
              : "Kosmos draws the code as one tidy map, tells its story in plain words, shows where bugs likely hide, and plans a safe tidy-up."}
          </p>

          <div className="mt-8 max-w-2xl">
            <RepoForm size="lg" value={input} onChange={setInput} onSubmit={onAnalyze} busy={false} />
          </div>

          {error && (
            <p role="alert" className="mt-4 flex max-w-2xl items-start gap-2 rounded-lg border-2 border-[var(--danger)] px-4 py-3 text-[15px] text-[var(--danger)]">
              <Icon.Alert className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}

          <div className="mt-6 max-w-2xl">
            {project?.ready && (
              <p className="mb-5 text-[15px]">
                <Link href={mapHref("structure", project.repo)} className="k-link text-[15px]">
                  Back to the map of {project.data.overview.name} →
                </Link>
              </p>
            )}
            <div className="space-y-5">
                {github.user && <RepoPicker onPick={pick} busy={false} />}
                <div>
                  <p className="mb-2.5 text-[15px] font-bold">{github.user ? "Or try a public one:" : "Or try one:"}</p>
                  <ul className="flex flex-wrap gap-2">
                    {EXAMPLES.map((ex) => (
                      <li key={ex.source}>
                        <button onClick={() => pick(ex.source)} className="k-btn k-btn-small !h-9 !font-normal">
                          <span className="font-bold">{ex.label}</span>
                          <span className="text-[var(--muted)]">{ex.hint}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                {!github.user && github.status === "ready" && github.configured && (
                  <p className="text-[14.5px] leading-relaxed text-[var(--muted)]">
                    <button onClick={onSignIn} className="k-link text-[14.5px]">
                      Sign in with GitHub
                    </button>{" "}
                    to pick from your own repositories, private ones too.
                  </p>
                )}
            </div>
          </div>
        </div>

        <div className="max-lg:hidden">
          <CoverMap />
        </div>
      </div>

      <p className="mx-auto w-full max-w-6xl px-4 pb-6 text-[13.5px] text-[var(--muted)] md:px-8">
        Reads JavaScript, TypeScript, Python, Java, Go, Rust, C#, PHP, Ruby and more. The code is downloaded and read, never run.
      </p>
    </main>
  );
}
