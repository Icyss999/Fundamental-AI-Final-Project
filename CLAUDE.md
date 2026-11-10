# Codebase Architecture Mapper

Fundamentals of AI course project. Turns a JS/TS codebase into an interactive diagram (files = components,
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
| 2 (4–6) | 1 · See: group files into modules | MQ + hill climbing + simulated annealing (GA optional) | todo |
| 3 (7–9) | 2 · Diagnose: bug heatmap, "why suspected", ranked list | Bayes (git-history prior × coverage likelihood, log-probs); baseline Ochiai | **done** |
| 4 (10–11) | 3 · Change: rules, violations, animated plan | A* over STRIPS actions (MoveFile, RedirectImport); admissible h = greedy matching over violating edges; forward chaining for rules | **done** |
| 5 (12) | Evaluation + report | MoJoFM/MQ vs folder baseline; top-k vs Ochiai; plan cost/nodes expanded vs UCS | todo |

Cross-layer: Layer 2 probabilities add risk cost to plan steps (done: `riskWeight × posterior/max`); after a plan,
re-cluster and show MQ before/after (todo with Phase 2 — the plan panel shows violations/cycles/cross-folder imports).

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
  package.json (frameworks only from runtime/peer deps), language breakdown.
- `src/lib/graph/extract.ts` — dependency-cruiser → `DepGraph` with per-file `role` and `loc`. If tsconfig fails to
  load (missing `extends` package in a fresh clone), copies only `baseUrl`/`paths` into a temp config.

Shared / pure (unit-tested):
- `src/lib/graph/types.ts` — `DepGraph`, `FileNode` (`role`: source/test/story/example/config/declaration, `loc`),
  `ImportEdge`, `Partition` (file id → module id). File ids are POSIX paths relative to the analysed root.
- `src/lib/graph/analysis.ts` — degrees, import cycles (iterative Tarjan SCC), god files (fan-in z-score).
- `src/lib/graph/partition.ts` — `folderPartition` (the evaluation baseline), `autoFolderPartition` (strips the shared
  prefix, deepest folder level with ≤14 modules — what the UI uses), `modulesOf`, `moduleGraph` (what MQ needs).
- `src/lib/graph/insights.ts` — role filtering, module stats, entry points, core files, summary sentences.
- `src/lib/graph/project-analysis.ts` — `analyzeProject()`: everything Overview and Diagram derive from a graph.
- `src/lib/graph/view.ts` — (graph, partition, expanded modules) → visible boxes and merged edges (`members` = the
  file-level `importKey`s behind each edge, so overlays can colour merged edges).
- `src/lib/diagnose/` (Layer 2) — `history.ts` (log parser, bug-fix keyword classifier, recency-weighted per-file
  counts, bulk commits skipped), `coverage.ts` (test cases = test files nothing imports; static coverage = BFS over
  value imports, `decay^(hops-1)`), `bayes.ts` (Gamma–Poisson prior λ = (κ·m·√size + fixes + ω·changes)/(κ+1);
  single-fault likelihood `P(fail) = cα + (1-cα)ε` as per-test Bayes factors; log-sum-exp; Ochiai; tie-aware ranks),
  `reports.ts` (Jest/Vitest/Mocha JSON, JUnit XML → per-test-file outcome), `diagnose.ts` (`prepareDiagnosis` = the
  outcome-independent part; `scoreDiagnosis` → ranked `FileRisk`s with factors for "why suspected").
- `src/lib/change/` (Layer 3) — `engine.ts` (Datalog: parser, safety check, stratification by Tarjan SCC, semi-naive
  evaluation with indexes, negation as failure, provenance → proof trees), `rules.ts` (rules DSL `layers/forbid/only/
  allow/keep` → facts, `RULE_BASE`, `Policy.check` memoised per pattern *signature*, `evaluate` = whole-graph run,
  `explain`, `suggestRules`), `planner.ts` (STRIPS actions with pre/add/del applied to a delta state; relevant-action
  generation with signature-based symmetry pruning; binary heap; A* with re-opening; `edgesAfter`).
- `src/lib/layers.test.ts` — both layers end to end on the sample (expected ranking and plan).

Client:
- `src/components/app/` — `AnalyzerApp` (streaming, header, tab state), `ProjectWorkspace` (keyed per analysis: both
  tabs, stay mounted; builds the plan-state graph + overlays), `Landing`, `Overview`, `RepoForm`, `RepoPicker`,
  `AccountButton`, `useGitHubSession`, `stream.ts`, `ui.tsx` (cards, chips, icons).
- `src/components/layers/` — `useLayers` (Layer 2/3 state: outcomes, params, rules, plan, playback; a plan is tied to
  the `Policy` object it was made for, so editing rules retires it), `DiagnosePanel`, `ChangePanel`, `format.ts`.
- `src/components/mapper/` — `DiagramView` (React Flow canvas; `mode`, `display` graph for plan states, `overlay`
  for heat/violations/plan highlights — overlays never re-layout, `forceExpanded`, `animate`, `sidebar` slot),
  `layout.ts` (ELK layered + orthogonal routes), `edges.tsx` (draws ELK's route; falls back to smooth-step once an
  endpoint is dragged), `nodes.tsx`, `Inspector.tsx`, `panel.tsx` (shared sidebar pieces).
  Dragged positions are "pins" (`pinsRef`, keyed by view node id; children relative to their group) that survive
  expand/collapse re-layouts: `applyPins` restores them, pushes colliding boxes sideways, and grows groups to fit.
- `samples/restaurant-app/` — own test project with planted smells: pages import `data/db.ts` directly although
  `services/menuService.ts` wraps it (the planner's example goal), a `cartStore ↔ pricing` cycle, and god file
  `lib/utils.ts`. Co-located `*.test.ts(x)` give Layer 2 its coverage; `git-log.txt` is a recorded history
  (generated, `git log` format) with bug fixes concentrated in pricing/cartStore; `test-results.json` (Vitest JSON) is
  a pricing bug. Expected: Bayes ranks pricing.ts #1 (~73%), Ochiai #2; plan = 3 redirects via menuService + move
  `schema.ts` to `lib/` (cost 5.51; A* 55 expansions vs UCS ~254). Excluded from tsconfig/eslint/vitest.

**Seam for Phase 2:** the UI renders any `Partition` + labels. Clustering should produce a `Partition` and replace
`autoFolderPartition` inside `analyzeProject()` (keep `folderPartition` as the baseline for evaluation).

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
- Never commit, stage or push — the user owns the git history.
