import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { GitHubSession } from "./useGitHubSession";
import { Icon } from "./ui";

/** "Sign in with GitHub", or the signed-in user's avatar with a small menu. */
export function AccountButton({
  session,
  onSignIn,
  onSignOut,
  onChooseRepo,
  compact = false,
}: {
  session: GitHubSession;
  onSignIn: () => void;
  onSignOut: () => void;
  onChooseRepo?: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (session.status === "loading") return <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-[var(--hover)]" />;

  const { user } = session;
  const button = compact ? "k-btn-small" : "";

  if (!user) {
    const signIn = (
      <span className={`k-btn shrink-0 ${button}`}>
        <Icon.GitHub className="h-4 w-4" />
        Sign in{compact ? "" : " with GitHub"}
      </span>
    );
    if (session.configured) {
      return (
        <button onClick={onSignIn} className="shrink-0">
          {signIn}
        </button>
      );
    }
    // Not configured yet: explain the one-time setup instead of sending people to a broken page.
    return (
      <div ref={ref} className="relative shrink-0">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {signIn}
        </button>
        {open && (
          <div className="k-fade absolute right-0 top-full z-50 mt-2.5 w-80 rounded-xl border-[2.5px] border-[var(--ink)] bg-[var(--panel)] p-4 text-[14px] leading-relaxed shadow-[4px_4px_0_var(--ink)]">
            <p className="font-letter text-[17px] font-extrabold">GitHub sign-in isn&apos;t set up yet</p>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-[var(--muted)]">
              <li>
                Create an OAuth App at <span className="font-mono text-[12px]">github.com/settings/developers</span> with callback URL{" "}
                <span className="break-all font-mono text-[12px] text-[var(--foreground)]">{typeof window === "undefined" ? "" : window.location.origin}/api/auth/callback/github</span>
              </li>
              <li>
                Put <span className="font-mono text-[12px]">GITHUB_CLIENT_ID</span> and <span className="font-mono text-[12px]">GITHUB_CLIENT_SECRET</span> in{" "}
                <span className="font-mono text-[12px]">.env.local</span>
              </li>
              <li>Restart the dev server.</li>
            </ol>
            <p className="mt-2 text-[13px] text-[var(--muted)]">Public repositories work without signing in.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border-2 border-[var(--ink)] bg-[var(--panel)] py-0.5 pl-0.5 pr-2.5 text-[14px] font-bold hover:bg-[var(--hover)]"
        title={`Signed in as ${user.login}`}
      >
        {user.avatarUrl ? (
          <Image src={user.avatarUrl} alt="" width={28} height={28} className="h-7 w-7 rounded-full" />
        ) : (
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--hover)]">
            <Icon.GitHub className="h-4 w-4" />
          </span>
        )}
        {!compact && <span>{user.login}</span>}
        <svg className="h-3 w-3 text-[var(--muted)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="k-fade absolute right-0 top-full z-50 mt-2.5 w-64 overflow-hidden rounded-xl border-[2.5px] border-[var(--ink)] bg-[var(--panel)] text-[14px] shadow-[4px_4px_0_var(--ink)]" role="menu">
          <div className="border-b-2 border-dashed border-[var(--border)] px-4 py-3">
            <p className="font-bold">{user.name ?? user.login}</p>
            <p className="text-[13px] text-[var(--muted)]">@{user.login} · connected to GitHub</p>
          </div>
          {onChooseRepo && (
            <button role="menuitem" onClick={() => { setOpen(false); onChooseRepo(); }} className="block w-full px-4 py-2.5 text-left hover:bg-[var(--hover)]">
              Choose another repository
            </button>
          )}
          <a role="menuitem" href={`https://github.com/${user.login}`} target="_blank" rel="noreferrer" className="flex items-center justify-between px-4 py-2.5 hover:bg-[var(--hover)]">
            Your GitHub profile
            <Icon.External className="h-3.5 w-3.5 text-[var(--muted)]" />
          </a>
          <button role="menuitem" onClick={() => { setOpen(false); onSignOut(); }} className="block w-full border-t-2 border-dashed border-[var(--border)] px-4 py-2.5 text-left font-bold text-[var(--danger)] hover:bg-[var(--hover)]">
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
