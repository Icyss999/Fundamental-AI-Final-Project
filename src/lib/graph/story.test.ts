import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { extractGraph } from "./extract";
import { organize, type Organization } from "./organize";
import { analyzeProject, type ProjectAnalysis } from "./project-analysis";
import { buildTour, mapRows, projectStory, type Sentence } from "./story";

let a: ProjectAnalysis;
let org: Organization;
beforeAll(async () => {
  const { graph } = await extractGraph(path.resolve(__dirname, "../../../fixtures/restaurant-app"));
  a = analyzeProject(graph, "restaurant-app", false);
  org = organize([...a.modules.keys()], a.moduleEdges);
});

/** A sentence as text, module ids replaced by their labels. */
const text = (s: Sentence) => s.map((p) => (typeof p === "string" ? p : "module" in p ? a.labels[p.module] : p.file)).join("");

describe("the story Kosmos tells", () => {
  it("orders the sample's rows top first, with the loop pair sharing a row", () => {
    expect(mapRows(a, org).map((r) => r.map((m) => a.labels[m]))).toEqual([["pages"], ["components"], ["services", "state"]]);
  });

  it("narrates the sample in plain words", () => {
    expect(projectStory(a, org).map(text)).toEqual([
      "16 files in 6 parts.",
      "pages sits at the top and leans on components, services and state.",
      "data and lib sit on the shelves at the bottom: most parts use them.",
      "One thing to know: services and state need each other, so they sit side by side with a red two-way arrow.",
    ]);
  });

  it("tours the map row by row, then the shelves, the loop and the end", () => {
    const tour = buildTour(a, org);
    expect(tour.map((s) => s.title)).toEqual([
      "Start here: pages.",
      "Next: components.",
      "Next: 2 parts the row above uses.",
      "Underneath: the shelves.",
      "Watch out: a loop.",
      "That's the whole map.",
    ]);
    expect(tour[0].files?.map((f) => f.id)).toEqual(["src/pages/order.tsx", "src/pages/checkout.tsx", "src/pages/menu.tsx"]);
    expect(text(tour[0].body[0])).toBe("pages is where the code starts: nothing else in the project uses it.");
    expect(tour[3].focus.map((m) => a.labels[m])).toEqual(["data", "lib"]);
    expect(text(tour[3].body[1])).toBe("lib is used by 5 of the other 5 parts.");
  });
});
