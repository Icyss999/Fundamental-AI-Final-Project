import { formatProb, relPath } from "@/components/layers/format";
import type { Layers } from "@/components/layers/useLayers";
import type { DiagramMode } from "@/components/mapper/DiagramView";
import { formatLoc } from "@/components/mapper/layout";
import type { HistoryData } from "@/lib/analyze";
import type { ProjectAnalysis } from "@/lib/graph/project-analysis";
import type { FileRole } from "@/lib/graph/types";
import { moduleColors } from "@/lib/graph/view";
import { githubLink, githubModuleLink } from "@/lib/repo/links";
import type { ProjectOverview, TechCategory } from "@/lib/repo/overview";
import { Card, Chip, formatCount, Icon, timeAgo } from "./ui";

export type ShowTarget = { type: "file" | "module"; id: string };

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  TSX: "#6aa7e8",
  JavaScript: "#d4a72c",
  JSX: "#f0cf65",
  Other: "#9ca3af",
};
const CATEGORY_ORDER: TechCategory[] = ["Language", "Framework", "UI", "Styling", "State & data", "Backend", "Testing", "Tooling"];

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "danger" | "warn" }) {
  const color = tone === "danger" ? "text-[var(--danger)]" : tone === "warn" ? "text-[var(--warn)]" : "text-[var(--foreground)]";
  return (
    <div className="rounded-xl bg-[var(--hover)] px-3.5 py-3">
      <div className={`text-[22px] font-semibold tabular-nums leading-tight tracking-tight ${color}`}>{value}</div>
      <div className="mt-0.5 text-[12px] text-[var(--muted)]">{label}</div>
      {hint && <div className="mt-1 text-[11px] text-[var(--muted)]">{hint}</div>}
    </div>
  );
}

function GitHubIconLink({ href, title }: { href: string | null; title: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      onClick={(e) => e.stopPropagation()}
      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[var(--muted)] opacity-0 transition hover:bg-[var(--panel)] hover:text-[var(--foreground)] group-hover:opacity-100 focus-visible:opacity-100"
    >
      <Icon.GitHub className="h-3.5 w-3.5" />
    </a>
  );
}

/** A file row: click to show it in the diagram; the GitHub icon opens its source. */
function FileButton({ file, meta, href, onClick }: { file: string; meta?: string; href: string | null; onClick: () => void }) {
  const slash = file.lastIndexOf("/");
  return (
    <div className="group flex items-center gap-1 rounded-lg pr-1 hover:bg-[var(--hover)]">
      <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5 text-left" title={`${file} — show in diagram`}>
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
          <span className="text-[var(--muted)]">{slash === -1 ? "" : file.slice(0, slash + 1)}</span>
          <span className="font-medium text-[var(--foreground)]">{file.slice(slash + 1)}</span>
        </span>
        {meta && <span className="shrink-0 text-[12px] tabular-nums text-[var(--muted)]">{meta}</span>}
      </button>
      <GitHubIconLink href={href} title="View source on GitHub" />
    </div>
  );
}

export function Overview({
  overview,
  analysis,
  roles,
  warnings,
  analysedAt,
  layers,
  history,
  onShow,
  onOpenDiagram,
}: {
  overview: ProjectOverview;
  analysis: ProjectAnalysis;
  roles: Record<FileRole, number>;
  warnings: string[];
  analysedAt: number;
  layers: Layers;
  history: HistoryData | null;
  onShow: (target: ShowTarget, mode?: DiagramMode) => void;
  onOpenDiagram: (mode?: DiagramMode) => void;
}) {
  const { source, github } = overview;
  const colors = moduleColors(analysis.modules.keys(), analysis.labels);
  const hidden = roles.test + roles.story + roles.example + roles.config + roles.declaration;
  const hiddenParts = (
    [
      [roles.test + roles.story, "tests"],
      [roles.example, "examples"],
      [roles.config + roles.declaration, "config & types"],
    ] as [number, string][]
  )
    .filter(([n]) => n > 0)
    .map(([n, what]) => `${n} ${what}`);
  const maxModuleLoc = Math.max(1, ...analysis.stats.map((m) => m.loc));
  const totalLangLoc = overview.languages.reduce((s, l) => s + l.loc, 0) || 1;
  const stackByCategory = CATEGORY_ORDER.map((c) => [c, overview.techStack.filter((t) => t.category === c)] as const).filter(([, items]) => items.length > 0);
  const about = overview.readme?.summary ?? overview.description;
  const fileLink = (file: string) => githubLink(source, file, "blob");

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-6 py-8">
      {warnings.map((w) => (
        <div key={w} className="flex items-start gap-2 rounded-xl border border-[var(--warn)]/30 bg-[var(--warn-soft)] px-4 py-2.5 text-[13px] text-[var(--warn)]">
          <Icon.Alert className="mt-0.5 h-4 w-4 shrink-0" />
          {w}
        </div>
      ))}

      {/* Identity */}
      <section className="flex flex-col gap-5 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-[0_1px_2px_rgb(0_0_0/0.04)] md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          {source.kind === "github" && (
            <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] text-[var(--muted)] hover:text-[var(--foreground)]">
              <Icon.GitHub className="h-3.5 w-3.5" />
              {source.owner}/{source.repo}
              {source.subdir && <span>/{source.subdir}</span>}
              {source.private && (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-1.5 text-[11px]">
                  <Icon.Lock className="h-2.5 w-2.5" /> Private
                </span>
              )}
            </a>
          )}
          <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-tight">{overview.readme?.title ?? overview.name}</h1>
          {overview.description && <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-[var(--muted)]">{overview.description}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-[var(--muted)]">
            {github && (
              <>
                <span className="inline-flex items-center gap-1.5" title="Stars">
                  <Icon.Star className="h-3.5 w-3.5" />
                  {formatCount(github.stars)}
                </span>
                <span className="inline-flex items-center gap-1.5" title="Forks">
                  <Icon.Fork className="h-3.5 w-3.5" />
                  {formatCount(github.forks)}
                </span>
                {github.license && (
                  <span className="inline-flex items-center gap-1.5" title="License">
                    <Icon.Scale className="h-3.5 w-3.5" />
                    {github.license}
                  </span>
                )}
                {github.pushedAt && (
                  <span className="inline-flex items-center gap-1.5" title={`Last push ${github.pushedAt}`}>
                    <Icon.Clock className="h-3.5 w-3.5" />
                    Updated {timeAgo(github.pushedAt, analysedAt)}
                  </span>
                )}
              </>
            )}
            {source.kind === "github" && (
              <a
                href={`${source.url}/tree/${source.commit}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-[var(--foreground)]"
                title="The exact commit that was analysed"
              >
                <Icon.Branch className="h-3.5 w-3.5" />
                {source.branch} @ <span className="font-mono">{source.commit.slice(0, 7)}</span>
              </a>
            )}
            {source.kind === "local" && <span className="font-mono">{source.path}</span>}
          </div>
          {github && github.topics.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {github.topics.slice(0, 10).map((t) => (
                <Chip key={t} tone="accent">
                  {t}
                </Chip>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 md:flex-col md:items-stretch">
          <button onClick={() => onOpenDiagram()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-[14px] font-medium text-white hover:bg-[var(--accent-strong)]">
            Open diagram
            <Icon.Arrow className="h-4 w-4" />
          </button>
          {source.kind === "github" && (
            <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-[14px] hover:bg-[var(--hover)]">
              <Icon.GitHub className="h-4 w-4" />
              View on GitHub
            </a>
          )}
          {github?.homepage && (
            <a href={github.homepage} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-[14px] hover:bg-[var(--hover)]">
              Website
              <Icon.External className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </section>

      {/* What it is + numbers */}
      <div className="grid gap-5 lg:grid-cols-5">
        <Card title="What this project is" className="lg:col-span-3">
          {about ? (
            <>
              <p className="text-[15px] leading-relaxed text-[var(--foreground)]">{about}</p>
              <p className="mt-3 text-[12px] text-[var(--muted)]">
                {overview.readme?.summary ? `From ${overview.readme.file}` : "From the repository description"}
              </p>
            </>
          ) : (
            <p className="text-[14px] text-[var(--muted)]">This repository has no README description to summarise.</p>
          )}
          {analysis.summary.length > 0 && (
            <div className="mt-5 border-t border-[var(--border)] pt-4">
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--muted)]">Shape of the code</h3>
              <ul className="space-y-1.5">
                {analysis.summary.map((s) => (
                  <li key={s} className="flex gap-2 text-[14px] leading-relaxed">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        <Card title="At a glance" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-2.5">
            <Stat label="Source files" value={formatCount(analysis.graph.nodes.length)} hint={hidden > 0 ? `+ ${hiddenParts.join(", ")}` : undefined} />
            <Stat label="Lines of code" value={formatCount(analysis.totalLoc)} />
            <Stat label="Modules" value={String(analysis.modules.size)} />
            <Stat label="Imports" value={formatCount(analysis.graph.edges.length)} />
            <Stat label="Import cycles" value={String(analysis.cycles.length)} tone={analysis.cycles.length > 0 ? "danger" : undefined} />
            <Stat label="God files" value={String(analysis.godFiles.length)} tone={analysis.godFiles.length > 0 ? "warn" : undefined} />
          </div>
        </Card>
      </div>

      {/* Stack + languages */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Built with">
          <dl className="space-y-3">
            {stackByCategory.map(([category, items]) => (
              <div key={category} className="flex items-start gap-4">
                <dt className="w-24 shrink-0 pt-0.5 text-[12px] text-[var(--muted)]">{category}</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {items.map((t) => (
                    <Chip key={t.name}>{t.name}</Chip>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
          {overview.packageInfo?.scripts.length ? (
            <p className="mt-4 border-t border-[var(--border)] pt-3 text-[12px] text-[var(--muted)]">
              npm scripts: <span className="font-mono">{overview.packageInfo.scripts.join(", ")}</span>
            </p>
          ) : null}
        </Card>
        <Card title="Languages">
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--hover)]">
            {overview.languages.map((l) => (
              <span key={l.name} style={{ width: `${(l.loc / totalLangLoc) * 100}%`, background: LANGUAGE_COLORS[l.name] ?? LANGUAGE_COLORS.Other }} title={`${l.name}: ${l.loc} lines`} />
            ))}
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2.5">
            {overview.languages.map((l) => (
              <li key={l.name} className="flex items-center gap-2 text-[13px]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: LANGUAGE_COLORS[l.name] ?? LANGUAGE_COLORS.Other }} />
                <span className="font-medium">{l.name}</span>
                <span className="ml-auto tabular-nums text-[var(--muted)]">
                  {Math.round((l.loc / totalLangLoc) * 100)}% · {l.files} files
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[12px] text-[var(--muted)]">Counted over all {formatCount(roles.source + hidden)} JS/TS files, including tests and examples.</p>
        </Card>
      </div>

      {/* Modules */}
      <Card
        title="How the code is organised"
        action={
          <span className="text-[12px] text-[var(--muted)]">
            Modules are folders{analysis.prefix ? <> inside <span className="font-mono">{analysis.prefix}/</span></> : null} · click one to open it
          </span>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-[var(--muted)]">
                <th className="pb-2 font-medium">Module</th>
                <th className="pb-2 text-right font-medium">Files</th>
                <th className="w-[34%] pb-2 pl-6 font-medium">Lines</th>
                <th className="pb-2 text-right font-medium" title="Other modules it imports from">Depends on</th>
                <th className="pb-2 text-right font-medium" title="Other modules that import from it">Used by</th>
                <th className="w-8 pb-2" />
              </tr>
            </thead>
            <tbody>
              {analysis.stats.map((m) => (
                <tr key={m.id} onClick={() => onShow({ type: "module", id: m.id })} className="group cursor-pointer border-t border-[var(--border)] hover:bg-[var(--hover)]">
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2.5">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `var(--c${colors.get(m.id) ?? 0})` }} />
                      <span className="font-medium">{analysis.labels[m.id] ?? m.id}</span>
                    </div>
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{m.files}</td>
                  <td className="py-2.5 pl-6">
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--hover)]">
                        <div className="h-full rounded-full" style={{ width: `${(m.loc / maxModuleLoc) * 100}%`, background: `var(--c${colors.get(m.id) ?? 0})` }} />
                      </div>
                      <span className="w-12 text-right tabular-nums text-[var(--muted)]">{formatLoc(m.loc)}</span>
                    </div>
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{m.dependsOn}</td>
                  <td className="py-2.5 text-right tabular-nums">{m.usedBy}</td>
                  <td className="py-2.5 pl-2">
                    <GitHubIconLink href={githubModuleLink(source, m.id)} title="Open this folder on GitHub" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Key files + health */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Entry points">
          <p className="-mt-2 mb-3 text-[12px] text-[var(--muted)]">Files nothing else imports — where execution starts (pages, CLIs, public API).</p>
          {analysis.entryPoints.length === 0 ? (
            <p className="text-[13px] text-[var(--muted)]">None found.</p>
          ) : (
            analysis.entryPoints.map((f) => <FileButton key={f.id} file={f.id} href={fileLink(f.id)} meta={`${f.fanOut} imports`} onClick={() => onShow({ type: "file", id: f.id })} />)
          )}
        </Card>
        <Card title="Core files">
          <p className="-mt-2 mb-3 text-[12px] text-[var(--muted)]">The most imported files — foundations the rest of the code builds on.</p>
          {analysis.coreFiles.length === 0 ? (
            <p className="text-[13px] text-[var(--muted)]">None found.</p>
          ) : (
            analysis.coreFiles.map((f) => <FileButton key={f.id} file={f.id} href={fileLink(f.id)} meta={`${f.fanIn} importers`} onClick={() => onShow({ type: "file", id: f.id })} />)
          )}
        </Card>
        <Card title="Health">
          {analysis.cycles.length === 0 && analysis.godFiles.length === 0 ? (
            <p className="text-[13px] text-[var(--muted)]">No import cycles and no over-depended-on files. Nicely structured.</p>
          ) : (
            <div className="space-y-4">
              {analysis.cycles.length > 0 && (
                <div>
                  <div className="mb-1.5 flex items-center gap-2">
                    <Chip tone="danger">cycle</Chip>
                    <span className="text-[12px] text-[var(--muted)]">Files that import each other in a loop</span>
                  </div>
                  {analysis.cycles.slice(0, 3).map((cycle) => (
                    <div key={cycle.join("|")} className="mb-2 border-l-2 border-[var(--danger)] pl-1">
                      {cycle.slice(0, 5).map((f) => (
                        <FileButton key={f} file={f} href={fileLink(f)} onClick={() => onShow({ type: "file", id: f })} />
                      ))}
                      {cycle.length > 5 && <p className="px-2 text-[12px] text-[var(--muted)]">+ {cycle.length - 5} more</p>}
                    </div>
                  ))}
                  {analysis.cycles.length > 3 && <p className="text-[12px] text-[var(--muted)]">+ {analysis.cycles.length - 3} more cycles</p>}
                </div>
              )}
              {analysis.godFiles.length > 0 && (
                <div>
                  <div className="mb-1.5 flex items-center gap-2">
                    <Chip tone="warn">god</Chip>
                    <span className="text-[12px] text-[var(--muted)]">Far more depended on than the rest</span>
                  </div>
                  <div className="border-l-2 border-[var(--warn)] pl-1">
                    {analysis.godFiles.map((g) => (
                      <FileButton key={g.id} file={g.id} href={fileLink(g.id)} meta={`${g.fanIn} importers`} onClick={() => onShow({ type: "file", id: g.id })} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Layer 2 + Layer 3 at a glance */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Bug-risk hotspots"
          action={
            <button onClick={() => onOpenDiagram("risk")} className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--accent-strong)] hover:underline">
              Open bug risk <Icon.Arrow className="h-3.5 w-3.5" />
            </button>
          }
        >
          <p className="-mt-2 mb-3 text-[12px] text-[var(--muted)]">
            {layers.diagnosis.failing + layers.diagnosis.passing > 0
              ? `Probability the bug is in each file, given the test results you entered and the git history.`
              : layers.diagnosis.history && history
                ? `Where a bug is most likely, from ${layers.diagnosis.history.commits} commits of history (${layers.diagnosis.history.fixCommits} bug fixes) and file size. Add test results to sharpen it.`
                : "No git history was available, so this follows file size only. Add test results in the bug-risk view."}
          </p>
          {layers.diagnosis.files.slice(0, 5).map((f) => (
            <FileButton
              key={f.id}
              file={relPath(f.id, analysis.prefix)}
              href={fileLink(f.id)}
              meta={`${formatProb(f.posterior)}${f.history?.fixes ? ` · ${f.history.fixes} fix${f.history.fixes === 1 ? "" : "es"}` : ""}`}
              onClick={() => onShow({ type: "file", id: f.id }, "risk")}
            />
          ))}
        </Card>
        <Card
          title="Architecture check"
          action={
            <button onClick={() => onOpenDiagram("refactor")} className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--accent-strong)] hover:underline">
              {layers.evaluation.violations.length > 0 ? "Plan a fix" : "Edit rules"} <Icon.Arrow className="h-3.5 w-3.5" />
            </button>
          }
        >
          <p className="-mt-2 mb-3 text-[12px] text-[var(--muted)]">
            {layers.rulesText === layers.suggested ? "Against rules suggested from the folder names" : "Against your rules"} — edit them in the Refactor view.
          </p>
          <pre className="mb-3 overflow-x-auto rounded-lg bg-[var(--hover)] px-3 py-2 font-mono text-[11.5px] leading-relaxed">
            {layers.policy.rules.map((r) => r.text).join("\n") || "(no rules)"}
          </pre>
          {layers.evaluation.violations.length === 0 ? (
            <p className="text-[13px] text-[var(--muted)]">{layers.policy.active ? "No import breaks these rules." : "No rules to check yet."}</p>
          ) : (
            <>
              <div className="mb-1.5 flex items-center gap-2">
                <Chip tone="danger">{layers.evaluation.violations.length}</Chip>
                <span className="text-[12px] text-[var(--muted)]">{layers.evaluation.violations.length === 1 ? "import breaks" : "imports break"} the rules</span>
              </div>
              <div className="border-l-2 border-[var(--danger)] pl-1">
                {layers.evaluation.violations.slice(0, 5).map((v) => (
                  <FileButton
                    key={`${v.source}>${v.target}`}
                    file={relPath(v.source, analysis.prefix)}
                    href={fileLink(v.source)}
                    meta={`→ ${relPath(v.target, analysis.prefix)}`}
                    onClick={() => onShow({ type: "file", id: v.source }, "refactor")}
                  />
                ))}
                {layers.evaluation.violations.length > 5 && <p className="px-2 text-[12px] text-[var(--muted)]">+ {layers.evaluation.violations.length - 5} more</p>}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
