"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { DiagramMode } from "@/components/mapper/DiagramView";
import type { ProjectOverview } from "@/lib/repo/overview";
import { AccountButton } from "./AccountButton";
import { RepoForm } from "./RepoForm";
import { analyzeHref, mapHref } from "./routes";
import { useRun } from "./session";
import { Icon, Logo, Spinner, Wordmark } from "./ui";

export type PanelId = "mode" | "project" | "ai";

/** Per mode: the AI is working on it, has a result the user has not seen, or could not finish it. */
export type TabBadges = Partial<Record<DiagramMode, "working" | "new" | "failed">>;

function TabBadge({ badge }: { badge?: "working" | "new" | "failed" }) {
  if (badge === "working")
    return (
      <span title="The AI is working on this">
        <Spinner className="h-3.5 w-3.5" />
        <span className="sr-only"> (the AI is working on this)</span>
      </span>
    );
  if (badge === "new")
    return (
      <span title="New from the AI" className="h-2.5 w-2.5 rounded-full border-[1.5px] border-[var(--ink)] bg-[var(--cyan)]">
        <span className="sr-only"> (new from the AI)</span>
      </span>
    );
  if (badge === "failed")
    return (
      <span title="The AI couldn't finish this">
        <Icon.Alert className="h-3.5 w-3.5 text-[var(--warn)]" />
        <span className="sr-only"> (the AI couldn&apos;t finish this)</span>
      </span>
    );
  return null;
}

export const MODES: { id: DiagramMode; label: string; hint: string; icon: ReactNode }[] = [
  {
    id: "structure",
    label: "Structure",
    hint: "How the code is organised",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
        <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" fill="currentColor" />
        <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" />
        <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" />
        <rect x="9" y="9" width="5.5" height="5.5" rx="1" />
      </svg>
    ),
  },
  {
    id: "risk",
    label: "Bug risk",
    hint: "Where the AI found bugs, and where they most likely hide",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        <circle cx="3" cy="3" r="1" />
        <circle cx="8" cy="3" r="1.5" />
        <circle cx="13" cy="3" r="2" />
        <circle cx="3" cy="8" r="1.5" />
        <circle cx="8" cy="8" r="2" />
        <circle cx="13" cy="8" r="2.4" />
        <circle cx="3" cy="13" r="2" />
        <circle cx="8" cy="13" r="2.4" />
        <circle cx="13" cy="13" r="2.6" />
      </svg>
    ),
  },
  {
    id: "refactor",
    label: "Refactor",
    hint: "The AI's plan for a safe tidy-up",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M2 5h9M8 2l3 3-3 3M14 11H5M8 8l-3 3 3 3" />
      </svg>
    ),
  },
];

/** The three map pages as tabs: each is its own route, sharing the map. */
function ModeTabs({ mode, repo, onMode, badges = {}, className = "" }: { mode: DiagramMode; repo: string; onMode: (m: DiagramMode) => void; badges?: TabBadges; className?: string }) {
  const router = useRouter();
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = MODES.findIndex((m) => m.id === mode);
    const next = MODES[(i + (e.key === "ArrowRight" ? 1 : MODES.length - 1)) % MODES.length];
    onMode(next.id);
    router.push(mapHref(next.id, repo));
    e.currentTarget.querySelector<HTMLElement>(`[data-mode="${next.id}"]`)?.focus();
  };
  return (
    <div role="tablist" aria-label="What the map shows" onKeyDown={onKey} className={`flex gap-1 rounded-[10px] border-2 border-[var(--ink)] bg-[var(--paper)] p-[3px] ${className}`}>
      {MODES.map((m, i) => (
        <Link
          key={m.id}
          href={mapHref(m.id, repo)}
          role="tab"
          data-mode={m.id}
          aria-selected={mode === m.id}
          tabIndex={mode === m.id ? 0 : -1}
          onClick={() => onMode(m.id)}
          title={`${m.hint} (${i + 1})`}
          aria-keyshortcuts={String(i + 1)}
          className="k-tab max-md:flex-1 max-md:justify-center max-md:px-2"
        >
          {m.icon}
          {m.label}
          <TabBadge badge={badges[m.id]} />
        </Link>
      ))}
    </div>
  );
}

/** "New repo": the repository box in a popover, so the header stays quiet. */
function NewRepo() {
  const { input, setInput } = useRun();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    pop.current?.querySelector<HTMLElement>("input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        button.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!pop.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div className="relative">
      <button ref={button} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog" className="k-btn k-btn-small max-lg:!w-9 max-lg:!px-0" title="Open another repository">
        <Icon.Plus className="h-4 w-4" />
        <span className="max-lg:sr-only">New repo</span>
      </button>
      {open && (
        <div
          ref={pop}
          role="dialog"
          aria-label="Open another repository"
          className="k-fade absolute right-0 top-[calc(100%+10px)] z-50 w-[min(440px,calc(100vw-24px))] rounded-xl border-[2.5px] border-[var(--ink)] bg-[var(--panel)] p-4 shadow-[5px_5px_0_var(--ink)]"
        >
          <p className="font-letter mb-2.5 text-[18px] font-extrabold">Map another repository</p>
          <RepoForm
            value={input}
            onChange={setInput}
            onSubmit={(v) => {
              setOpen(false);
              router.push(analyzeHref(v));
            }}
            busy={false}
          />
          <p className="mt-2.5 text-[13.5px] text-[var(--muted)]">A GitHub link, owner/repo, or a link to one folder.</p>
          <Link href="/" onClick={() => setOpen(false)} className="k-link mt-3 inline-block text-[14px]">
            Back to the start page
          </Link>
        </div>
      )}
    </div>
  );
}

export function WorkspaceHeader({
  overview,
  mode,
  repo,
  onMode,
  panel,
  onTogglePanel,
  badges,
}: {
  overview: ProjectOverview;
  mode: DiagramMode;
  /** The `?repo=` every map page carries. */
  repo: string;
  /** Called as a mode tab is chosen (the link itself navigates). */
  onMode: (m: DiagramMode) => void;
  panel: PanelId | null;
  onTogglePanel: (p: PanelId) => void;
  badges?: TabBadges;
}) {
  const { github } = useRun();
  const router = useRouter();
  const source = overview.source;
  return (
    <header className="relative shrink-0 px-3 pt-3 md:px-5">
      <div className="flex h-12 items-center gap-2 md:gap-3">
        <Link href="/" className="group/mark flex shrink-0 items-center gap-2 rounded-lg pr-1" title="Kosmos: back to the start page">
          <Logo className="h-9 w-9" />
          <Wordmark className="hidden text-[22px] lg:inline" />
        </Link>
        <button
          onClick={() => onTogglePanel("project")}
          aria-expanded={panel === "project"}
          title="About this project"
          className={`flex min-w-0 items-center gap-1.5 rounded-lg border-2 px-2.5 py-1 text-left transition-colors xl:max-w-[calc(50vw-390px)] ${panel === "project" ? "border-[var(--ink)] bg-[var(--paper)]" : "border-transparent hover:border-[var(--border)]"}`}
        >
          <span className="min-w-0 truncate text-[15.5px] font-bold">
            {source.kind === "github" && <span className="font-normal text-[var(--muted)] max-sm:hidden">{source.owner}/</span>}
            {overview.name}
          </span>
          {source.kind === "github" && source.private && <Icon.Lock className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" aria-label="Private" />}
          <Icon.Info className="h-4 w-4 shrink-0 text-[var(--muted)]" />
        </button>

        {/* In line from tablet width; centred on the page once there is room. */}
        <ModeTabs mode={mode} repo={repo} onMode={onMode} badges={badges} className="shrink-0 max-md:hidden xl:absolute xl:left-1/2 xl:top-3 xl:-translate-x-1/2" />
        <div className="flex-1" />

        <button
          onClick={() => onTogglePanel("ai")}
          aria-expanded={panel === "ai"}
          className={`k-btn k-btn-small max-lg:!w-9 max-lg:!px-0 ${panel === "ai" ? "!bg-[var(--yel-soft)]" : ""}`}
          title="Ask Kosmos about this code (A)"
          aria-keyshortcuts="A"
        >
          <Icon.Balloon className="h-4 w-4" />
          <span className="max-lg:sr-only">Ask AI</span>
        </button>
        <NewRepo />
        <AccountButton session={github} onSignIn={github.signIn} onSignOut={github.signOut} onChooseRepo={() => router.push("/")} compact />
      </div>
      <ModeTabs mode={mode} repo={repo} onMode={onMode} badges={badges} className="mt-2.5 md:hidden" />
    </header>
  );
}
