/**
 * Tools the assistant can call (OpenAI function-calling format). Definitions only, shared by the
 * server (sends them to the model) and the browser (runs them, see execute.ts).
 */

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

const tool = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolSpec => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
});

const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });
const MODE = { type: "string", enum: ["structure", "risk", "refactor"], description: "structure = Layer 1 (modules, cycles), risk = Layer 2 (bug heatmap), refactor = Layer 3 (rules, violations, plan)." };

export const TOOL_SPECS: ToolSpec[] = [
  // ---- Layer 1 · See
  tool(
    "get_project_overview",
    "Whole-project picture: description, stack, modules with their dependencies, module-to-module imports, entry points, core files, import cycles, god files, history, test and rule status, and the current plan. Call it first when you need structure you don't already have.",
  ),
  tool(
    "list_files",
    "Lists files with module, lines, fan-in/fan-out and bug probability. Filter by module and/or a path substring; sort to find the biggest, most depended-on or riskiest files.",
    {
      module: str("Module label or id, e.g. \"components\"."),
      query: str("Case-insensitive substring of the path."),
      sort: { type: "string", enum: ["path", "risk", "fan_in", "loc"], description: "Default: path." },
      include_tests: { type: "boolean", description: "Also list tests, stories, examples and config (hidden by default)." },
      limit: int("Default 60, max 300."),
    },
  ),
  tool(
    "get_file",
    "Everything known about one file: role, size, what it imports and what imports it, cycle and god-file flags, its bug-risk rank, and rule violations it is part of. Accepts a full path, a path below the shared prefix, or a unique file name.",
    { path: str("File path or name.") },
    ["path"],
  ),
  tool(
    "read_file",
    "Reads a file's source code with line numbers (at most 400 lines per call; pass start_line/end_line for long files). Use it before making claims about what code does, to pinpoint bugs, and before writing code changes.",
    { path: str("File path or name."), start_line: int("First line, 1-based."), end_line: int("Last line (inclusive).") },
    ["path"],
  ),
  tool(
    "cluster_modules",
    "Runs the app's own clustering search (simulated annealing or hill climbing, maximising TurboMQ — a modularity score: cohesive modules, few imports between them) over the import graph. Returns each cluster's files, the imports between clusters, and MQ against the folder grouping. The clusters are not drawn: the diagram shows only the architecture you design, so use them as the starting point for set_architecture.",
    {
      algorithm: { type: "string", enum: ["annealing", "hill_climbing"], description: "Default annealing." },
      start: { type: "string", enum: ["singletons", "folders"], description: "Initial partition: one cluster per file (default) or the folders." },
      seed: int("Random seed (default 42); another seed explores another run."),
    },
  ),
  tool(
    "set_architecture",
    "Rearranges the diagram into the architecture you design: modules a developer would recognise, each with a short name, a one-line purpose and a tier (0 = entry points/UI at the top, higher = closer to the shared foundations; the diagram stacks tiers top to bottom, so imports should point to the same or a higher tier). Build each module from cluster ids (from cluster_modules), folder modules and/or individual files — listed files override the rest. Every source file should end up in exactly one module; leftovers go to \"Unsorted\" and are reported. Returns MQ for your architecture against the clusters and the folders.",
    {
      modules: {
        type: "array",
        description: "3–12 modules, top tier first.",
        items: {
          type: "object",
          properties: {
            name: str("Short module name, e.g. \"Checkout\"."),
            purpose: str("One line: what the module is for."),
            tier: int("0 = top (entry points, UI)."),
            kind: {
              type: "string",
              enum: ["ui", "entry", "logic", "data", "shared", "external", "config"],
              description:
                "What kind of part it is; the map draws each kind as its own shape. ui = what people see (pages, views, components); entry = where requests or the program come in (routes, API handlers, CLI); logic = services, features, state; data = storage and models; shared = small helpers most parts use; external = code talking to other systems; config = settings.",
            },
            clusters: { type: "array", items: { type: "string" }, description: "Cluster ids from cluster_modules, e.g. cluster-2." },
            folders: { type: "array", items: { type: "string" }, description: "Folder modules (labels), e.g. components." },
            files: { type: "array", items: { type: "string" }, description: "Individual files (override clusters and folders)." },
          },
          required: ["name", "purpose", "tier"],
        },
      },
    },
    ["modules"],
  ),
  tool(
    "show_in_diagram",
    "Controls the diagram the user is looking at: optionally changes mode, zooms to a file or module, and/or highlights a set of files (cyan ring) — e.g. the files of a cycle, the top suspects, or the files a change touches. Pass highlight: [] to clear highlights.",
    {
      mode: MODE,
      focus: str("A file path or module label to zoom to."),
      highlight: { type: "array", items: { type: "string" }, description: "Files to highlight (their modules open). Replaces earlier highlights." },
    },
  ),

  // ---- Layer 2 · Diagnose
  tool(
    "list_tests",
    "Test files (test cases = test files nothing imports), their current outcome (pass/fail/unknown) and how many source files each reaches through imports.",
    { limit: int("Default 100.") },
  ),
  tool(
    "set_test_outcomes",
    "Records test results as evidence for the Bayesian ranking (switches the diagram to Bug risk). Name test files by path or file name. When the user ran the whole suite, pass rest: \"pass\" so every other test counts as passing — passing tests clear the files they cover.",
    {
      failing: { type: "array", items: { type: "string" }, description: "Test files that failed." },
      passing: { type: "array", items: { type: "string" }, description: "Test files that passed." },
      rest: { type: "string", enum: ["keep", "pass", "unknown"], description: "What happens to every other test file. Default keep." },
    },
  ),
  tool("load_example_report", "Loads the test report bundled with the project (only the sample has one) as the test outcomes."),
  tool(
    "get_test_failures",
    "Failure messages from the loaded test report (the bundled one, or one the user loaded in the Bug risk panel), per failing test case. Assertion messages usually say what is wrong — read them before reading code.",
    { limit: int("Default 20.") },
  ),
  tool(
    "report_findings",
    "Records your code review: concrete problems you found (file, line, severity, what is wrong and why, and a fix as a unified diff when you can), plus every file you read. Findings appear as badges in the diagram and in the Bug risk panel, and count as Bayesian evidence: flagged files gain probability, files you read and found clean lose some. Replaces the previous review unless append is true. Report only real problems; an empty list with the files you read is a valid review.",
    {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            file: str("File path."),
            line: int("Line number of the problem."),
            severity: { type: "string", enum: ["high", "medium", "low"], description: "high = likely causes failures; low = smell or risk." },
            title: str("Short summary."),
            detail: str("What is wrong and why, citing the code."),
            fix: str("Optional unified diff."),
          },
          required: ["file", "severity", "title", "detail"],
        },
      },
      reviewed: { type: "array", items: { type: "string" }, description: "Every file you read for this review, including clean ones." },
      append: { type: "boolean", description: "Add to the previous review instead of replacing it." },
    },
    ["findings"],
  ),
  tool(
    "rank_suspects",
    "The Bayesian fault-localisation ranking: per file, the probability the bug is there (single-fault model: they sum to 1), the history/size prior, the Ochiai baseline rank, bug-fix history and the strongest test evidence.",
    { limit: int("Default 10, max 50.") },
  ),
  tool(
    "explain_suspect",
    "Why one file is suspected: prior breakdown (size vs. history, recent bug-fix commits) and every test outcome's Bayes factor, leading to the posterior.",
    { path: str("File path or name.") },
    ["path"],
  ),

  // ---- Layer 3 · Change
  tool(
    "get_rules",
    "The architecture rules currently in the editor (rules DSL), parse errors, the violation count, and the rules suggested from the folder names.",
  ),
  tool(
    "set_rules",
    "Replaces the architecture rules with new DSL text (switches the diagram to Refactor). Rules with errors are NOT applied — the errors come back so you can fix them. Also reports rule paths that match no file. Retires any existing plan.",
    { rules: str("The complete rules text, one rule per line.") },
    ["rules"],
  ),
  tool(
    "list_violations",
    "Imports that break the current rules, as derived by the forward-chaining rule engine, each with the rule it breaks and a one-sentence reason.",
    { file: str("Only violations involving this file."), limit: int("Default 30, max 100.") },
  ),
  tool(
    "explain_violation",
    "The rule engine's proof that the import from → to breaks a rule: which rule, a sentence, and the derivation tree (facts and Datalog rules used, plus negations that held).",
    { from: str("Importing file."), to: str("Imported file.") },
    ["from", "to"],
  ),
  tool(
    "plan_refactoring",
    "Runs A* over STRIPS actions (MoveFile, RedirectImport) to find the cheapest plan that removes every violation, and loads it into the Refactor panel at step 0. Returns the steps with costs, what each fixes, search statistics, and violations/cycles/cross-folder imports before vs. after.",
    {
      heuristic: { type: "string", enum: ["matching", "count", "zero"], description: "matching = admissible (optimal plans, default); count = inadmissible baseline; zero = uniform-cost search." },
      risk_weight: { type: "number", description: "How strongly plans avoid touching likely-buggy files (0–3, default: the panel's setting)." },
    },
  ),
  tool("compare_search", "Runs all three searches (A* matching, A* count, uniform-cost) on the current rules and reports cost, states expanded and time for each — evidence for the heuristic's quality."),
  tool(
    "attach_patch",
    "Attaches the code change for one step of the loaded plan as a unified diff; it is shown under that step in the Refactor panel.",
    { step: int("Plan step, 1..n."), diff: str("Unified diff."), note: str("Optional one-line note.") },
    ["step", "diff"],
  ),
  tool(
    "show_plan_step",
    "Steps the loaded plan in the diagram: step 0 is the current code, step n shows the code after n steps (files glide to new folders, imports turn green). play: true animates the whole plan.",
    { step: int("Step to show, 0..n."), play: { type: "boolean", description: "Animate from the start." } },
  ),
];

export const TOOL_NAMES = new Set(TOOL_SPECS.map((t) => t.function.name));
