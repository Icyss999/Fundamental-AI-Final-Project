import type { ReactNode } from "react";
import { Icon } from "@/components/app/ui";

/** Building blocks shared by the diagram's side panels (Inspector, Bug risk, Refactor). */

export function Heading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-1.5 mt-5 flex items-center justify-between gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{children}</h3>
      {action}
    </div>
  );
}

export function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-[var(--hover)] px-2.5 py-2">
      <div className="text-[15px] font-semibold tabular-nums leading-tight">{value}</div>
      <div className="text-[11px] text-[var(--muted)]">{label}</div>
    </div>
  );
}

/** File name first, then its folder (truncated first when space runs out). */
export function FileRow({ file, meta, onClick, children }: { file: string; meta?: ReactNode; onClick: () => void; children?: ReactNode }) {
  const slash = file.lastIndexOf("/");
  return (
    <button onClick={onClick} className="flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left hover:bg-[var(--hover)]" title={file}>
      {children}
      <span className="shrink-0 font-mono text-[12px]">{file.slice(slash + 1)}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--muted)]">{slash === -1 ? "" : file.slice(0, slash)}</span>
      {meta !== undefined && <span className="shrink-0 text-[11px] tabular-nums text-[var(--muted)]">{meta}</span>}
    </button>
  );
}

/** Small secondary button used in panel headers and toolbars. */
export function PanelButton({ className = "", ...props }: React.ComponentProps<"button">) {
  return (
    <button
      {...props}
      className={`rounded-md border border-[var(--border)] px-2 py-0.5 text-[11.5px] font-medium hover:bg-[var(--hover)] disabled:pointer-events-none disabled:opacity-40 ${className}`}
    />
  );
}

export function Note({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "danger" | "warn" }) {
  const color = tone === "danger" ? "text-[var(--danger)]" : tone === "warn" ? "text-[var(--warn)]" : "text-[var(--muted)]";
  return <p className={`px-0.5 text-[12px] leading-relaxed ${color}`}>{children}</p>;
}

/** Hands a question about this item to the AI assistant. */
export function AskButton({ className = "", children, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-1 rounded-md bg-[var(--ai-soft)] px-2 py-0.5 text-[11.5px] font-medium text-[var(--ai)] hover:brightness-95 disabled:pointer-events-none disabled:opacity-40 dark:hover:brightness-125 ${className}`}
    >
      <Icon.Sparkle className="h-3 w-3" />
      {children}
    </button>
  );
}
