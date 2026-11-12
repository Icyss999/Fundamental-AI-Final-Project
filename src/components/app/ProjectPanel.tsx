import type { ReactNode } from "react";
import { formatLoc } from "@/components/mapper/layout";
import { FileRow, Heading, MiniStat } from "@/components/mapper/panel";
import type { ProjectAnalysis } from "@/lib/graph/project-analysis";
import type { FileRole } from "@/lib/graph/types";
import { moduleColors } from "@/lib/graph/view";
import type { ProjectOverview, TechCategory } from "@/lib/repo/overview";
import { formatCount, Icon, timeAgo } from "./ui";

/** GitHub's language colours. */
const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  TSX: "#6aa7e8",
  JavaScript: "#d4a72c",
  JSX: "#f0cf65",
  Python: "#3572A5",
  Java: "#b07219",
  Kotlin: "#A97BFF",
  Scala: "#c22d40",
  Groovy: "#4298b8",
  Go: "#00ADD8",
  Rust: "#dea584",
  C: "#555555",
  "C++": "#f34b7d",
  "Objective-C": "#438eff",
  "C#": "#178600",
  PHP: "#4F5D95",
  Ruby: "#701516",
  Swift: "#F05138",
  Dart: "#00B4AB",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Astro: "#ff5a03",
  Lua: "#000080",
  Elixir: "#6e4a7e",
  Erlang: "#B83998",
  Haskell: "#5e5086",
  Elm: "#60B5CC",
  Clojure: "#db5855",
  Perl: "#0298c3",
  R: "#198CE7",
  Julia: "#a270ba",
  Shell: "#89e051",
  Zig: "#ec915c",
  Other: "#9ca3af",
};
const CATEGORY_ORDER: TechCategory[] = ["Language", "Framework", "UI", "Styling", "State & data", "Backend", "Testing", "Tooling"];

function Meta({ icon, children, title }: { icon: ReactNode; children: ReactNode; title?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={title}>
      {icon}
      {children}
    </span>
  );
}

/** Everything about the project that is not the map: what it is, what it is built with, its parts and where to start reading. */
export function ProjectPanel({
  overview,
  analysis,
  roles,
  warnings,
  analysedAt,
  onModule,
  onFile,
  ai,
}: {
  overview: ProjectOverview;
  analysis: ProjectAnalysis;
  roles: Record<FileRole, number>;
  warnings: string[];
  analysedAt: number;
  onModule: (module: string) => void;
  onFile: (file: string) => void;
  /** The AI's full pass: a button, or what it found. */
  ai: ReactNode;
}) {
  const { source, github } = overview;
  const colors = moduleColors(analysis.modules.keys(), analysis.labels);
  const hidden = roles.test + roles.story + roles.example + roles.config + roles.declaration;
  const maxModuleLoc = Math.max(1, ...analysis.stats.map((m) => m.loc));
  const totalLangLoc = overview.languages.reduce((s, l) => s + l.loc, 0) || 1;
  const stackByCategory = CATEGORY_ORDER.map((c) => [c, overview.techStack.filter((t) => t.category === c)] as const).filter(([, items]) => items.length > 0);
  const about = overview.readme?.summary ?? overview.description;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      {warnings.map((w) => (
        <p key={w} className="mb-3 flex items-start gap-2 rounded-lg border-2 border-[var(--warn)] px-3 py-2 text-[14px] text-[var(--warn)]">
          <Icon.Alert className="mt-0.5 h-4 w-4 shrink-0" />
          {w}
        </p>
      ))}

      {/* Who and what */}
      {source.kind === "github" && (
        <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[14px] text-[var(--muted)] hover:text-[var(--foreground)]">
          <Icon.GitHub className="h-4 w-4" />
          {source.owner}/{source.repo}
          {source.subdir && <span>/{source.subdir}</span>}
          {source.private && (
            <span className="ml-1 inline-flex items-center gap-1 text-[13px]">
              <Icon.Lock className="h-3 w-3" /> private
            </span>
          )}
        </a>
      )}
      <p className="font-letter mt-1 text-[25px] font-extrabold leading-[1.15] [text-wrap:balance]">{overview.readme?.title ?? overview.name}</p>
      {overview.description && overview.description !== about && <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--muted)]">{overview.description}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[14px] text-[var(--muted)]">
        {github && (
          <>
            <Meta icon={<Icon.Star className="h-4 w-4" />} title="Stars">
              {formatCount(github.stars)}
            </Meta>
            <Meta icon={<Icon.Fork className="h-4 w-4" />} title="Forks">
              {formatCount(github.forks)}
            </Meta>
            {github.license && (
              <Meta icon={<Icon.Scale className="h-4 w-4" />} title="Licence">
                {github.license}
              </Meta>
            )}
            {github.pushedAt && (
              <Meta icon={<Icon.Clock className="h-4 w-4" />} title={`Last push ${github.pushedAt}`}>
                updated {timeAgo(github.pushedAt, analysedAt)}
              </Meta>
            )}
          </>
        )}
      </div>
      {source.kind === "github" && (
        // The analysed commit, printed like a comic's issue number.
        <a
          href={`${source.url}/tree/${source.commit}`}
          target="_blank"
          rel="noreferrer"
          title="The exact commit Kosmos read"
          className="mt-3 inline-flex items-center gap-2 rounded-[4px] border-2 border-[var(--ink)] px-2 py-0.5 text-[13px] hover:bg-[var(--hover)]"
        >
          <span className="font-letter font-extrabold">No. {source.commit.slice(0, 7)}</span>
          <span className="text-[var(--muted)]">{source.branch}</span>
        </a>
      )}
      {source.kind === "local" && <p className="mt-2 break-all font-mono text-[13px] text-[var(--muted)]">{source.path}</p>}
      {github && github.topics.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Topics">
          {github.topics.slice(0, 10).map((t) => (
            <li key={t} className="rounded-full border-[1.5px] border-[var(--border)] px-2.5 py-0.5 text-[13px]">
              {t}
            </li>
          ))}
        </ul>
      )}
      {(source.kind === "github" || github?.homepage) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {source.kind === "github" && (
            <a href={source.url} target="_blank" rel="noreferrer" className="k-btn k-btn-small">
              <Icon.GitHub className="h-4 w-4" /> Open on GitHub
            </a>
          )}
          {github?.homepage && (
            <a href={github.homepage} target="_blank" rel="noreferrer" className="k-btn k-btn-small">
              Website <Icon.External className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      )}

      <Heading>What it is</Heading>
      {about ? (
        <>
          <p className="text-[15px] leading-relaxed">{about}</p>
          <p className="mt-1.5 text-[13px] text-[var(--muted)]">{overview.readme?.summary ? `From ${overview.readme.file}.` : "From the repository description."}</p>
        </>
      ) : (
        <p className="text-[15px] text-[var(--muted)]">The project has no README text to summarise.</p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <MiniStat label="code files" value={formatCount(analysis.graph.nodes.length)} />
        <MiniStat label="lines" value={formatCount(analysis.totalLoc)} />
        <MiniStat label="parts" value={analysis.modules.size} />
        <MiniStat label="imports" value={formatCount(analysis.graph.edges.length)} />
      </div>
      {hidden > 0 && <p className="mt-1.5 text-[13px] text-[var(--muted)]">Plus {hidden} tests, examples and config files, hidden on the map unless you turn them on under View.</p>}

      <Heading>The AI&apos;s take</Heading>
      {ai}

      <Heading>The parts</Heading>
      <p className="mb-2 text-[14px] text-[var(--muted)]">
        {analysis.grouping === "folders" ? <>Each part is a folder{analysis.prefix ? <> inside <span className="font-mono">{analysis.prefix}/</span></> : null}.</> : "Each part is a group of files that work together."} Pick one to see it on the map.
      </p>
      <ul>
        {analysis.stats.map((m) => (
          <li key={m.id}>
            <button onClick={() => onModule(m.id)} className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-[var(--hover)]">
              <span className="h-3 w-3 shrink-0 rounded-[3px] border-[1.5px] border-[var(--ink)]" style={{ background: `var(--c${colors.get(m.id) ?? 0})` }} />
              <span className="min-w-0 flex-1 truncate text-[14.5px] font-bold">{analysis.labels[m.id] ?? m.id}</span>
              <span className="hidden h-2 w-16 shrink-0 overflow-hidden rounded-full bg-[var(--hover)] sm:block" aria-hidden>
                <span className="block h-full rounded-full bg-[var(--ink)]" style={{ width: `${(m.loc / maxModuleLoc) * 100}%` }} />
              </span>
              <span className="w-24 shrink-0 text-right text-[13px] tabular-nums text-[var(--muted)]">
                {m.files} {m.files === 1 ? "file" : "files"} · {formatLoc(m.loc)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Heading>Where to start reading</Heading>
      <p className="mb-1 text-[14px] text-[var(--muted)]">Files nothing else uses: this is where the code starts (pages, commands, the public API).</p>
      {analysis.entryPoints.length === 0 ? (
        <p className="px-2 text-[14px] text-[var(--muted)]">None found.</p>
      ) : (
        analysis.entryPoints.map((f) => <FileRow key={f.id} file={f.id} meta={`uses ${f.fanOut}`} onClick={() => onFile(f.id)} />)
      )}

      <Heading>What everything leans on</Heading>
      <p className="mb-1 text-[14px] text-[var(--muted)]">The most-used files. Change these with care.</p>
      {analysis.coreFiles.length === 0 ? (
        <p className="px-2 text-[14px] text-[var(--muted)]">None found.</p>
      ) : (
        analysis.coreFiles.map((f) => <FileRow key={f.id} file={f.id} meta={`used by ${f.fanIn}`} onClick={() => onFile(f.id)} />)
      )}

      <Heading>Worth a look</Heading>
      {analysis.cycles.length === 0 && analysis.godFiles.length === 0 ? (
        <p className="text-[15px]">No loops, and no file the rest leans on too heavily. Nicely kept.</p>
      ) : (
        <div className="space-y-3">
          {analysis.cycles.slice(0, 3).map((cycle, i) => (
            <div key={cycle.join("|")}>
              <p className="px-2 text-[14px] font-bold text-[var(--danger)]">Loop{analysis.cycles.length > 1 ? ` ${i + 1}` : ""}: these files need each other</p>
              {cycle.slice(0, 5).map((f) => (
                <FileRow key={f} file={f} onClick={() => onFile(f)} />
              ))}
              {cycle.length > 5 && <p className="px-2 text-[13px] text-[var(--muted)]">and {cycle.length - 5} more</p>}
            </div>
          ))}
          {analysis.cycles.length > 3 && <p className="px-2 text-[13px] text-[var(--muted)]">and {analysis.cycles.length - 3} more loops</p>}
          {analysis.godFiles.length > 0 && (
            <div>
              <p className="px-2 text-[14px] font-bold text-[var(--warn)]">Used far more than the rest</p>
              {analysis.godFiles.map((g) => (
                <FileRow key={g.id} file={g.id} meta={`used by ${g.fanIn}`} onClick={() => onFile(g.id)} />
              ))}
            </div>
          )}
        </div>
      )}

      {stackByCategory.length > 0 && (
        <>
          <Heading>Built with</Heading>
          <dl className="space-y-2">
            {stackByCategory.map(([category, items]) => (
              <div key={category} className="flex items-start gap-3">
                <dt className="w-24 shrink-0 pt-0.5 text-[13px] text-[var(--muted)]">{category}</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {items.map((t) => (
                    <span key={t.name} className="rounded-md border-[1.5px] border-[var(--ink)] px-2 py-0.5 text-[13.5px] font-bold">
                      {t.name}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
          {overview.packageInfo?.scripts.length ? (
            <p className="mt-3 text-[13px] text-[var(--muted)]">
              Scripts: <span className="font-mono">{overview.packageInfo.scripts.join(", ")}</span>
            </p>
          ) : null}
        </>
      )}

      {overview.languages.length > 0 && (
        <>
          <Heading>Languages</Heading>
          <div className="flex h-3 w-full overflow-hidden rounded-full border-[1.5px] border-[var(--ink)]">
            {overview.languages.map((l) => (
              <span key={l.name} style={{ width: `${(l.loc / totalLangLoc) * 100}%`, background: LANGUAGE_COLORS[l.name] ?? LANGUAGE_COLORS.Other }} title={`${l.name}: ${l.loc} lines`} />
            ))}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-x-5 gap-y-1.5">
            {overview.languages.map((l) => (
              <li key={l.name} className="flex items-center gap-2 text-[14px]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: LANGUAGE_COLORS[l.name] ?? LANGUAGE_COLORS.Other }} />
                <span className="font-bold">{l.name}</span>
                <span className="ml-auto tabular-nums text-[var(--muted)]">{Math.round((l.loc / totalLangLoc) * 100)}%</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 pb-2 text-[13px] text-[var(--muted)]">Counted over every code file, tests and examples included.</p>
        </>
      )}
    </div>
  );
}
