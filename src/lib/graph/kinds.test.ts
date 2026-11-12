import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { extractGraph } from "./extract";
import { classifyModule, isModuleKind } from "./kinds";
import { analyzeProject, type ProjectAnalysis } from "./project-analysis";

describe("what kind of part a module is", () => {
  it("reads common folder names", () => {
    expect(classifyModule("pages", ["src/pages/menu.tsx"])).toBe("ui");
    expect(classifyModule("components", ["src/components/Cart.tsx"])).toBe("ui");
    expect(classifyModule("routes", ["src/routes/users.ts"])).toBe("entry");
    expect(classifyModule("services", ["src/services/pricing.ts"])).toBe("logic");
    expect(classifyModule("data", ["src/data/db.ts"])).toBe("data");
    expect(classifyModule("models", ["app/models/user.py"])).toBe("data");
    expect(classifyModule("lib", ["src/lib/utils.ts"])).toBe("shared");
    expect(classifyModule("clients", ["src/clients/stripe.ts"])).toBe("external");
    expect(classifyModule("config", ["src/config/index.ts"])).toBe("config");
  });

  it("falls back to the files when the name says nothing, and to logic when they don't either", () => {
    expect(classifyModule("Checkout", ["src/pages/checkout.tsx", "src/components/Basket.tsx"])).toBe("ui");
    expect(classifyModule("Everything else", ["src/foo/bar.ts"])).toBe("logic");
  });

  it("checks the AI's word", () => {
    expect(isModuleKind("data")).toBe(true);
    expect(isModuleKind("database")).toBe(false);
  });
});

describe("kinds on the sample", () => {
  let a: ProjectAnalysis;
  beforeAll(async () => {
    const { graph } = await extractGraph(path.resolve(__dirname, "../../../fixtures/restaurant-app"));
    a = analyzeProject(graph, "restaurant-app", false);
  });

  it("gives every folder module a kind", () => {
    const byLabel = Object.fromEntries([...a.modules.keys()].map((m) => [a.labels[m], a.kinds[m]]));
    expect(byLabel).toEqual({ components: "ui", data: "data", lib: "shared", pages: "ui", services: "logic", state: "logic" });
  });

  it("takes the AI's kinds when its architecture names them", () => {
    const partition = Object.fromEntries(a.graph.nodes.map((n) => [n.id, n.id.includes("/data/") ? "ai-2" : "ai-1"]));
    const b = analyzeProject(a.graph, "restaurant-app", false, { kind: "ai", partition, labels: { "ai-1": "App", "ai-2": "Storage" }, kinds: { "ai-2": "data", "ai-1": "entry" }, mq: 0 });
    expect(b.kinds).toEqual({ "ai-1": "entry", "ai-2": "data" });
  });
});
