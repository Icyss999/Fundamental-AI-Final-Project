# Kosmos (Codebase Architecture Mapper)

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

The app is called **Kosmos** ("organised"); its look is a minimal comic page. Design brief, verdicts and rules for
the map: `DESIGN.md` (read it before changing UI). **Every page is a route** (user verdict), and **the results show
only what the AI made** (user verdict; the manual controls were removed):

- `/` — start page: paste a GitHub URL (or `owner/repo`, or `…/tree/<branch>/<folder>`), pick one of your repos
  (optional **Sign in with GitHub**, private included) or an example → `/analyze?repo=…`.
- `/analyze?repo=…` — the **waiting screen**: the server shallow-clones and reads the code (streamed progress), then the
  AI's pass starts (1 `cluster_modules` → `set_architecture` with a `kind` per part; 2 review the riskiest files →
  `report_findings`; 3 rules → A* plan → `attach_patch` per step). It waits **only for stage 1** (user verdict), shown
  as numbered panels inking in, the AI's current tool call and a timer, then replaces itself with
  `/map/structure?repo=…`; stages 2–3 carry on in the background. A failed stage 1 offers "Try again" or "Open the map
  anyway" (folders). Without a DeepSeek key: "Show Kosmos's own results" (folders, Bayes from history, rules from
  folder names, an automatic A* plan).
- `/map/structure`, `/map/bug-risk`, `/map/refactor` (`?repo=…`) — the results, sharing the `/map` layout (header with
  the mode tabs as links (keys 1 2 3), Ask AI, New repo, account; one map panel; the shared panels). Each page renders
  its yellow **story box** and its own panel. While the AI still works on Bug risk or Refactor, that page shows an
  **"Analyzing…" panel** over the map (the three steps, the AI's current tool call, "Look at the parts meanwhile"; a
  failed stage offers "Try again"), and its tab a spinner (then a dot when the result is new, a warning if it failed).
  The AI's view changes are muted while its pass runs. Structure: the AI's named parts, the story, **the tour** (T /
  → / ← / Esc). Bug risk: red halftone dots, "Bugs found" (each AI finding opens to its code with the faulty line in red; its
  box gets a red outline), the Bayes ranking with the AI's evidence, read-only test results. Refactor: the AI's rules
  (read-only), violations with proofs, its A* plan to play ("All tidy!" when nothing breaks), patches per step.
  A map page without a finished session for that repo (e.g. after a reload) goes to `/analyze` (the pass runs again).

At most one side panel is open (closed by default). Plain words first; the maths sits under "How was this worked
out?". Tests, examples, stories and config are hidden unless turned on under View. Every file/folder links to its
source on GitHub, pinned to the analysed commit. The **chat** ("Ask Kosmos") stays: the AI's tools run the three
layers' algorithms and drive the map (modes = navigation, zoom, cyan highlights) and write fixes as diffs (the app
never writes to the repo). **The map is grouped only by the AI's parts** (user verdict): raw MQ clusters are computed
for the AI (and the evaluation) but never drawn; there is no grouping choice.
**The map is a simple relationship diagram** (user verdict): one labelled box per part (name + one line of purpose),
**only the main connections drawn at rest** (user verdict 2026-11-12, "minimize to the main points"; no shelves): an
arrow already told by a strong enough detour through other parts, or one pointing up the map, is left out and appears
when one of its parts is hovered or picked (or under View → "Show every connection"). Loops side by side, rows that wrap
at 4 parts, and **a shape per kind of part**
(`src/lib/graph/kinds.ts`: ui = window, entry = pill, logic = hexagon, data = cylinder, shared = library box, external
= parallelogram, config = document) with a key in the map's corner. Kinds come from the AI (`set_architecture`) or
`classifyModule` (folder/file names). Opening a part still shows its files; the plan plays on the part-level map.
**Boxes can't be dragged** (user verdict 2026-11-12): the map has two fixed pictures, every part closed, and the same
map with the parts the user opened showing their files, where every part keeps its row and its place in the row and
the arrows between parts stay the same part-level arrows (a file's own arrows show when that file is in focus).

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
- `src/lib/graph/project-analysis.ts` — `analyzeProject(graph, name, includeAll, grouping?)`: everything the project panel and
  Diagram derive from a graph. A `Grouping` replaces the folder modules (uncovered files keep theirs); `prefix` stays
  folder-based because rules use paths. The project panel and Layers 2/3 always use the folder analysis; only the diagram regroups.
- `src/lib/cluster/` (Phase 2, from scratch) — `mq.ts` (TurboMQ, CF = 2μ/(2μ+ε); type-only imports weigh 0.5;
  `ModularityState` scores a one-file move in O(degree)), `search.ts` (steepest-ascent hill climbing with random restarts;
  simulated annealing with T0 from sampled worsening moves at p=0.8, geometric cooling, best-seen + HC polish; seeded
  mulberry32; candidate targets = neighbour clusters + one new cluster; `placeIsolated` puts import-less files with their
  folder-mates), `grouping.ts` (`clusterProject`, `partitionMQ`, `clusterLabels` from dominant folders,
  `architectureGrouping` for the AI's modules: ids `ai-N`, labels, descriptions, tiers). Sample: MQ ≈ 2.20 vs folders 0.77.
- `src/lib/graph/view.ts` — (graph, partition, expanded modules) → visible boxes and merged edges (`members` = the
  file-level `importKey`s behind each edge, so overlays can colour merged edges). Imports between two modules are one
  module-level edge whether they are open or not; inside an opened module, file-to-file edges (those told by a detour,
  `mainLinks`, are `detail`); a file's own imports across modules are `detail` edges. `detail` ⇒ `minor`, drawn only
  while one of its own two boxes is in focus (not its whole part).
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
  schemas, incl. `cluster_modules` (never drawn), `set_architecture`, `report_findings`, `attach_patch`), `autopilot.ts`
  (the three stage prompts and round budgets), `workspace.ts` (`AssistantWorkspace`: snapshot of Layer 2/3 state that tools mutate *immediately* — React
  only catches up after a render, so `set_rules` then `plan_refactoring` in one turn must see the new rules — and
  pushes every change to the UI through `WorkspaceEffects`; `resolvePath` for paths as people write them),
  `execute.ts` (tool handlers → `{content, summary, ok}`; errors go back to the model, never thrown), `brief.ts`
  (project brief in the system prompt; `<app_state>` prefixed to each user message).
- `src/lib/layers.test.ts` — both layers end to end on the sample (expected ranking and plan). `src/lib/ai/execute.test.ts`
  — the tools on the sample (same ranking and plan through the AI path).

Client:
- Routes: `src/app/page.tsx` (`Landing`), `src/app/analyze/page.tsx` (`AnalyzeScreen`), `src/app/map/layout.tsx`
  (`MapShell`), `src/app/map/{structure,bug-risk,refactor}/page.tsx` (`StructureView` / `RiskView` / `RefactorView`),
  `src/app/map/page.tsx` (→ structure). Pages reading `?repo=` sit under `<Suspense>` (Cache Components rule).
- `src/components/app/` — `session.tsx`: `SessionRoot` (in the root layout, so state survives navigation: the analysis
  run + GitHub session + repo input; `useRun()`), and per finished run a `ProjectSession` (`useProject()`): Layer 2/3
  state, groupings, selection/highlights, the AI assistant + autopilot with its snapshot/effects, `ready` once the
  pass is done; mode comes from the pathname, `goMode` navigates; the AI's view effects are skipped while the map is
  not on screen (`setMapMounted`). `routes.ts` (`mapHref`, `analyzeHref`, `modeFromPath`, `canonicalSource`).
  `AnalyzeScreen`, `MapShell` (+ `useMap()`: panel, tour, focus helpers, `askAI`; `getInset` measures
  `[data-overlay]` so the camera frames around the story and panel), `ModeViews` (the three pages), `WorkspaceHeader`
  (+ `MODES`, `NewRepo`), `Story.tsx` (`StoryBox`, `TourBox`, `SentenceText`, `Burst`), `SidePanel`, `ProjectPanel`,
  `Landing` (+ `CoverMap`), `RepoForm`, `RepoPicker`, `AccountButton`, `useGitHubSession`, `stream.ts`, `ui.tsx`.
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
  not finish; stages after a failed one are `skipped`; `start(only)` retries keep finished ones), `AiOverviewCard`.
- `src/lib/graph/kinds.ts` — `ModuleKind`, `KIND_INFO` (plain names and meanings), `classifyModule` (tested). Shapes are
  drawn in `nodes.tsx` (`shapePath`, `KindShape` with dots and rings inside the outline, `KindGlyph` for the key).
- `src/lib/graph/organize.ts` (shelves = parts ≥60% of modules use and that use only shelves — switched off on the map
  with `maxShelves: 0`; loop pairs; `rowsOf` = a row per part: the AI's tiers as bands, longest path inside a band,
  loops cut, pairs share a row, rows wrap at `MAX_ROW` = 4, parts without arrows in a grid underneath; `mainLinks` with
  `simplify` = the minor arrows: upward ones while both ends keep another arrow, then lightest first, an arrow a→b
  whose b is still reachable over kept arrows each ≥ `DETOUR_STRENGTH` (0.5) × its weight — reachability is kept, and
  on an acyclic map with strength 0 it is the transitive reduction) and
  `src/lib/graph/story.ts` (`mapRows`, `projectStory`, `buildTour`: plain sentences with module/file tokens) — pure,
  tested; both the map and the story read them.
- `src/components/mapper/` — `DiagramView` (React Flow canvas; `mode`, `display` graph for plan states, `overlay`
  for heat/violations/plan highlights — overlays never re-layout, `forceExpanded`, `animate`, `spotlight` (tour),
  `onNodeActivate`, `getInset`; every camera fit goes through `pad()`; refits on big resizes; arrows into shelves are
  hidden unless emphasised, then routed down a lane left of the map (`laneRoute`); minor arrows are hidden unless
  active or emphasised, then routed by `route.ts`, side by side where they share a box; View → "Show every
  connection" turns `simplify` off and re-lays out; boxes are never dragged: `closedView` (every part closed) is laid
  out first and cached in `closedLayoutRef`, and a view with opened parts is laid out with its spots as `plan.closed`),
  `layout.ts` (ELK layered + orthogonal routes; the organiser's rows → `elk.partitioning` (else module tiers);
  `separateConnectedComponents: false` so parts without arrows keep their rows; NETWORK_SIMPLEX placement (Brandes–Köpf
  staggered rows into a staircase); a closed part has one SOUTH out-port and one NORTH in-port per arrow, so junctions
  only ever branch from one source (the old `mergeEdges` trunks joined unrelated arrows into frames round the map);
  minor edges are not given to ELK; `plan.closed` = the closed map's spot per module, passed as `elk.position` with
  `crossingMinimization.semiInteractive` on the root and on loop-pair containers, so opened parts keep the closed
  map's order — `forceNodeModelOrder` did not hold the order in elkjs 0.12), `route.ts` (`routeAround`: an orthogonal
  path around the boxes for arrows ELK did not route — A* over the grid of lines `margin` outside each box side, cost =
  length + 60 per turn; searches within 160 px of the two ends first, then 480, then everywhere; gives up above 80
  boxes in the area), `edges.tsx` (draws the given route; smooth-step when there is none), `nodes.tsx`,
  `Inspector.tsx`, `panel.tsx` (shared sidebar pieces).
- `samples/restaurant-app/` — own test project with planted smells: pages import `data/db.ts` directly although
  `services/menuService.ts` wraps it (the planner's example goal), a `cartStore ↔ pricing` cycle, and god file
  `lib/utils.ts`. Co-located `*.test.ts(x)` give Layer 2 its coverage; `git-log.txt` is a recorded history
  (generated, `git log` format) with bug fixes concentrated in pricing/cartStore; `test-results.json` (Vitest JSON) is
  a pricing bug. Expected: Bayes ranks pricing.ts #1 (~73%), Ochiai #2; plan = 3 redirects via menuService + move
  `schema.ts` to `lib/` (cost 5.51; A* 55 expansions vs UCS ~254). Excluded from tsconfig/eslint/vitest.

**Phase 2 in the UI:** only the AI's grouping flows through `analyzeProject(..., grouping)` into the diagram;
`folderPartition` stays the evaluation baseline (MoJoFM is Phase 5). AI module ids are not folders — no GitHub folder
links.

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
- CSS: entrance animations use `animation-fill-mode: backwards` (`.k-enter`): `both` keeps the last keyframe's
  `opacity: 1` and stops boxes fading on focus. Global element rules (the `:focus-visible` ring) live in
  `@layer base`; unlayered CSS beats every Tailwind utility regardless of specificity.
- Window key handlers: `e.target` can be `window` (synthetic events) — check `instanceof Element` before `.closest`.
- React Flow `fitView` accepts per-side padding (`{ top: "120px", … }`); `DiagramView.pad()` turns a ratio plus the
  measured overlay insets into that. Overlays that should push the camera carry `data-overlay`.
- Comic tokens and component classes (`k-btn`, `k-btn-press`, `k-btn-ink` for buttons on the yellow box, `k-tab`,
  `k-link`, `k-halftone`, `k-sheet`, `k-fade`, `k-stamp`) are in `globals.css`; colours are the `--paper/--ink/--yel/
  --cyan/--red` tokens (old names like `--panel`, `--accent` alias them). Text on yellow is `--on-yel` in both themes.
- Cache Components keeps up to 3 visited routes alive but hidden (React `<Activity>`): their effects are cleaned up while
  hidden and re-run when shown, and hidden DOM has zero size (the inset measuring skips it).
- After adding routes, run `pnpm next typegen` if `tsc` complains about `LayoutProps`/`Route` (stale `.next/types`).
- Never commit, stage or push — the user owns the git history.
