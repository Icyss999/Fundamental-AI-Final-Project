import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Icon } from "@/components/app/ui";
import { formatProb, heatBackground } from "@/components/layers/format";
import type { ViewNode } from "@/lib/graph/view";
import { formatLoc } from "./layout";

export type MapperNodeData = {
  view: ViewNode;
  selected: boolean;
  dimmed: boolean;
  /** The file / folder on GitHub at the analysed commit (null for non-GitHub projects). */
  href?: string | null;
  /** Bug risk mode: probability the bug is here, and the shade (0..1, relative to the hottest box). */
  prob?: number;
  heat?: number;
  /** Refactor mode: a plan moved this file (or a file in this module) / the current step touches it. */
  moved?: boolean;
  focus?: boolean;
  /** The AI assistant highlighted this file (or a file in this module). */
  marked?: boolean;
  /** AI review findings in this file / module, and the worst severity. */
  findings?: { count: number; severity: "high" | "medium" | "low" };
};
export type MapperNode = Node<MapperNodeData>;

const hiddenHandle = "!h-1 !w-1 !min-w-0 !min-h-0 !border-0 !bg-transparent";

/** Opens the code on GitHub without selecting, expanding or dragging the node. */
function GitHubLink({ href, title, className = "" }: { href: string; title: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      onClick={(e) => e.stopPropagation()}
      className={`nodrag nopan grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)] ${className}`}
    >
      <Icon.GitHub className="h-3.5 w-3.5" />
    </a>
  );
}
const colorVar = (i: number) => `var(--c${i})`;

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Top} className={hiddenHandle} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} className={hiddenHandle} isConnectable={false} />
    </>
  );
}

export function Badges({ view }: { view: Pick<ViewNode, "inCycle" | "god"> }) {
  if (!view.inCycle && !view.god) return null;
  return (
    <span className="flex shrink-0 gap-1">
      {view.inCycle && (
        <span title="Part of an import cycle" className="rounded bg-[var(--danger-soft)] px-1.5 py-px text-[10px] font-semibold text-[var(--danger)]">
          cycle
        </span>
      )}
      {view.god && (
        <span title="Far more files depend on this than usual" className="rounded bg-[var(--warn-soft)] px-1.5 py-px text-[10px] font-semibold text-[var(--warn)]">
          god
        </span>
      )}
    </span>
  );
}

function stateClass({ selected, dimmed, focus, marked }: MapperNodeData): string {
  return [
    "transition-[opacity,box-shadow,background-color] duration-150",
    dimmed ? "opacity-30" : "opacity-100",
    selected
      ? "ring-2 ring-[color:var(--accent)] ring-offset-2 ring-offset-[color:var(--canvas)]"
      : focus
        ? "ring-2 ring-[color:var(--added)] ring-offset-2 ring-offset-[color:var(--canvas)]"
        : marked
          ? "ring-2 ring-[color:var(--ai)] ring-offset-2 ring-offset-[color:var(--canvas)]"
          : "",
  ].join(" ");
}

/** Probability pill (text stays in ink colours; the box's shade carries the magnitude). */
function RiskPill({ prob }: { prob?: number }) {
  if (prob === undefined) return null;
  return (
    <span title="Probability that the bug is here" className="shrink-0 rounded-full border border-[var(--node-border)] bg-[var(--panel)] px-1.5 py-px text-[10px] font-semibold tabular-nums text-[var(--foreground)]">
      {formatProb(prob)}
    </span>
  );
}

/** AI review findings: count, coloured by the worst severity. */
function FindingsBadge({ findings }: { findings?: MapperNodeData["findings"] }) {
  if (!findings) return null;
  const tone = findings.severity === "high" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : findings.severity === "medium" ? "bg-[var(--warn-soft)] text-[var(--warn)]" : "bg-[var(--hover)] text-[var(--muted)]";
  return (
    <span title={`AI review: ${findings.count} ${findings.count === 1 ? "finding" : "findings"} (worst: ${findings.severity})`} className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-px text-[10px] font-semibold ${tone}`}>
      <Icon.Alert className="h-2.5 w-2.5" />
      {findings.count}
    </span>
  );
}

function MovedBadge({ moved }: { moved?: boolean }) {
  if (!moved) return null;
  return (
    <span title="Moved by the refactoring plan" className="shrink-0 rounded bg-[var(--added-soft)] px-1.5 py-px text-[10px] font-semibold text-[var(--added)]">
      moved
    </span>
  );
}

/** A collapsed module: one card standing for all of its files. Click to expand. */
export function ModuleNode({ data }: NodeProps<MapperNode>) {
  const { view } = data;
  return (
    <div
      className={`group flex h-full w-full cursor-pointer overflow-hidden rounded-xl border bg-[var(--module-bg)] shadow-[0_1px_2px_rgb(0_0_0/0.06)] hover:shadow-[0_4px_14px_rgb(0_0_0/0.10)] ${view.inCycle ? "border-[var(--danger)]" : "border-[var(--node-border)]"} ${stateClass(data)}`}
      style={data.heat !== undefined ? { background: heatBackground(data.heat, "var(--module-bg)") } : undefined}
      title={`${view.label}${view.description ? ` — ${view.description}` : ""}${view.tier !== undefined ? ` (tier ${view.tier})` : ""}\n${view.fileCount} files — click to expand`}
    >
      <Handles />
      <span className="w-1.5 shrink-0" style={{ background: colorVar(view.color) }} />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13.5px] font-semibold tracking-tight text-[var(--foreground)]">{view.label}</span>
          <span className="flex shrink-0 items-center gap-1">
            <MovedBadge moved={data.moved} />
            <FindingsBadge findings={data.findings} />
            {data.prob !== undefined ? <RiskPill prob={data.prob} /> : <Badges view={view} />}
          </span>
        </div>
        <span className="flex items-center justify-between gap-2 text-[11.5px] text-[var(--muted)]">
          <span className="truncate">
            {view.description ?? `${view.fileCount} ${view.fileCount === 1 ? "file" : "files"} · ${formatLoc(view.loc)} lines`}
          </span>
          <svg className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M3 6h10M3 10h10" strokeLinecap="round" />
          </svg>
        </span>
      </div>
    </div>
  );
}

/** An expanded module: a tinted panel around its files. The header button collapses it. */
export function GroupNode({ data }: NodeProps<MapperNode>) {
  const { view } = data;
  const color = colorVar(view.color);
  return (
    <div
      className={`h-full w-full rounded-2xl border ${view.inCycle ? "border-[var(--danger)]" : "border-[var(--node-border)]"} ${stateClass(data)}`}
      style={{ background: `color-mix(in srgb, ${color} 7%, var(--canvas))` }}
      title={view.description ? `${view.label} — ${view.description}${view.tier !== undefined ? ` (tier ${view.tier})` : ""}` : undefined}
    >
      <Handles />
      <div className="flex h-10 items-center gap-2 px-3.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate text-[13px] font-semibold tracking-tight text-[var(--foreground)]">{view.label}</span>
        <span className="shrink-0 text-[11px] text-[var(--muted)]">
          {view.fileCount} {view.fileCount === 1 ? "file" : "files"} · {formatLoc(view.loc)} lines
        </span>
        <RiskPill prob={data.prob} />
        <FindingsBadge findings={data.findings} />
        <span className="flex-1" />
        {data.href && <GitHubLink href={data.href} title="Open this folder on GitHub" />}
        <button
          data-action="collapse"
          className="nodrag flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]"
          title="Collapse module"
        >
          <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M4 10l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Collapse
        </button>
      </div>
    </div>
  );
}

export function FileNode({ data }: NodeProps<MapperNode>) {
  const { view } = data;
  return (
    <div
      className={`group flex h-full w-full cursor-pointer items-center gap-2 rounded-lg border bg-[var(--file-bg)] px-2.5 shadow-[0_1px_1px_rgb(0_0_0/0.04)] ${view.inCycle ? "border-[var(--danger)]" : "border-[var(--node-border)]"} ${stateClass(data)}`}
      style={data.heat !== undefined ? { background: heatBackground(data.heat, "var(--file-bg)") } : undefined}
      title={view.file}
    >
      <Handles />
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colorVar(view.color) }} />
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--foreground)]">{view.label}</span>
      <MovedBadge moved={data.moved} />
      <FindingsBadge findings={data.findings} />
      {data.prob !== undefined ? (
        <RiskPill prob={data.prob} />
      ) : (
        <>
          <Badges view={view} />
          <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--muted)]">{formatLoc(view.loc)}</span>
        </>
      )}
      {data.href && (
        <GitHubLink
          href={data.href}
          title="View source on GitHub"
          className={data.selected ? "" : "opacity-0 transition-opacity group-hover:opacity-100"}
        />
      )}
    </div>
  );
}

// "moduleGroup" rather than "group": React Flow styles its built-in "group" type with its own frame.
export const nodeTypes = { module: ModuleNode, moduleGroup: GroupNode, file: FileNode };
export const nodeTypeFor = { module: "module", group: "moduleGroup", file: "file" } as const;
