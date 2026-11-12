/**
 * What kind of part a module is: what people see, where requests come in, the logic, the data, shared helpers,
 * outside services, or settings. The map draws each kind as its own shape. The AI names the kind of each part it
 * designs; for folders (or a part it left out) it is guessed from the name and the files. Pure and client-safe.
 */

export type ModuleKind = "ui" | "entry" | "logic" | "data" | "shared" | "external" | "config";

export const MODULE_KINDS: readonly ModuleKind[] = ["ui", "entry", "logic", "data", "shared", "external", "config"];

/** Plain names and what each shape means, for the map's key and the AI's prompt. */
export const KIND_INFO: Record<ModuleKind, { label: string; meaning: string; shape: string }> = {
  ui: { label: "Screens", meaning: "what people see and click: pages, views, components", shape: "window" },
  entry: { label: "Entry points", meaning: "where the program starts or requests come in: routes, API handlers, commands", shape: "pill" },
  logic: { label: "Logic", meaning: "the rules and work of the app: services, features, state", shape: "hexagon" },
  data: { label: "Data", meaning: "where things are stored or modelled: database access, models, schemas", shape: "cylinder" },
  shared: { label: "Shared helpers", meaning: "small tools most parts use: utilities, common code", shape: "library" },
  external: { label: "Outside services", meaning: "code that talks to other systems: API clients, integrations, adapters", shape: "parallelogram" },
  config: { label: "Settings", meaning: "configuration, constants, setup", shape: "document" },
};

export function isModuleKind(value: unknown): value is ModuleKind {
  return typeof value === "string" && (MODULE_KINDS as readonly string[]).includes(value);
}

/** Words in folder or file names that give a part's kind away, strongest first. */
const HINTS: [ModuleKind, RegExp][] = [
  ["config", /^(config|configs|configuration|settings|constants?|env|setup)$/],
  ["entry", /^(routes?|router|api|apis|controllers?|handlers?|endpoints?|cli|bin|cmd|commands?|server|main|app|entry|entrypoints?|pages\/api)$/],
  ["ui", /^(pages?|screens?|views?|components?|ui|layouts?|widgets?|templates?|frontend|client|web|public|styles?|app\/.*)$/],
  ["data", /^(data|db|database|models?|schemas?|entities|repositor(y|ies)|storage|store|persistence|migrations?|prisma|dao|orm|sql)$/],
  ["external", /^(clients?|integrations?|external|adapters?|gateways?|providers?|http|network|sdk|vendors?|third[-_]?party)$/],
  ["shared", /^(lib|libs|utils?|utilities|helpers?|shared|common|core\/utils|tools|support|internal|pkg)$/],
  ["logic", /^(services?|domain|core|logic|features?|modules?|state|stores?|hooks|usecases?|use-cases|business|engine|actions?|reducers?|slices?|workers?|jobs?)$/],
];

/** Guesses a part's kind from its label and its files' paths (the most common hint among them wins). */
export function classifyModule(label: string, files: readonly string[]): ModuleKind {
  const words = (s: string) => s.toLowerCase().split(/[/\\\s,&+-]+/).filter(Boolean);
  const vote = new Map<ModuleKind, number>();
  const hit = (word: string, weight: number) => {
    for (const [kind, re] of HINTS) {
      if (re.test(word)) {
        vote.set(kind, (vote.get(kind) ?? 0) + weight);
        return;
      }
    }
  };
  for (const w of words(label)) hit(w, 3);
  for (const f of files) {
    const parts = f.toLowerCase().split("/");
    // Folders count; the file name too (db.ts, config.ts, api.py), without its extension.
    parts.slice(0, -1).forEach((p) => hit(p, 1));
    hit(parts[parts.length - 1].replace(/\.[^.]+$/, ""), 0.5);
    if (/\.(tsx|jsx|vue|svelte|astro|html|css|scss)$/.test(f)) vote.set("ui", (vote.get("ui") ?? 0) + 0.25);
  }
  let best: ModuleKind = "logic";
  let score = 0;
  for (const [kind, v] of vote) {
    if (v > score) {
      best = kind;
      score = v;
    }
  }
  return best;
}
