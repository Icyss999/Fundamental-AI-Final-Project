import { Badges } from "./nodes";
import { FileRow, Heading, MiniStat } from "./panel";
import { formatLoc } from "./layout";
import { Icon } from "@/components/app/ui";
import type { ProjectAnalysis } from "@/lib/graph/project-analysis";
import { githubLink, githubModuleLink } from "@/lib/repo/links";
import type { ProjectSource } from "@/lib/repo/overview";
import type { ModuleEdge } from "@/lib/graph/partition";

export type Selection = { type: "file" | "module"; id: string } | null;

const EDGE = "#8b8d98";
const DANGER = "#e5484d";

function ModuleRows({ edges, end, labels, onClick }: { edges: ModuleEdge[]; end: "source" | "target"; labels: Record<string, string>; onClick: (m: string) => void }) {
  if (edges.length === 0) return <p className="px-2 text-[12px] text-[var(--muted)]">None</p>;
  return (
    <>
      {edges.map((e) => (
        <button key={e[end]} onClick={() => onClick(e[end])} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[12.5px] hover:bg-[var(--hover)]">
          <span className="truncate">{labels[e[end]] ?? e[end]}</span>
          <span className="shrink-0 tabular-nums text-[var(--muted)]" title="imports">
            {e.weight}
          </span>
        </button>
      ))}
    </>
  );
}

/** The main "go to the code" action for the selected file or folder. */
function GitHubButton({ href, label }: { href: string | null; label: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-[#1f2328] px-3 py-2 text-[13px] font-medium text-white transition hover:bg-[#32383f] dark:bg-white dark:text-[#1f2328] dark:hover:bg-[#e6e6e6]"
    >
      <Icon.GitHub className="h-4 w-4" />
      {label}
      <Icon.External className="h-3.5 w-3.5 opacity-70" />
    </a>
  );
}

function Legend() {
  const row = "flex items-center gap-2.5 text-[12px] text-[var(--muted)]";
  return (
    <div className="space-y-2">
      <div className={row}>
        <svg width="26" height="8" aria-hidden><line x1="0" y1="4" x2="26" y2="4" stroke={EDGE} strokeWidth="1.5" /></svg>
        imports (arrow points at what is used)
      </div>
      <div className={row}>
        <svg width="26" height="8" aria-hidden><line x1="0" y1="4" x2="26" y2="4" stroke={EDGE} strokeWidth="1.5" strokeDasharray="4 3" /></svg>
        type-only import
      </div>
      <div className={row}>
        <svg width="26" height="8" aria-hidden><line x1="0" y1="4" x2="26" y2="4" stroke={DANGER} strokeWidth="2" /></svg>
        import cycle
      </div>
      <div className={row}>
        <span className="w-[26px] text-center text-[10px] font-semibold text-[var(--foreground)]">3</span>
        number of imports merged into one arrow
      </div>
    </div>
  );
}

export function Inspector({
  analysis,
  source,
  selection,
  onClear,
  onFocusFile,
  onFocusModule,
}: {
  analysis: ProjectAnalysis;
  source: ProjectSource;
  selection: Selection;
  onClear: () => void;
  onFocusFile: (file: string) => void;
  onFocusModule: (module: string) => void;
}) {
  const { graph, partition, labels, degree } = analysis;
  const locOf = new Map(graph.nodes.map((n) => [n.id, n.loc]));

  let body: React.ReactNode;
  if (!selection) {
    body = (
      <>
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          Each box is a folder of code. <strong className="font-medium text-[var(--foreground)]">Click</strong> one to open it,{" "}
          <strong className="font-medium text-[var(--foreground)]">hover</strong> to trace its imports, and{" "}
          <strong className="font-medium text-[var(--foreground)]">drag</strong> to rearrange.
        </p>
        <Heading>Legend</Heading>
        <Legend />
        <Heading>Health</Heading>
        {analysis.cycles.length === 0 && analysis.godFiles.length === 0 && <p className="text-[12px] text-[var(--muted)]">No cycles or god files.</p>}
        {analysis.cycles.map((cycle, i) => (
          <div key={cycle.join("|")} className="mb-2 rounded-lg border-l-2 border-[var(--danger)] pl-1">
            <p className="px-2 text-[11px] font-medium text-[var(--danger)]">Cycle {i + 1}</p>
            {cycle.map((f) => <FileRow key={f} file={f} onClick={() => onFocusFile(f)} />)}
          </div>
        ))}
        {analysis.godFiles.length > 0 && (
          <div className="rounded-lg border-l-2 border-[var(--warn)] pl-1">
            <p className="px-2 text-[11px] font-medium text-[var(--warn)]">God files</p>
            {analysis.godFiles.map((g) => <FileRow key={g.id} file={g.id} meta={`${g.fanIn} importers`} onClick={() => onFocusFile(g.id)} />)}
          </div>
        )}
      </>
    );
  } else if (selection.type === "file") {
    const file = selection.id;
    const imports = graph.edges.filter((e) => e.source === file);
    const importedBy = graph.edges.filter((e) => e.target === file);
    const d = degree.get(file);
    body = (
      <>
        <div className="flex items-start justify-between gap-2">
          <p className="break-all font-mono text-[14px] font-semibold">{file.slice(file.lastIndexOf("/") + 1)}</p>
          <Badges view={{ inCycle: analysis.cycles.some((c) => c.includes(file)), god: analysis.godSet.has(file) }} />
        </div>
        <p className="mt-0.5 break-all font-mono text-[11.5px] text-[var(--muted)]">{file}</p>
        <button onClick={() => onFocusModule(partition[file])} className="mt-2 inline-flex items-center gap-1 rounded-full bg-[var(--hover)] px-2.5 py-0.5 text-[12px] hover:text-[var(--accent)]">
          in {labels[partition[file]] ?? partition[file]}
        </button>
        <GitHubButton href={githubLink(source, file, "blob")} label="View source on GitHub" />
        <div className="mt-4 grid grid-cols-3 gap-2">
          <MiniStat label="lines" value={formatLoc(locOf.get(file) ?? 0)} />
          <MiniStat label="imported by" value={d?.fanIn ?? 0} />
          <MiniStat label="imports" value={d?.fanOut ?? 0} />
        </div>
        <Heading>Imports</Heading>
        {imports.length === 0 && <p className="px-2 text-[12px] text-[var(--muted)]">None</p>}
        {imports.map((e) => <FileRow key={e.target} file={e.target} meta={e.typeOnly ? "type" : undefined} onClick={() => onFocusFile(e.target)} />)}
        <Heading>Imported by</Heading>
        {importedBy.length === 0 && <p className="px-2 text-[12px] text-[var(--muted)]">Nothing — this is an entry point</p>}
        {importedBy.map((e) => <FileRow key={e.source} file={e.source} meta={e.typeOnly ? "type" : undefined} onClick={() => onFocusFile(e.source)} />)}
      </>
    );
  } else {
    const id = selection.id;
    const files = analysis.modules.get(id) ?? [];
    const out = analysis.moduleEdges.filter((e) => e.source === id).sort((a, b) => b.weight - a.weight);
    const inc = analysis.moduleEdges.filter((e) => e.target === id).sort((a, b) => b.weight - a.weight);
    body = (
      <>
        <p className="text-[15px] font-semibold tracking-tight">{labels[id] ?? id}</p>
        <p className="mt-0.5 break-all font-mono text-[11.5px] text-[var(--muted)]">{id}/</p>
        <GitHubButton href={githubModuleLink(source, id)} label="Open folder on GitHub" />
        <div className="mt-4 grid grid-cols-3 gap-2">
          <MiniStat label="files" value={files.length} />
          <MiniStat label="lines" value={formatLoc(files.reduce((s, f) => s + (locOf.get(f) ?? 0), 0))} />
          <MiniStat label="internal" value={analysis.internalImports.get(id) ?? 0} />
        </div>
        <Heading>Depends on</Heading>
        <ModuleRows edges={out} end="target" labels={labels} onClick={onFocusModule} />
        <Heading>Used by</Heading>
        <ModuleRows edges={inc} end="source" labels={labels} onClick={onFocusModule} />
        <Heading>Files</Heading>
        {[...files].sort((a, b) => (locOf.get(b) ?? 0) - (locOf.get(a) ?? 0)).map((f) => (
          <FileRow key={f} file={f} meta={formatLoc(locOf.get(f) ?? 0)} onClick={() => onFocusFile(f)} />
        ))}
      </>
    );
  }

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--panel)]">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--border)] px-4">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          {selection ? (selection.type === "file" ? "File" : "Module") : "Guide"}
        </span>
        {selection && (
          <button onClick={onClear} className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]" title="Clear selection">
            <Icon.Close className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{body}</div>
    </aside>
  );
}
