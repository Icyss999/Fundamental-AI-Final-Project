import { useEffect, useMemo, useState } from "react";
import type { UserRepo } from "@/lib/repo/github";
import { Icon, Spinner, timeAgo } from "./ui";

/** Searchable list of the signed-in user's repositories. */
export function RepoPicker({ onPick, busy }: { onPick: (url: string) => void; busy: boolean }) {
  const [repos, setRepos] = useState<UserRepo[] | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/github/repos")
      .then(async (r) => {
        const body = await r.json();
        if (cancelled) return;
        if (!r.ok) throw new Error(body.error ?? "Could not load your repositories.");
        setRepos(body.repos);
        setLoadedAt(Date.now());
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (repos ?? []).filter((r) => !q || r.fullName.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q));
  }, [repos, query]);

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)]">
      <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-[13px] font-semibold">Your repositories</h2>
        {repos && <span className="text-[12px] text-[var(--muted)]">{repos.length}</span>}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          className="ml-auto h-8 w-44 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 text-[13px] outline-none focus:border-[var(--accent)]"
        />
      </header>
      <div className="max-h-[264px] overflow-y-auto">
        {error ? (
          <p className="px-4 py-6 text-center text-[13px] text-[var(--danger)]">{error}</p>
        ) : !repos ? (
          <p className="flex items-center justify-center gap-2 px-4 py-6 text-[13px] text-[var(--muted)]">
            <Spinner className="h-4 w-4" /> Loading your repositories…
          </p>
        ) : shown.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-[var(--muted)]">No repositories match.</p>
        ) : (
          <ul>
            {shown.map((r) => (
              <li key={r.fullName} className="border-b border-[var(--border)] last:border-0">
                <button
                  disabled={busy}
                  onClick={() => onPick(`https://github.com/${r.fullName}`)}
                  className="group flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--hover)] disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13.5px] font-medium">{r.fullName}</span>
                      {r.private && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--border)] px-1.5 text-[10.5px] text-[var(--muted)]">
                          <Icon.Lock className="h-2.5 w-2.5" /> Private
                        </span>
                      )}
                    </span>
                    {r.description && <span className="mt-0.5 block truncate text-[12px] text-[var(--muted)]">{r.description}</span>}
                  </span>
                  <span className="hidden shrink-0 text-right text-[11.5px] text-[var(--muted)] sm:block">
                    {r.language && <span className="block">{r.language}</span>}
                    {r.pushedAt && <span className="block">{timeAgo(r.pushedAt, loadedAt)}</span>}
                  </span>
                  <Icon.Arrow className="h-4 w-4 shrink-0 text-[var(--muted)] opacity-0 transition group-hover:opacity-100" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
