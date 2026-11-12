import type { ReactNode } from "react";
import { FileRow, Heading, MiniStat } from "./panel";
import { formatLoc } from "./layout";
import { Icon } from "@/components/app/ui";
import { KIND_INFO, MODULE_KINDS } from "@/lib/graph/kinds";
import { KindGlyph } from "./nodes";
import type { ProjectAnalysis } from "@/lib/graph/project-analysis";
import type { ModuleEdge } from "@/lib/graph/partition";
import { githubLink, githubModuleLink } from "@/lib/repo/links";
import type { ProjectSource } from "@/lib/repo/overview";

export type Selection = { type: "file" | "module"; id: string } | null;

function ModuleRows({ edges, end, labels, onClick, empty }: { edges: ModuleEdge[]; end: "source" | "target"; labels: Record<string, string>; onClick: (m: string) => void; empty: string }) {
  if (edges.length === 0) return <p className="px-2 text-[14px] text-[var(--muted)]">{empty}</p>;
  return (
    <ul>
      {edges.map((e) => (
        <li key={e[end]}>
          <button onClick={() => onClick(e[end])} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[14px] hover:bg-[var(--hover)]">
            <span className="truncate font-bold">{labels[e[end]] ?? e[end]}</span>
            <span className="shrink-0 tabular-nums text-[var(--muted)]">
              {e.weight} {e.weight === 1 ? "import" : "imports"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The main "go to the code" action for the selected file or folder. */
function GitHubButton({ href, label }: { href: string | null; label: string }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="k-btn mt-3 w-full">
      <Icon.GitHub className="h-4 w-4" />
      {label}
      <Icon.External className="h-3.5 w-3.5" />
    </a>
  );
}

function LegendRow({ mark, children }: { mark: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 text-[14px]">
      <span className="grid w-9 shrink-0 place-items-center">{mark}</span>
      <span>{children}</span>
    </li>
  );
}

/** How to read the map: what each shape means, then the arrows. */
function Legend() {
  return (
    <ul className="space-y-2.5">
      {MODULE_KINDS.map((k) => (
        <LegendRow key={k} mark={<KindGlyph kind={k} className="h-[20px] w-[34px]" />}>
          <b>{KIND_INFO[k].label}:</b> {KIND_INFO[k].meaning}.
        </LegendRow>
      ))}
      <LegendRow
        mark={
          <svg width="34" height="10" aria-hidden>
            <line x1="1" y1="5" x2="27" y2="5" stroke="var(--ink)" strokeWidth="2" />
            <path d="M26 1l7 4-7 4z" fill="var(--ink)" />
          </svg>
        }
      >
        Uses: the arrow points at the part being used.
      </LegendRow>
      <LegendRow
        mark={
          <svg width="34" height="10" aria-hidden>
            <line x1="1" y1="5" x2="27" y2="5" stroke="var(--ink)" strokeWidth="2" strokeDasharray="5 4" />
            <path d="M26 1l7 4-7 4z" fill="var(--ink)" />
          </svg>
        }
      >
        Uses only its types (dashed).
      </LegendRow>
      <LegendRow
        mark={
          <svg width="34" height="10" aria-hidden>
            <line x1="7" y1="5" x2="27" y2="5" stroke="var(--red)" strokeWidth="3" />
            <path d="M8 1L1 5l7 4zM26 1l7 4-7 4z" fill="var(--red)" />
          </svg>
        }
      >
        A loop: two parts that need each other.
      </LegendRow>
    </ul>
  );
}

export function Inspector({
  analysis,
  source,
  selection,
  onFocusFile,
  onFocusModule,
}: {
  analysis: ProjectAnalysis;
  source: ProjectSource;
  selection: Selection;
  onFocusFile: (file: string) => void;
  onFocusModule: (module: string) => void;
}) {
  const { graph, partition, labels, degree } = analysis;
  const locOf = new Map(graph.nodes.map((n) => [n.id, n.loc]));

  let body: ReactNode;
  if (!selection) {
    body = (
      <>
        <p className="text-[15px] leading-relaxed">
          Each box is a main part of the code; its shape says what kind of part it is. Arrows show which part uses which. Click a box to see what is inside it.
        </p>
        <Heading>What the shapes mean</Heading>
        <Legend />
        {(analysis.cycles.length > 0 || analysis.godFiles.length > 0) && <Heading>Worth a look</Heading>}
        {analysis.cycles.map((cycle, i) => (
          <div key={cycle.join("|")} className="mb-3">
            <p className="px-2 text-[14px] font-bold text-[var(--danger)]">
              Loop {analysis.cycles.length > 1 ? i + 1 : ""}: these files need each other
            </p>
            {cycle.map((f) => (
              <FileRow key={f} file={f} onClick={() => onFocusFile(f)} />
            ))}
          </div>
        ))}
        {analysis.godFiles.length > 0 && (
          <div>
            <p className="px-2 text-[14px] font-bold text-[var(--warn)]">Used far more than the rest</p>
            {analysis.godFiles.map((g) => (
              <FileRow key={g.id} file={g.id} meta={`used by ${g.fanIn}`} onClick={() => onFocusFile(g.id)} />
            ))}
          </div>
        )}
      </>
    );
  } else if (selection.type === "file") {
    const file = selection.id;
    const imports = graph.edges.filter((e) => e.source === file);
    const importedBy = graph.edges.filter((e) => e.target === file);
    const d = degree.get(file);
    const inCycle = analysis.cycles.some((c) => c.includes(file));
    const god = analysis.godSet.has(file);
    body = (
      <>
        <p className="break-all font-mono text-[17px] font-bold">{file.slice(file.lastIndexOf("/") + 1)}</p>
        <p className="mt-0.5 break-all font-mono text-[13px] text-[var(--muted)]">{file}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[14px]">
          <button onClick={() => onFocusModule(partition[file])} className="k-btn k-btn-small">
            in {labels[partition[file]] ?? partition[file]}
          </button>
          {inCycle && <span className="font-bold text-[var(--danger)]">In a loop</span>}
          {god && <span className="font-bold text-[var(--warn)]">Used far more than most files</span>}
        </div>
        <GitHubButton href={githubLink(source, file, "blob")} label="Open the code on GitHub" />
        <div className="mt-4 grid grid-cols-3 gap-2">
          <MiniStat label="lines" value={formatLoc(locOf.get(file) ?? 0)} />
          <MiniStat label="used by" value={d?.fanIn ?? 0} />
          <MiniStat label="uses" value={d?.fanOut ?? 0} />
        </div>
        <Heading>It uses</Heading>
        {imports.length === 0 && <p className="px-2 text-[14px] text-[var(--muted)]">Nothing else in the project.</p>}
        {imports.map((e) => (
          <FileRow key={e.target} file={e.target} meta={e.typeOnly ? "types only" : undefined} onClick={() => onFocusFile(e.target)} />
        ))}
        <Heading>Used by</Heading>
        {importedBy.length === 0 && <p className="px-2 text-[14px] text-[var(--muted)]">Nothing — this is where code starts.</p>}
        {importedBy.map((e) => (
          <FileRow key={e.source} file={e.source} meta={e.typeOnly ? "types only" : undefined} onClick={() => onFocusFile(e.source)} />
        ))}
      </>
    );
  } else {
    const id = selection.id;
    const files = analysis.modules.get(id) ?? [];
    const out = analysis.moduleEdges.filter((e) => e.source === id).sort((a, b) => b.weight - a.weight);
    const inc = analysis.moduleEdges.filter((e) => e.target === id).sort((a, b) => b.weight - a.weight);
    body = (
      <>
        <p className="text-[19px] font-bold">{labels[id] ?? id}</p>
        {analysis.grouping === "folders" ? (
          <>
            <p className="mt-0.5 break-all font-mono text-[13px] text-[var(--muted)]">{id}/</p>
            <GitHubButton href={githubModuleLink(source, id)} label="Open the folder on GitHub" />
          </>
        ) : (
          <p className="mt-1 text-[15px] leading-relaxed text-[var(--muted)]">
            {analysis.descriptions[id] ?? "A group the tidiness search found: files that use each other more than the rest."}
            {analysis.tiers[id] !== undefined && <span className="ml-1.5 font-bold text-[var(--foreground)]">Row {analysis.tiers[id] + 1}</span>}
          </p>
        )}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <MiniStat label="files" value={files.length} />
          <MiniStat label="lines" value={formatLoc(files.reduce((s, f) => s + (locOf.get(f) ?? 0), 0))} />
          <MiniStat label="inside links" value={analysis.internalImports.get(id) ?? 0} />
        </div>
        <Heading>It uses</Heading>
        <ModuleRows edges={out} end="target" labels={labels} onClick={onFocusModule} empty="No other part." />
        <Heading>Used by</Heading>
        <ModuleRows edges={inc} end="source" labels={labels} onClick={onFocusModule} empty="No other part — code starts here." />
        <Heading>Files</Heading>
        {[...files]
          .sort((a, b) => (locOf.get(b) ?? 0) - (locOf.get(a) ?? 0))
          .map((f) => (
            <FileRow key={f} file={f} meta={`${formatLoc(locOf.get(f) ?? 0)} lines`} onClick={() => onFocusFile(f)} />
          ))}
      </>
    );
  }

  return <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{body}</div>;
}
