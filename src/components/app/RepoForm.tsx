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
      className={`flex w-full gap-2 ${lg ? "max-sm:flex-col sm:items-center" : "items-center"}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        if (value.trim()) onSubmit(value.trim());
        else e.currentTarget.querySelector("input")?.focus();
      }}
    >
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">GitHub repository</span>
        <Icon.GitHub className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-[var(--muted)] ${lg ? "left-4 h-5 w-5" : "left-3 h-4 w-4"}`} />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={lg ? "github.com/owner/repo" : "owner/repo or a GitHub link"}
          spellCheck={false}
          autoComplete="off"
          className={`w-full rounded-[10px] border-[2.5px] border-[var(--ink)] bg-[var(--paper)] text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus-visible:shadow-[3px_3px_0_var(--cyan)] focus-visible:outline-none ${lg ? "h-14 pl-12 pr-4 text-[17px]" : "h-10 pl-9 pr-3 text-[15px]"}`}
        />
      </label>
      <button type="submit" disabled={busy} className={`k-btn k-btn-yellow k-btn-press shrink-0 ${lg ? "!h-14 !rounded-[10px] !px-6 !text-[17px]" : ""}`}>
        {busy && <Spinner className={lg ? "h-5 w-5" : "h-4 w-4"} />}
        {busy ? "Drawing…" : lg ? "Draw the map" : "Draw it"}
      </button>
    </form>
  );
}
