import type { SVGProps } from "react";

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

type IconProps = SVGProps<SVGSVGElement>;
const base = { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const Icon = {
  GitHub: (p: IconProps) => (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden {...p}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  ),
  Star: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M8 1.75l1.93 3.9 4.32.63-3.12 3.05.73 4.3L8 11.6l-3.86 2.03.73-4.3L1.75 6.28l4.32-.63L8 1.75z" />
    </svg>
  ),
  Fork: (p: IconProps) => (
    <svg {...base} {...p}>
      <circle cx="4" cy="3" r="1.5" />
      <circle cx="12" cy="3" r="1.5" />
      <circle cx="8" cy="13" r="1.5" />
      <path d="M4 4.5v1A2.5 2.5 0 0 0 6.5 8h3A2.5 2.5 0 0 0 12 5.5v-1M8 8v3.5" />
    </svg>
  ),
  Scale: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M8 2v12M4 14h8M2.5 5h11M4.5 5L2.5 9.5a2 2 0 0 0 4 0L4.5 5zM11.5 5l-2 4.5a2 2 0 0 0 4 0L11.5 5z" />
    </svg>
  ),
  Clock: (p: IconProps) => (
    <svg {...base} {...p}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  ),
  Branch: (p: IconProps) => (
    <svg {...base} {...p}>
      <circle cx="4.5" cy="3" r="1.5" />
      <circle cx="4.5" cy="13" r="1.5" />
      <circle cx="11.5" cy="5" r="1.5" />
      <path d="M4.5 4.5v7M11.5 6.5c0 3-7 2.5-7 5" />
    </svg>
  ),
  External: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M9.5 2.5h4v4M13.5 2.5L7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" />
    </svg>
  ),
  Close: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  ),
  Check: (p: IconProps) => (
    <svg {...base} strokeWidth={2} {...p}>
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  ),
  Arrow: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  ),
  Lock: (p: IconProps) => (
    <svg {...base} {...p}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  ),
  Code: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />
    </svg>
  ),
  Sparkle: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M8 1.75l1.4 3.6a2 2 0 0 0 1.25 1.25L14.25 8l-3.6 1.4a2 2 0 0 0-1.25 1.25L8 14.25l-1.4-3.6A2 2 0 0 0 5.35 9.4L1.75 8l3.6-1.4A2 2 0 0 0 6.6 5.35L8 1.75z" />
    </svg>
  ),
  Send: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
    </svg>
  ),
  Stop: (p: IconProps) => (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden {...p}>
      <rect x="4" y="4" width="8" height="8" rx="1.5" />
    </svg>
  ),
  Copy: (p: IconProps) => (
    <svg {...base} {...p}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </svg>
  ),
  Plus: (p: IconProps) => (
    <svg {...base} strokeWidth={2} {...p}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  ),
  Info: (p: IconProps) => (
    <svg {...base} {...p}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v4M8 4.75v.01" strokeWidth={2} />
    </svg>
  ),
  /** A speech balloon: talking to Kosmos. */
  Balloon: (p: IconProps) => (
    <svg {...base} strokeWidth={1.8} {...p}>
      <path d="M4 2.5h8A2.5 2.5 0 0 1 14.5 5v4A2.5 2.5 0 0 1 12 11.5H7.5L4 14.25l.75-2.75H4A2.5 2.5 0 0 1 1.5 9V5A2.5 2.5 0 0 1 4 2.5z" />
    </svg>
  ),
  Alert: (p: IconProps) => (
    <svg {...base} {...p}>
      <path d="M8 1.75L14.5 13.5h-13L8 1.75zM8 6.25v3M8 11.25v.01" />
    </svg>
  ),
};

const BALLOON = "M8 2.5h16a5.5 5.5 0 0 1 5.5 5.5v10a5.5 5.5 0 0 1-5.5 5.5H14.5l-7 6 1.6-6H8A5.5 5.5 0 0 1 2.5 18V8A5.5 5.5 0 0 1 8 2.5z";

/**
 * The Kosmos mark: a speech balloon holding a tidy 2×2 grid (kosmos: order), one square inked in.
 * Inside a `group/mark` element, hovering slips a cyan plate out from behind, like a misprinted panel.
 */
export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg className={`overflow-visible ${className}`} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d={BALLOON}
        fill="var(--cyan)"
        className="transition-transform duration-200 ease-[var(--ease-out)] group-hover/mark:translate-x-[2.5px] group-hover/mark:translate-y-[2.5px] motion-reduce:transition-none"
      />
      <path d={BALLOON} fill="var(--yel)" stroke="var(--on-yel)" strokeWidth="2.2" strokeLinejoin="round" />
      <rect x="9.5" y="6.5" width="5.6" height="5.6" rx="1.2" fill="var(--on-yel)" />
      <rect x="16.9" y="6.5" width="5.6" height="5.6" rx="1.2" fill="#fff" stroke="var(--on-yel)" strokeWidth="1.7" />
      <rect x="9.5" y="13.9" width="5.6" height="5.6" rx="1.2" fill="#fff" stroke="var(--on-yel)" strokeWidth="1.7" />
      <rect x="16.9" y="13.9" width="5.6" height="5.6" rx="1.2" fill="#fff" stroke="var(--on-yel)" strokeWidth="1.7" />
    </svg>
  );
}

/** The name, lettered. */
export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={`font-letter font-extrabold tracking-[-0.01em] ${className}`}>Kosmos</span>;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function timeAgo(iso: string, now: number): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  const units: [number, string][] = [[31536000, "year"], [2592000, "month"], [604800, "week"], [86400, "day"], [3600, "hour"], [60, "minute"]];
  for (const [secs, unit] of units) {
    const v = Math.floor(s / secs);
    if (v >= 1) return `${v} ${unit}${v === 1 ? "" : "s"} ago`;
  }
  return "just now";
}
