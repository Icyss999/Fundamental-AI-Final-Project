# Codebase Architecture Mapper

Interactive tool that turns a JS/TS codebase into a diagram, highlights where bugs are most likely hiding, and plans
safe refactorings toward an architecture you draw. Fundamentals of AI course project — the search, Bayesian and
planning algorithms are implemented from scratch.

## Run

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

Paste a public GitHub repository URL (e.g. `https://github.com/pmndrs/zustand`, `owner/repo`, or a
`…/tree/<branch>/<folder>` link) and press **Analyze**. The **Overview** tab explains what the project is and how its
code is organised; the **Diagram** tab shows folders as modules — click one to open it, hover to trace imports, drag to
rearrange. Set `GITHUB_TOKEN` in the environment to raise GitHub's API rate limit (60 requests/hour without it).
Click **Built-in sample project** for a small app with planted problems, a recorded git history and a test report.

The diagram has three modes (top right):

- **Structure** — modules, imports, import cycles and over-depended-on files.
- **Bug risk** — how likely each file is to contain a bug, shown as a heat map and a ranked list. The prior comes from
  the git history (the last 300 commits: bug-fix commits weigh most, recent ones more than old ones, file size as a
  baseline). Mark test files as passing/failing, or load a report (`vitest --reporter=json`, `jest --json`, Mocha
  JSON or JUnit XML — read in the browser, nothing is uploaded), and Bayes' rule updates every file. Coverage is read
  from the imports, so nothing from the repository is run. Click a file to see *why* it is suspected: its history and
  the factor each test result contributes. The Ochiai ranking is shown alongside as the classic baseline.
- **Refactor** — write the architecture you want (suggested from your folder names), for example

  ```
  layers: pages > components > services, state > data > lib
  forbid: pages, components -> data
  ```

  A rule engine lists every import that breaks the rules, with the proof it derived. **Find a plan** searches (A*)
  for the cheapest sequence of file moves and import redirects that fixes them all; avoiding files that Bug risk
  flags makes a step cost more. Step through the plan or play it — boxes move on the diagram as it goes.
  **Compare** runs the same problem with three searches (two heuristics and uniform-cost) side by side.

## Sign in with GitHub (optional)

Public repositories work without signing in. Signing in (via [Better Auth](https://better-auth.com)) lets you pick
from your own repositories — private ones included — and uses your account's higher GitHub API limit. One-time setup:

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
   (https://github.com/settings/developers) and enter
   - Homepage URL: `http://localhost:3000`
   - Authorization callback URL: `http://localhost:3000/api/auth/callback/github`
2. Copy `.env.example` to `.env.local`, fill in `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (generate a client
   secret on the app's page), and keep `BETTER_AUTH_URL` equal to the address you open the app at.
3. Restart `pnpm dev`, then click **Sign in with GitHub**.

Better Auth runs without a database here: the session and the linked GitHub account (with its access token) live in
encrypted, httpOnly cookies, so there is nothing to install or migrate and the token never reaches browser JavaScript.
GitHub will ask for the `repo` scope because OAuth Apps have no read-only scope for private repositories; the app only
ever reads (shallow `git clone` + metadata). For read-only access, register a **GitHub App** instead (Repository
permissions → Contents: Read-only, Metadata: Read-only; Account permissions → Email addresses: Read-only), install it
on the repositories you want, and use its client ID/secret — Better Auth also refreshes its expiring tokens.

Every file and folder in the Overview, the diagram and the inspector links to its source on GitHub, pinned to the
exact commit that was analysed.

```bash
pnpm test       # unit, extraction and end-to-end layer tests
pnpm lint
pnpm build
```

See `CLAUDE.md` for the architecture, the phase plan and current status.
