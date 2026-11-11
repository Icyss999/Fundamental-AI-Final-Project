# Codebase Architecture Mapper

Fundamentals of AI course project. Turns a codebase in any common language (JS/TS, Python, Java/Kotlin/Scala/Groovy,
Go, Rust, C/C++/Objective-C, C#, PHP, Ruby, Swift, Dart, Vue/Svelte/Astro, Lua, Elixir, Erlang, Haskell, Elm,
Clojure, Perl, R, Julia, Shell, Zig) into an interactive diagram (files = components,
imports = connections), then: **See** the real architecture → **Diagnose** likely bug locations → **Change** it
safely with a planned refactoring. All three layers share one diagram.

## Hard constraint

The AI algorithms are what the course grades, so they are written **from scratch in TypeScript** — no libraries for:
MQ scoring, hill climbing, simulated annealing, Bayesian scoring, A* planning, the forward-chaining rule engine.
Libraries are fine for plumbing only (dependency-cruiser, React Flow, elkjs, coverage tools).

## Layers and status

| Phase (weeks) | Layer | Technique | Status |
|---|---|---|---|
| 1 (1–3) | Graph: extract imports, render diagram, cycles + god files | — | **done** |
| 2 (4–6) | 1 · See: group files into modules | MQ + hill climbing + simulated annealing (GA optional) | **done** (no GA) |
| 3 (7–9) | 2 · Diagnose: bug heatmap, "why suspected", ranked list | Bayes (git-history prior × coverage likelihood, log-probs); baseline Ochiai | **done** |
| 4 (10–11) | 3 · Change: rules, violations, animated plan | A* over STRIPS actions (MoveFile, RedirectImport); admissible h = greedy matching over violating edges; forward chaining for rules | **done** |
| 5 (12) | Evaluation + report | MoJoFM/MQ vs folder baseline; top-k vs Ochiai; plan cost/nodes expanded vs UCS | todo |
| — | AI over all layers + autopilot | LLM (DeepSeek) with tool calling: runs the algorithms, acts on the app (regroups the diagram, review findings → Bayes evidence, rules, plans, patches) | **done** |

Cross-layer: Layer 2 probabilities add risk cost to plan steps (done: `riskWeight × posterior/max`); after a plan,
re-cluster and show MQ before/after (todo — clustering exists now; the plan panel shows violations/cycles/cross-folder imports).

**h is not "remaining violating edges"** — that is inadmissible here, because one MoveFile fixes every violating edge
of the moved file at once (`change.test.ts` has the counter-example). The admissible bound: a greedy maximal matching
of violating edges (no shared file); each action touches ≤ 1 matched edge, so h = Σ over the matching of
`1 + riskWeight × min(risk)`. It is not always consistent, so A* re-opens states. "count" stays selectable for the
evaluation; random-instance tests check A*(matching) cost = UCS cost and expansions ≤ UCS.
Stretch: CreateService / ExtractFunction actions, LLM executes one approved step, CI mode, function-level graphs.

## User flow

Optionally **Sign in with GitHub** (pick from your own repos, private included). Paste a GitHub URL (or `owner/repo`,
or `…/tree/<branch>/<folder>`) → the server shallow-clones it and streams progress →
**Overview** tab (what the project is, stack, languages, modules, entry points, core files, health, bug-risk hotspots,
architecture check) and **Diagram** tab (folder modules you can open, hover, drag). Tests, examples, stories and config
are hidden unless toggled on. The diagram has three modes (top right): **Structure** (Layer 1), **Bug risk** (Layer 2:
heat per box, ranked list, "why suspected", test outcomes typed in or loaded from a report) and **Refactor** (Layer 3:
rules editor, violations with proofs, A* plan you can step through or play; boxes glide as files move).
Every file/folder links to its source on GitHub, pinned to the analysed commit (`src/lib/repo/links.ts`).
The **AI** panel (header button, docked right of both tabs) is a DeepSeek agent whose tools run the three layers'
algorithms and drive the UI: it switches modes, zooms, highlights files (violet ring + "highlighted by AI" pill),
sets test outcomes/rules, adopts and plays A* plans, reads source, and writes fixes/refactorings as diffs (the app
never writes to the repo). Bug risk and Refactor panels have "Ask AI" buttons; backticked paths in replies open the file.
**Autopilot** (runs when a project loads unless switched off — localStorage `architecture-mapper:autopilot`; also the
panel/Overview buttons): three messages, one per stage — 1) `cluster_modules` (MQ search) then `set_architecture`
(named modules, purposes, tiers → the diagram regroups, boxes glide, tiers stack top→bottom); 2) review the riskiest
files → `report_findings` (badges on boxes, "AI code review" list with fixes, Bayes evidence); 3) rules → A* plan →
play → `attach_patch` per step. The Overview's "AI autopilot" card summarises all three. The diagram's **Modules**
select switches folders / MQ clusters (computed on demand, no AI needed) / AI architecture.

## Code map

Server (Node only):
- `src/app/api/analyze/route.ts` — `POST { source }` → NDJSON stream of `progress` events, then one `result`/`error`.
  Uses the signed-in user's token when there is one.
- `src/lib/auth/auth.ts` — **Better Auth** (`betterAuth`) with GitHub as the only provider (`scope: ["repo"]` on top of
  `read:user user:email`), `nextCookies()` plugin last, and `getGitHubToken(headers)` (→ `auth.api.getAccessToken`
  with `useAccountCookie`). No database: Better Auth runs stateless — session in a JWE cookie, GitHub account + token
  in an encrypted `account_data` cookie. Secret: `BETTER_AUTH_SECRET`, else derived from `GITHUB_CLIENT_SECRET`.
  `src/app/api/auth/[...all]/route.ts` mounts every Better Auth endpoint (`toNextJsHandler`); GitHub's callback is
  `/api/auth/callback/github`. `src/lib/auth/client.ts` is the React client (`signIn.social`, `useSession`,
  `signOut`); `src/lib/auth/config.ts` + `/api/github/status` tell the UI whether credentials are set.
- `src/app/api/github/repos/route.ts` — the signed-in user's repositories for the picker.
- `src/lib/analyze.ts` — the pipeline: GitHub URL → metadata → clone → extract → history → overview. `"sample"`
  analyses `samples/restaurant-app` (history from its `git-log.txt`, plus `test-results.json` as `exampleReport`);
  absolute local paths are allowed in development only (their own `git log` is read).
- `src/app/api/assistant/route.ts` — GET `{configured, model}`; POST `{messages, context, effort, round}` → NDJSON
  `AssistantEvent`s (reasoning/text deltas, then one `done` with tool calls, or `error`). Adds the system prompt +
  tool specs; past `WRAP_UP_ROUND` tool rounds it appends a "answer now" system note. Per-IP rate limit (`limits.ts`).
- `src/app/api/source/route.ts` — POST `{source, path}` → `{text}` for `read_file` (`src/lib/repo/source.ts`: sample /
  dev-only local folders read with realpath containment; GitHub via `fetchRepoFile` at the analysed commit — API with a
  token, else raw.githubusercontent.com).
- `src/lib/ai/deepseek.ts` — DeepSeek client (OpenAI format, `https://api.deepseek.com/chat/completions`): SSE parsing,
  `ChatAccumulator` (tool-call fragments by index), error messages. Env: `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`
  (`deepseek-flash` default / `deepseek-v4-pro`), `DEEPSEEK_THINKING`. `prompt.ts` = system prompt (layers, workflow,
  rules DSL).
- `src/lib/repo/github.ts` — strict URL parsing, GitHub API metadata (optional `GITHUB_TOKEN` env raises the 60 req/h
  limit), shallow clone into `os.tmpdir()/architecture-mapper/repos` (15-min cache, in-flight dedupe, size limit).
  Safety: `execFile` without a shell, validated names, `core.symlinks=false`, no prompts/LFS. Nothing is executed.
  Private clones pass the token via `GIT_CONFIG_*` env (not argv, not saved in .git/config) and are cached per
  token hash, never in the shared public cache. An expired token falls back to anonymous for public repos.
  `deepenHistory` fetches `HISTORY_DEPTH` (300) commits by SHA with `--filter=blob:none` (commits + trees only;
  works for branch and tag clones), skipped when already deep enough.
- `src/lib/repo/history.ts` — `git log --name-only --relative --no-renames` in the analysed folder; drops the shallow
  boundary commits (git lists them as adding every file); `trimHistory` keeps graph files and the original file count.
- `src/lib/repo/overview.ts` — README → plain-text title/summary (never rendered as HTML), tech stack from
  package.json (frameworks only from runtime/peer deps) plus other ecosystems' build files (`detectEcosystem`:
  requirements/pyproject, go.mod, Cargo.toml, pom/Gradle, Gemfile, composer.json, .csproj, pubspec, mix.exs,
  Package.swift), languages with ≥5% of the code, language breakdown (`languageName`).
- `src/lib/graph/extract.ts` — `extractGraph`: dependency-cruiser for JS/TS (+ edges into .vue/.svelte/.astro), then
  `extractPolyglot` for every other language, combined by `mergeGraphs`. Per-file `role` follows each ecosystem's
  conventions (pytest `test_*.py`, Go `_test.go`, `src/test/`, `*Test.java`, `_spec.rb`, `X.Tests/`, Swift `Tests/`,
  `.pyi` = declaration, setup.py/build.rs/Gradle/migrations = config, `samples/`, `X.Examples/` = example). If
  tsconfig fails to load (missing `extends` package in a fresh clone), copies only `baseUrl`/`paths` into a temp config.
- `src/lib/graph/polyglot/` — other languages (no parser libraries): `index.ts` walks the project (skips vendored,
  build and virtualenv folders; caps 120k entries / 15k code files / 1 MB per file; reads go.mod, Cargo.toml,
  composer.json, pubspec.yaml) and runs every extractor (one that throws only loses its language's edges, as a
  warning). `lexer.ts` strips comments keeping strings (`scrub`; blanked strings for identifier scans), `languages.ts`
  (extensions, comment syntax, names), `project.ts` (pure in-memory `Project`: suffix index, `closest`, `EdgeSet`).
  `extractors/`: `python` (package roots by `__init__.py`, relative/`from` imports, src/ layouts), `jvm` (package + FQN
  index, wildcards, static, Scala braces, Kotlin top-level funs; same-package types used without import), `go`
  (go.mod module paths; `pkg.Ident` → the file declaring Ident; same-package names), `rust` (Cargo crates, `mod x;`,
  `use` trees via `expandUse`, `crate`/`self`/`super`/crate-name paths → deepest module file), `cfamily` (#include /
  #import: local, include roots, unique suffix), `csharp` (namespaces, using/static/alias/global using, visible types
  named), `php` (namespace/use/group use, PSR-4 from composer.json, inline FQNs, same-namespace, require), `ruby`
  (require(_relative), declared constants named), `swift` (types per SwiftPM target, imports), `dart` (package: via
  pubspec, relative, part), `web` (Vue/Svelte/Astro script imports, `@/`/`~/`), `misc` (Lua, Elixir aliases, Erlang,
  Haskell, Elm, Clojure ns, Perl, R, Julia, Shell, Zig). Identifier-based edges (same package/namespace/module) are
  heuristics: a declared type name used in a file counts as a dependency.

Shared / pure (unit-tested):
- `src/lib/graph/types.ts` — `DepGraph`, `FileNode` (`role`: source/test/story/example/config/declaration, `loc`),
  `ImportEdge`, `Partition` (file id → module id). File ids are POSIX paths relative to the analysed root.
- `src/lib/graph/analysis.ts` — degrees, import cycles (iterative Tarjan SCC), god files (fan-in z-score).
- `src/lib/graph/partition.ts` — `folderPartition` (the evaluation baseline), `autoFolderPartition` (strips the shared
  prefix, deepest folder level with ≤14 modules — what the UI uses), `modulesOf`, `moduleGraph` (what MQ needs).
- `src/lib/graph/insights.ts` — role filtering, module stats, entry points, core files, summary sentences.
- `src/lib/graph/project-analysis.ts` — `analyzeProject(graph, name, includeAll, grouping?)`: everything Overview and
  Diagram derive from a graph. A `Grouping` replaces the folder modules (uncovered files keep theirs); `prefix` stays
  folder-based because rules use paths. Overview and Layers 2/3 always use the folder analysis; only the diagram regroups.
- `src/lib/cluster/` (Phase 2, from scratch) — `mq.ts` (TurboMQ, CF = 2μ/(2μ+ε); type-only imports weigh 0.5;
  `ModularityState` scores a one-file move in O(degree)), `search.ts` (steepest-ascent hill climbing with random restarts;
  simulated annealing with T0 from sampled worsening moves at p=0.8, geometric cooling, best-seen + HC polish; seeded
  mulberry32; candidate targets = neighbour clusters + one new cluster; `placeIsolated` puts import-less files with their
  folder-mates), `grouping.ts` (`clusterProject`, `partitionMQ`, `clusterLabels` from dominant folders,
  `architectureGrouping` for the AI's modules: ids `ai-N`, labels, descriptions, tiers). Sample: MQ ≈ 2.20 vs folders 0.77.
- `src/lib/graph/view.ts` — (graph, partition, expanded modules) → visible boxes and merged edges (`members` = the
  file-level `importKey`s behind each edge, so overlays can colour merged edges).
- `src/lib/diagnose/` (Layer 2) — `history.ts` (log parser, bug-fix keyword classifier, recency-weighted per-file
  counts, bulk commits skipped), `coverage.ts` (test cases = test files nothing imports; static coverage = BFS over
  value imports, `decay^(hops-1)`), `bayes.ts` (Gamma–Poisson prior λ = (κ·m·√size + fixes + ω·changes)/(κ+1);
  single-fault likelihood `P(fail) = cα + (1-cα)ε` as per-test Bayes factors; log-sum-exp; Ochiai; tie-aware ranks),
  `reports.ts` (Jest/Vitest/Mocha JSON, JUnit XML → per-test-file outcome; `matchTestFile` also maps JUnit class names
  `com.x.FooTest` / `tests.test_api.TestX` and Go package paths; `reportFailures` = assertion messages),
  `diagnose.ts` (`prepareDiagnosis` = the outcome-independent part; `scoreDiagnosis` → ranked `FileRisk`s with factors
  for "why suspected"; optional `ReviewEvidence`), `review.ts` (AI findings; code review as evidence: flagged file
  BF = (φ + w(ρ−φ))/φ with severity weight w, read-and-clean BF = (1−ρ)/(1−φ); ρ=0.7, φ=0.1 → high ×7, clean ×1/3).
- `src/lib/change/` (Layer 3) — `engine.ts` (Datalog: parser, safety check, stratification by Tarjan SCC, semi-naive
  evaluation with indexes, negation as failure, provenance → proof trees), `rules.ts` (rules DSL `layers/forbid/only/
  allow/keep` → facts, `RULE_BASE`, `Policy.check` memoised per pattern *signature*, `evaluate` = whole-graph run,
  `explain`, `suggestRules`), `planner.ts` (STRIPS actions with pre/add/del applied to a delta state; relevant-action
  generation with signature-based symmetry pruning; binary heap; A* with re-opening; `edgesAfter`).
- `src/lib/change/describe.ts` — plan text/metrics shared by the Refactor panel and the AI: `describeStep`, `pathAfter`,
  `structureMetrics`, `compareSearches`.
- `src/lib/ai/` (client-safe except deepseek/limits) — `protocol.ts` (wire types, `parseChatRequest`), `specs.ts` (23 tool
  schemas, incl. `cluster_modules`, `set_architecture`, `set_grouping`, `report_findings`, `attach_patch`), `autopilot.ts`
  (the three stage prompts and round budgets), `workspace.ts` (`AssistantWorkspace`: snapshot of Layer 2/3 state that tools mutate *immediately* — React
  only catches up after a render, so `set_rules` then `plan_refactoring` in one turn must see the new rules — and
  pushes every change to the UI through `WorkspaceEffects`; `resolvePath` for paths as people write them),
  `execute.ts` (tool handlers → `{content, summary, ok}`; errors go back to the model, never thrown), `brief.ts`
  (project brief in the system prompt; `<app_state>` prefixed to each user message).
- `src/lib/layers.test.ts` — both layers end to end on the sample (expected ranking and plan). `src/lib/ai/execute.test.ts`
  — the tools on the sample (same ranking and plan through the AI path).

Client:
- `src/components/app/` — `AnalyzerApp` (streaming, header, tab state), `ProjectWorkspace` (keyed per analysis: both
  tabs, stay mounted; builds the plan-state graph + overlays), `Landing`, `Overview`, `RepoForm`, `RepoPicker`,
  `AccountButton`, `useGitHubSession`, `stream.ts`, `ui.tsx` (cards, chips, icons).
- `src/components/layers/` — `useLayers` (Layer 2/3 state: outcomes, params, rules, plan, playback; a plan is tied to
  the rules *text* it was made for, so editing rules retires it; `adoptPlan`/`adoptComparison` take results computed by
  the AI; `report` = last loaded test report, whose failure messages `get_test_failures` reads; `review` + `useReview`
  = the AI's findings and whether they count; `patches` per plan step, kept with the plan object), `DiagnosePanel`,
  `ChangePanel`, `format.ts`.
- `src/components/assistant/` — `useAssistant` (the agent loop in the browser: stream a reply, run its tool calls in
  order against one fresh `AssistantWorkspace`, send results back, ≤16 rounds; keeps `reasoning_content`, which
  DeepSeek requires on later requests when tools are used; `toApiMessages` answers cancelled calls), `AssistantPanel`,
  `Markdown.tsx` (safe subset, no HTML; inline code naming a file/module becomes a diagram link; diff colouring),
  `client.ts`, `useAutopilot` (stages in sequence via `send(prompt, {stage, maxRounds})`, stops at the first that does
  not finish), `AiOverviewCard`. `ProjectWorkspace` builds the snapshot + effects in an effect-updated ref (`live`) and
  holds the groupings (`applyGrouping`: regroup animation, small projects open every new module).
- `src/components/mapper/` — `DiagramView` (React Flow canvas; `mode`, `display` graph for plan states, `overlay`
  for heat/violations/plan highlights — overlays never re-layout, `forceExpanded`, `animate`, `sidebar` slot),
  `layout.ts` (ELK layered + orthogonal routes; module tiers → `elk.partitioning`), `edges.tsx` (draws ELK's route; falls back to smooth-step once an
  endpoint is dragged), `nodes.tsx`, `Inspector.tsx`, `panel.tsx` (shared sidebar pieces).
  Dragged positions are "pins" (`pinsRef`, keyed by view node id; children relative to their group) that survive
  expand/collapse re-layouts: `applyPins` restores them, pushes colliding boxes sideways, and grows groups to fit.
- `samples/restaurant-app/` — own test project with planted smells: pages import `data/db.ts` directly although
  `services/menuService.ts` wraps it (the planner's example goal), a `cartStore ↔ pricing` cycle, and god file
  `lib/utils.ts`. Co-located `*.test.ts(x)` give Layer 2 its coverage; `git-log.txt` is a recorded history
  (generated, `git log` format) with bug fixes concentrated in pricing/cartStore; `test-results.json` (Vitest JSON) is
  a pricing bug. Expected: Bayes ranks pricing.ts #1 (~73%), Ochiai #2; plan = 3 redirects via menuService + move
  `schema.ts` to `lib/` (cost 5.51; A* 55 expansions vs UCS ~254). Excluded from tsconfig/eslint/vitest.

**Phase 2 in the UI:** groupings flow through `analyzeProject(..., grouping)` into the diagram only; `folderPartition`
stays the evaluation baseline (MoJoFM is Phase 5). Cluster/AI module ids are not folders — no GitHub folder links.

## Commands

- `pnpm dev` — app at http://localhost:3000
- `pnpm test` — vitest (`src/**/*.test.ts`, `@/` alias in `vitest.config.mts`); `pnpm lint`; `pnpm build`

## Notes

- Next.js 16 with `cacheComponents`: APIs differ from older Next — check `node_modules/next/dist/docs/` before using
  Next APIs. `next dev` regenerates `AGENTS.md`. If the dev server stops reflecting edits (stale CSS/API), restart it.
- File reads on analysed-repo paths carry `/*turbopackIgnore: true*/` so the build doesn't trace the whole project.
- React Flow: don't name a custom node type `group` (collides with the built-in type's CSS); `visibility: hidden` on a
  parent doesn't hide nodes (they set `visibility: visible`), so inactive tabs are stacked underneath instead.
- ELK (elkjs 0.12): with `direction: DOWN`, a compound node's `nodeSize.minimum` is read as (height, width).
  `elk.json.edgeCoords: ROOT` makes edge routes absolute. A module whose files are all imported from the same layer
  renders as one wide row — ELK's layering can't wrap it; clustering (Phase 2) splits such modules.
- Tailwind v4: `ring-[var(--x)]` is ambiguous (read as width) — write `ring-[color:var(--x)]`.
- Route files may only export HTTP handlers; shared helpers live in `src/lib`.
- Better Auth: keep `BETTER_AUTH_URL` equal to the address in the browser — without it, production mode uses
  `__Secure-` https-only cookies, which plain-http non-localhost addresses reject. Additional user fields marked
  `input: false` are also dropped from `mapProfileToUser`, so `login` is a normal (display-only) field.
  Failed sign-ins return to `/?error=<code>`; messages live in `useGitHubSession.ts`.
- With Cache Components, a GET route that reads no request data is prerendered — call `await connection()` when it
  reads env/runtime state (see `/api/github/status`).
- `src/lib/repo/overview.ts` imports `node:fs` — client code must not import values from it (types are fine);
  client-safe helpers go in separate modules like `links.ts`.
- next/image `remotePatterns`: `new URL("https://host/**")` only matches URLs without a query string.
- Heat shading uses one scale for every painted box (file probability or module sum); open groups aren't painted and
  don't set the scale. Per-kind scales made 5% modules look as hot as a 73% file.
- React compiler lint (`react-hooks/refs`): calling a render prop with handlers that close over refs during render is
  flagged — render it through a component (`SidebarSlot`) instead; don't write `ref.current` during render.
- To check UI in a browser while `pnpm dev` serves stale CSS: `pnpm build && pnpm next start -p <port>` (Next 16 keeps
  dev output in `.next/dev`, so this doesn't disturb a running dev server).
- AI assistant: the LLM orchestrates and explains; rankings, violations and plans always come from the from-scratch
  algorithms via tools (the course constraint). Tools run client-side; the server only holds the key. DeepSeek's
  thinking mode is on by default and needs every earlier `reasoning_content` passed back while tools are in use.
  A trailing system message after tool results is accepted (used for the wrap-up note, sent when a reply is within 4
  rounds of its budget).
- ELK partitioning (`elk.partitioning.activate` + per-node `elk.partitioning.partition`) works with
  `INCLUDE_CHILDREN` and with edges pointing against the tier order (checked with elkjs 0.12).
- DiagramView re-frames the camera when `analysis.partition` changes even while animating (regroups); plan playback
  changes `display`, not `analysis`, so the camera stays put there.
- React compiler memo lint: read optional overlay fields into a local first (`const x = overlay?.y`) — a non-optional
  `overlay.y` inside the memo makes it infer `overlay` as the dependency.
- Never commit, stage or push — the user owns the git history.
