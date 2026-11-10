import { Icon, Spinner } from "./ui";

export function RepoForm({
  value,
  onChange,
  onSubmit,
  busy,
  size = "md",
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  busy: boolean;
  size?: "md" | "lg";
}) {
  const lg = size === "lg";
  return (
    <form
      className="flex w-full items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim() && !busy) onSubmit(value.trim());
      }}
    >
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">GitHub repository URL</span>
        <Icon.GitHub className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-[var(--muted)] ${lg ? "left-4 h-5 w-5" : "left-3 h-4 w-4"}`} />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://github.com/owner/repo"
          spellCheck={false}
          autoComplete="off"
          className={`w-full rounded-xl border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-4 focus:ring-[color:var(--accent-soft)] ${lg ? "h-14 pl-12 pr-4 text-[15px]" : "h-9 pl-9 pr-3 text-[13px]"}`}
        />
      </label>
      <button
        type="submit"
        disabled={busy || !value.trim()}
        className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] font-medium text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-50 ${lg ? "h-14 px-6 text-[15px]" : "h-9 px-4 text-[13px]"}`}
      >
        {busy && <Spinner className={lg ? "h-5 w-5" : "h-4 w-4"} />}
        {busy ? "Analyzing" : "Analyze"}
      </button>
    </form>
  );
}
