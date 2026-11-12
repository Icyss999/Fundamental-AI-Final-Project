import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useId, type CSSProperties, type ReactNode } from "react";
import { Icon } from "@/components/app/ui";
import { formatProb } from "@/components/layers/format";
import { KIND_INFO, type ModuleKind } from "@/lib/graph/kinds";
import type { ViewNode } from "@/lib/graph/view";
import { formatLoc, MODULE_HEIGHT } from "./layout";

/**
 * The map's boxes, drawn as comic panels: India-ink outlines, flat process tints, plain-word badges.
 * Selected boxes turn yellow; bug risk is printed as halftone dots; shelves are full-width bars.
 */

export type MapperNodeData = {
  view: ViewNode;
  selected: boolean;
  dimmed: boolean;
  /** The file / folder on GitHub at the analysed commit (null for non-GitHub projects). */
  href?: string | null;
  /** Bug risk mode: probability the bug is here, and the dot density (0..1, relative to the hottest box). */
  prob?: number;
  heat?: number;
  /** Refactor mode: a plan moved this file (or a file in this module) / the current step touches it. */
  moved?: boolean;
  focus?: boolean;
  /** The AI assistant highlighted this file (or a file in this module). */
  marked?: boolean;
  /** AI review findings in this file / module, and the worst severity. */
  findings?: { count: number; severity: "high" | "medium" | "low" };
  /** Outline the box in red: the AI found a bug in it (Bug risk mode). */
  bug?: boolean;
  /** First appearance: pop into place after `delay` ms (the map assembling, once). */
  enter?: boolean;
  delay?: number;
};
export type MapperNode = Node<MapperNodeData>;

const hiddenHandle = "!h-1 !w-1 !min-w-0 !min-h-0 !border-0 !bg-transparent";
const family = (i: number) => `var(--c${i})`;
/** A family's flat tint for a box fill. */
const tint = (i: number, share = 30) => `color-mix(in srgb, ${family(i)} ${share}%, var(--module-bg))`;

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Top} className={hiddenHandle} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} className={hiddenHandle} isConnectable={false} />
    </>
  );
}

/** Opens the code on GitHub without selecting or expanding the node. */
function GitHubLink({ href, title, className = "" }: { href: string; title: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
      className={`nodrag nopan grid h-6 w-6 shrink-0 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)] ${className}`}
    >
      <Icon.GitHub className="h-3.5 w-3.5" />
    </a>
  );
}

function Tag({ children, tone, title }: { children: ReactNode; tone: "red" | "amber" | "green" | "ink"; title?: string }) {
  const tones = {
    red: "border-[var(--danger)] text-[var(--danger)]",
    amber: "border-[var(--warn)] text-[var(--warn)]",
    green: "border-[var(--added)] text-[var(--added)]",
    ink: "border-[var(--ink)] text-[var(--foreground)]",
  };
  return (
    <span title={title} className={`inline-flex shrink-0 items-center gap-0.5 rounded-full border-[1.5px] bg-[var(--panel)] px-1.5 text-[11px] font-bold leading-[17px] ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Plain-word flags: a loop, a file far more used than the rest, a plan move, review findings, the risk %. */
function Flags({ data }: { data: MapperNodeData }) {
  const { view } = data;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {data.moved && (
        <Tag tone="green" title="Moved by the refactoring plan">
          moved
        </Tag>
      )}
      {data.findings && (
        <Tag tone={data.findings.severity === "low" ? "amber" : "red"} title={`The AI found ${data.findings.count} ${data.findings.count === 1 ? "bug" : "bugs"} here (worst: ${data.findings.severity})`}>
          {data.findings.count} {data.findings.count === 1 ? "bug" : "bugs"}
        </Tag>
      )}
      {data.prob !== undefined ? (
        <Tag tone="ink" title="Chance the bug is here">
          {formatProb(data.prob)}
        </Tag>
      ) : (
        <>
          {view.inCycle && (
            <Tag tone="red" title="Part of an import loop: these files need each other">
              loop
            </Tag>
          )}
          {view.god && (
            <Tag tone="amber" title="Far more files depend on this one than on the others">
              used a lot
            </Tag>
          )}
        </>
      )}
    </span>
  );
}

/** Selection, plan focus, AI highlight and dimming, in one place. */
function frame(data: MapperNodeData, extra: CSSProperties = {}): { className: string; style: CSSProperties } {
  const ring = data.selected
    ? ""
    : data.focus
      ? "outline outline-[3px] outline-offset-2 outline-[var(--added)]"
      : data.marked
        ? "outline outline-[3px] outline-offset-2 outline-[var(--ai)]"
        : data.bug
          ? "outline outline-[3.5px] outline-offset-2 outline-[var(--red)]"
          : "";
  return {
    className: [
      "relative h-full w-full transition-[opacity,box-shadow,background-color] duration-150",
      data.dimmed ? "opacity-30" : "opacity-100",
      data.enter ? "k-enter" : "",
      ring,
    ].join(" "),
    style: {
      ...extra,
      ...(data.selected ? { background: "var(--yel)", boxShadow: "var(--press)", color: "var(--on-yel)" } : {}),
      ...(data.enter ? { animationDelay: `${data.delay ?? 0}ms` } : {}),
    },
  };
}

/** Bug risk as halftone: denser dots, likelier bug. */
function Halftone({ heat }: { heat?: number }) {
  if (heat === undefined || heat <= 0.01) return null;
  return <span aria-hidden className="k-halftone pointer-events-none absolute inset-0 rounded-[inherit] opacity-70" style={{ "--dot": Math.min(1, heat) } as CSSProperties} />;
}

/** The outline of each kind of part, in pixels for a w×h box (inset by half the ink line). */
function shapePath(kind: ModuleKind | undefined, w: number, h: number): string {
  const i = 1.5;
  const W = w - i;
  const H = h - i;
  switch (kind) {
    case "entry": {
      const r = (H - i) / 2;
      return `M${i + r},${i} H${W - r} A${r},${r} 0 0 1 ${W - r},${H} H${i + r} A${r},${r} 0 0 1 ${i + r},${i} Z`;
    }
    case "logic":
      return `M${i + 18},${i} H${W - 18} L${W},${h / 2} L${W - 18},${H} H${i + 18} L${i},${h / 2} Z`;
    case "data":
      return `M${i},${i + 11} A${(W - i) / 2},11 0 0 1 ${W},${i + 11} V${H - 11} A${(W - i) / 2},11 0 0 1 ${i},${H - 11} Z`;
    case "external":
      return `M${i + 20},${i} H${W} L${W - 20},${H} H${i} Z`;
    case "config":
      return `M${i},${i + 8} Q${i},${i} ${i + 8},${i} H${W - 8} Q${W},${i} ${W},${i + 8} V${H - 10} Q${(3 * W) / 4},${H - 22} ${W / 2},${H - 10} T${i},${H - 10} Z`;
    default: {
      const r = kind === "shared" ? 6 : 12;
      return `M${i + r},${i} H${W - r} Q${W},${i} ${W},${i + r} V${H - r} Q${W},${H} ${W - r},${H} H${i + r} Q${i},${H} ${i},${H - r} V${i + r} Q${i},${i} ${i + r},${i} Z`;
    }
  }
}

/** Extra ink inside a shape: a window's title bar and dots, a cylinder's lid, a library's side bars. */
function ShapeDetail({ kind, w, h }: { kind?: ModuleKind; w: number; h: number }) {
  const ink = { stroke: "var(--ink)", strokeWidth: 2, fill: "none" } as const;
  if (kind === "ui")
    return (
      <>
        <path d={`M1.5,19 H${w - 1.5}`} {...ink} />
        {[13, 23, 33].map((x) => (
          <circle key={x} cx={x} cy={10.5} r={2.6} fill="var(--ink)" />
        ))}
      </>
    );
  if (kind === "data") return <path d={`M1.5,12.5 A${(w - 3) / 2},11 0 0 0 ${w - 1.5},12.5`} {...ink} />;
  if (kind === "shared")
    return (
      <>
        <path d={`M12,1.5 V${h - 1.5}`} {...ink} />
        <path d={`M${w - 12},1.5 V${h - 1.5}`} {...ink} />
      </>
    );
  return null;
}

/** Where the words go inside each shape (clear of points, lids and bars). */
const SHAPE_PADDING: Record<ModuleKind | "plain", string> = {
  ui: "pt-6 px-4",
  entry: "px-7",
  logic: "px-7",
  data: "pt-5 pb-2 px-4",
  shared: "px-6",
  external: "px-8",
  config: "pb-4 px-4",
  plain: "px-4",
};

/**
 * A part's shape, drawn in SVG at the box's size: the fill (yellow when selected), bug-risk dots printed inside
 * the outline, and a ring that follows it (plan focus green, AI highlight cyan, a found bug red).
 */
function KindShape({ kind, w, h, fill, heat, ring, pressed }: { kind?: ModuleKind; w: number; h: number; fill: string; heat?: number; ring?: string; pressed: boolean }) {
  const id = useId().replace(/:/g, "");
  const d = shapePath(kind, w, h);
  const dot = heat !== undefined && heat > 0.01 ? Math.min(1, heat) * 1.8 + 0.3 : 0;
  return (
    <svg className="pointer-events-none absolute inset-0 overflow-visible" width={w} height={h} aria-hidden style={pressed ? { filter: "drop-shadow(3px 3px 0 var(--ink))" } : undefined}>
      {dot > 0 && (
        <defs>
          <pattern id={`dots-${id}`} width="7" height="7" patternUnits="userSpaceOnUse">
            <circle cx="3.5" cy="3.5" r={dot} fill="var(--heat)" opacity="0.7" />
          </pattern>
        </defs>
      )}
      {ring && <path d={d} fill="none" stroke={ring} strokeWidth={8} strokeLinejoin="round" />}
      <path d={d} fill={fill} />
      {dot > 0 && <path d={d} fill={`url(#dots-${id})`} />}
      <path d={d} fill="none" stroke="var(--ink)" strokeWidth={2.5} strokeLinejoin="round" />
      <ShapeDetail kind={kind} w={w} h={h} />
    </svg>
  );
}

/** A small drawing of a kind's shape, for the map's key and the open part's header. */
export function KindGlyph({ kind, className = "h-[18px] w-[30px]" }: { kind: ModuleKind; className?: string }) {
  const w = 60;
  const h = 36;
  return (
    <svg className={`shrink-0 overflow-visible ${className}`} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={shapePath(kind, w, h)} fill="var(--module-bg)" stroke="var(--ink)" strokeWidth={3} strokeLinejoin="round" />
      <ShapeDetail kind={kind} w={w} h={h} />
    </svg>
  );
}

/**
 * A collapsed part: its shape says what kind of part it is, its label what it is called. Click to open it.
 * Kept to the essentials (name and one line of purpose), so the relationships read at a glance.
 */
export function ModuleNode({ data, width, height }: NodeProps<MapperNode>) {
  const { view } = data;
  const w = width ?? 220;
  const h = height ?? MODULE_HEIGHT;
  const ring = data.selected ? undefined : data.focus ? "var(--added)" : data.marked ? "var(--ai)" : data.bug ? "var(--red)" : undefined;
  const kindLabel = view.part ? KIND_INFO[view.part].label : undefined;
  const line = view.description ?? kindLabel ?? `${view.fileCount} ${view.fileCount === 1 ? "file" : "files"}`;
  return (
    <div
      className={`group relative flex h-full w-full cursor-pointer flex-col justify-center gap-0.5 transition-opacity duration-150 ${data.dimmed ? "opacity-30" : "opacity-100"} ${data.enter ? "k-enter" : ""} ${SHAPE_PADDING[view.part ?? "plain"]}`}
      style={{ ...(data.selected ? { color: "var(--on-yel)" } : {}), ...(data.enter ? { animationDelay: `${data.delay ?? 0}ms` } : {}) }}
      title={`${view.label}${kindLabel ? ` (${kindLabel.toLowerCase()})` : ""}${view.description ? ` — ${view.description}` : ""}\n${view.fileCount} ${view.fileCount === 1 ? "file" : "files"} — click to open`}
    >
      <Handles />
      <KindShape kind={view.part} w={w} h={h} fill={data.selected ? "var(--yel)" : tint(view.color, 26)} heat={data.heat} ring={ring} pressed={data.selected} />
      <div className={`relative flex items-center justify-between gap-2 ${data.heat ? "k-halo" : ""}`}>
        <span className="truncate text-[16.5px] font-bold leading-tight">{view.label}</span>
        <Flags data={data} />
      </div>
      <span className={`relative truncate text-[13px] leading-snug ${data.heat ? "k-halo" : ""}`} style={{ color: data.selected ? "var(--on-yel)" : "var(--muted)" }}>
        {line}
      </span>
    </div>
  );
}

function CloseButton() {
  return (
    <button
      data-action="collapse"
      className="nodrag flex h-7 shrink-0 items-center gap-1 rounded-md border-[1.5px] border-[var(--ink)] bg-[var(--panel)] px-2 text-[12px] font-bold text-[var(--foreground)] hover:bg-[var(--hover)]"
      title="Close this part"
    >
      <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
        <path d="M4 10l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Close
    </button>
  );
}

/** An opened module: a tinted panel around its files. The header button closes it. */
export function GroupNode({ data }: NodeProps<MapperNode>) {
  const { view } = data;
  const f = frame({ ...data, selected: false }, { background: tint(view.color, 12) });
  return (
    <div
      className={`rounded-[14px] border-[2.5px] border-[var(--ink)] ${f.className} ${data.selected ? "outline outline-[3px] outline-offset-2 outline-[var(--yel)]" : ""}`}
      style={f.style}
      title={view.description ? `${view.label} — ${view.description}${view.tier !== undefined ? ` (tier ${view.tier})` : ""}` : undefined}
    >
      <Handles />
      <div className="flex h-11 items-center gap-2 px-3.5">
        {view.part ? (
          <span title={KIND_INFO[view.part].label}>
            <KindGlyph kind={view.part} className="h-[14px] w-[24px]" />
          </span>
        ) : (
          <span className="h-3 w-3 shrink-0 rounded-[3px] border-[1.5px] border-[var(--ink)]" style={{ background: family(view.color) }} />
        )}
        <span className="truncate text-[15px] font-bold">{view.label}</span>
        <span className="shrink-0 text-[12.5px] text-[var(--muted)]">
          {view.fileCount} {view.fileCount === 1 ? "file" : "files"} · {formatLoc(view.loc)} lines
        </span>
        <Flags data={data} />
        <span className="flex-1" />
        {data.href && <GitHubLink href={data.href} title="Open this folder on GitHub" />}
        <CloseButton />
      </div>
    </div>
  );
}

export function FileNode({ data }: NodeProps<MapperNode>) {
  const { view } = data;
  const f = frame(data, { background: "var(--file-bg)" });
  return (
    <div className={`group flex cursor-pointer items-center gap-2 overflow-hidden rounded-lg border-2 border-[var(--ink)] px-2.5 ${f.className}`} style={f.style} title={view.file}>
      <Handles />
      <Halftone heat={data.heat} />
      <span className="relative h-2 w-2 shrink-0 rounded-[2px] border border-[var(--ink)]" style={{ background: family(view.color) }} />
      <span className="relative min-w-0 flex-1 truncate font-mono text-[13px]">{view.label}</span>
      <span className="relative flex items-center gap-1">
        <Flags data={data} />
        {data.prob === undefined && (
          <span className="shrink-0 text-[11.5px] tabular-nums" style={{ color: data.selected ? "var(--on-yel)" : "var(--muted)" }}>
            {formatLoc(view.loc)}
          </span>
        )}
      </span>
      {data.href && (
        <GitHubLink
          href={data.href}
          title="View source on GitHub"
          className={`relative ${data.selected ? "" : "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"}`}
        />
      )}
    </div>
  );
}

/** A shelf: a part most others use, as a full-width bar under the map. Click to open it. */
export function ShelfNode({ data }: NodeProps<MapperNode>) {
  const { view } = data;
  const f = frame(data, { background: tint(view.color, 26) });
  const files = view.files ?? [];
  const shown = files.slice(0, 6);
  const soft = { color: data.selected ? "var(--on-yel)" : "var(--muted)" };
  return (
    <div
      className={`group flex cursor-pointer items-center gap-4 overflow-hidden rounded-xl border-[2.5px] border-[var(--ink)] px-4 ${f.className}`}
      style={f.style}
      title={`${view.label}: used by ${view.usedBy?.join(", ")} — click to open`}
    >
      <Handles />
      <Halftone heat={data.heat} />
      <span className="relative h-3.5 w-3.5 shrink-0 rounded-[4px] border-2 border-[var(--ink)]" style={{ background: family(view.color) }} />
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[16.5px] font-bold">{view.label}</span>
          <span className="shrink-0 text-[13px]" style={soft}>
            {view.fileCount} {view.fileCount === 1 ? "file" : "files"} · {formatLoc(view.loc)} lines
          </span>
          <Flags data={data} />
        </div>
        <p className="truncate text-[14px]">Used by {sentenceList(view.usedBy ?? [], 4)}</p>
      </div>
      <p className="relative hidden max-w-[45%] truncate font-mono text-[12.5px] md:block" style={soft}>
        {shown.join(" · ")}
        {files.length > shown.length ? ` · +${files.length - shown.length} more` : ""}
      </p>
    </div>
  );
}

/** An opened shelf: its files in a grid. */
export function ShelfGroupNode({ data }: NodeProps<MapperNode>) {
  const { view } = data;
  const f = frame({ ...data, selected: false }, { background: tint(view.color, 14) });
  return (
    <div className={`rounded-xl border-[2.5px] border-[var(--ink)] ${f.className} ${data.selected ? "outline outline-[3px] outline-offset-2 outline-[var(--yel)]" : ""}`} style={f.style}>
      <Handles />
      <div className="flex h-12 items-center gap-2.5 px-4">
        <span className="h-3.5 w-3.5 shrink-0 rounded-[4px] border-2 border-[var(--ink)]" style={{ background: family(view.color) }} />
        <span className="text-[15.5px] font-bold">{view.label}</span>
        <span className="min-w-0 truncate text-[13px] text-[var(--muted)]">Used by {sentenceList(view.usedBy ?? [], 6)}</span>
        <Flags data={data} />
        <span className="flex-1" />
        {data.href && <GitHubLink href={data.href} title="Open this folder on GitHub" />}
        <CloseButton />
      </div>
    </div>
  );
}

/** "a, b and c", or "a, b, c and 4 more". */
export function sentenceList(items: readonly string[], max: number): string {
  if (items.length === 0) return "nothing yet";
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  return shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

// "moduleGroup" rather than "group": React Flow styles its built-in "group" type with its own frame.
export const nodeTypes = { module: ModuleNode, moduleGroup: GroupNode, file: FileNode, shelf: ShelfNode, shelfGroup: ShelfGroupNode };

export function nodeTypeFor(view: ViewNode): keyof typeof nodeTypes {
  if (view.kind === "file") return "file";
  if (view.shelf) return view.kind === "group" ? "shelfGroup" : "shelf";
  return view.kind === "group" ? "moduleGroup" : "module";
}
