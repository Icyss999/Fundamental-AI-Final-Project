import type { ReactNode } from "react";
import { Icon } from "@/components/app/ui";

/** Building blocks shared by the side panels (map details, Bug risk, Refactor, project). */

export function Heading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between gap-2">
      <h3 className="font-letter text-[17px] font-extrabold leading-tight">{children}</h3>
      {action}
    </div>
  );
}

export function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border-2 border-[var(--ink)] px-3 py-2">
      <div className="text-[19px] font-bold tabular-nums leading-tight">{value}</div>
      <div className="text-[12.5px] text-[var(--muted)]">{label}</div>
    </div>
  );
}

/** File name first, then its folder (truncated first when space runs out). */
export function FileRow({ file, meta, onClick, children }: { file: string; meta?: ReactNode; onClick: () => void; children?: ReactNode }) {
  const slash = file.lastIndexOf("/");
  return (
    <button onClick={onClick} className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--hover)]" title={file}>
      {children}
      <span className="shrink-0 font-mono text-[14px] font-bold">{file.slice(slash + 1)}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-[var(--muted)]">{slash === -1 ? "" : file.slice(0, slash)}</span>
      {meta !== undefined && <span className="shrink-0 text-[13px] tabular-nums text-[var(--muted)]">{meta}</span>}
    </button>
  );
}

/** Small secondary button used in panel headers and rows. */
export function PanelButton({ className = "", ...props }: React.ComponentProps<"button">) {
  return <button {...props} className={`k-btn k-btn-small ${className}`} />;
}

export function Note({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "danger" | "warn" }) {
  const color = tone === "danger" ? "text-[var(--danger)]" : tone === "warn" ? "text-[var(--warn)]" : "text-[var(--muted)]";
  return <p className={`text-[14px] leading-relaxed ${color}`}>{children}</p>;
}

/** Hands a question about this item to the AI assistant. */
export function AskButton({ className = "", children, ...props }: React.ComponentProps<"button">) {
  return (
    <button {...props} className={`k-btn k-btn-small !border-[var(--ai)] !text-[var(--ai)] ${className}`}>
      <Icon.Sparkle className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

/** The technical side of a result (the maths, the search, the proof), folded away for those who want it. */
export function Details({ children, label = "How was this worked out?" }: { children: ReactNode; label?: string }) {
  return (
    <details className="group mt-3 rounded-lg border-2 border-dashed border-[var(--border)] px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[14px] font-bold text-[var(--muted)] hover:text-[var(--foreground)] [&::-webkit-details-marker]:hidden">
        <span className="text-[10px] transition-transform group-open:rotate-90" aria-hidden>
          ▶
        </span>
        {label}
      </summary>
      <div className="mt-2 space-y-2 text-[13.5px] leading-relaxed">{children}</div>
    </details>
  );
}
