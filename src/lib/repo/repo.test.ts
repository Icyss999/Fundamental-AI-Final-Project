import { describe, expect, it } from "vitest";
import { parseGitHubUrl } from "./github";
import { detectTechStack, summarizeReadme } from "./overview";

describe("parseGitHubUrl", () => {
  it.each([
    ["https://github.com/pmndrs/zustand", { owner: "pmndrs", repo: "zustand" }],
    ["github.com/pmndrs/zustand.git", { owner: "pmndrs", repo: "zustand" }],
    ["https://www.github.com/pmndrs/zustand/", { owner: "pmndrs", repo: "zustand" }],
    ["git@github.com:pmndrs/zustand.git", { owner: "pmndrs", repo: "zustand" }],
    ["pmndrs/zustand", { owner: "pmndrs", repo: "zustand" }],
    ["https://github.com/pmndrs/zustand/issues/12", { owner: "pmndrs", repo: "zustand" }],
    ["https://github.com/vercel/next.js/tree/canary/packages/next", { owner: "vercel", repo: "next.js", ref: "canary", subdir: "packages/next" }],
    ["https://github.com/o/r/tree/v1.2.0", { owner: "o", repo: "r", ref: "v1.2.0" }],
  ])("%s", (input, expected) => {
    expect(parseGitHubUrl(input)).toEqual(expected);
  });

  it.each([
    "",
    "https://gitlab.com/a/b",
    "/home/me/project",
    "just words",
    "https://github.com/onlyowner",
    "https://github.com/-bad/repo",
    "https://github.com/o/r/tree/main/../../etc",
    "https://github.com/o/r/tree/--upload-pack=x",
  ])("rejects %j", (input) => {
    expect(parseGitHubUrl(input)).toBeNull();
  });
});

describe("summarizeReadme", () => {
  it("takes the title and opening prose, skipping badges, alerts, code and headings", () => {
    const md = [
      "<p align=\"center\"><img src=\"logo.png\"></p>",
      "",
      "# Widgetly",
      "",
      "[![npm](https://img.shields.io/npm/v/x.svg)](https://npm.im/x) ![ci](ci.svg)",
      "",
      "> [!NOTE]",
      "> This project is archived.",
      "",
      "```bash",
      "npm install widgetly",
      "```",
      "",
      "> A tiny **widget** toolkit for [React](https://react.dev)",
      "",
      "Widgetly gives you `useWidget`, a hook for building accessible widgets &amp; more.",
      "",
      "## Install",
    ].join("\n");
    expect(summarizeReadme(md)).toEqual({
      title: "Widgetly",
      summary: "A tiny widget toolkit for React. Widgetly gives you useWidget, a hook for building accessible widgets & more.",
    });
  });

  it("uses no title when the first heading is a section, not the project name", () => {
    expect(summarizeReadme('<p align="center"><img src="bear.png"></p>\n\n## Install\n\nnpm i x\n\n# Recipes\n').title).toBeNull();
    expect(summarizeReadme("Zustand\n=======\n\nSmall state.").title).toBe("Zustand");
    expect(summarizeReadme('<h1 align="center">Ky</h1>\n\nText').title).toBe("Ky");
  });

  it("returns nulls when there is no prose", () => {
    expect(summarizeReadme("# x\n\n- a\n- b\n")).toEqual({ title: "x", summary: null });
  });
});

describe("detectTechStack", () => {
  it("counts frameworks only from runtime dependencies", () => {
    const names = detectTechStack(["react", "next", "@radix-ui/react-dialog"], ["express", "vitest", "eslint"], true).map((t) => t.name);
    expect(names).toEqual(["TypeScript", "Next.js", "React", "Radix UI", "Vitest", "ESLint"]);
  });
});

describe("githubLink", () => {
  const source = {
    kind: "github" as const, owner: "o", repo: "r", url: "https://github.com/o/r", branch: "main",
    commit: "abc123", private: false,
  };
  it("pins files and folders to the analysed commit", async () => {
    const { githubLink, githubModuleLink } = await import("./links");
    expect(githubLink(source, "src/app/page.tsx", "blob")).toBe("https://github.com/o/r/blob/abc123/src/app/page.tsx");
    expect(githubModuleLink(source, "src/lib")).toBe("https://github.com/o/r/tree/abc123/src/lib");
    expect(githubModuleLink(source, "(root)")).toBe("https://github.com/o/r/tree/abc123");
    expect(githubLink({ ...source, subdir: "packages/core" }, "index.ts", "blob")).toBe("https://github.com/o/r/blob/abc123/packages/core/index.ts");
    expect(githubLink(source, "app/(auth)/login page.tsx", "blob")).toBe("https://github.com/o/r/blob/abc123/app/(auth)/login%20page.tsx");
    expect(githubLink({ kind: "local", path: "x" }, "a.ts", "blob")).toBeNull();
  });
});
