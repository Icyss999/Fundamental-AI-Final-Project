import { describe, expect, it } from "vitest";
import { RepoError } from "./github";
import { readProjectFile, safeRelativePath } from "./source";

const sample = { kind: "local", path: "samples/restaurant-app" } as const;

describe("reading project files for the assistant", () => {
  it("accepts only relative paths that stay inside the project", () => {
    expect(safeRelativePath("src/a.ts")).toBe("src/a.ts");
    for (const bad of ["", "../x", "a/../b", "/etc/passwd", "a\\b", "a//b", "./a", "C:/x", "a\0b", 42]) expect(safeRelativePath(bad)).toBeNull();
  });

  it("reads the sample from disk", async () => {
    expect(await readProjectFile(sample, "src/services/pricing.ts")).toMatch(/export/);
  });

  it("refuses to leave the project folder or read what is not a file", async () => {
    await expect(readProjectFile(sample, "../../package.json")).rejects.toThrow(RepoError);
    await expect(readProjectFile(sample, "src")).rejects.toThrow(/not a file/);
    await expect(readProjectFile(sample, "src/missing.ts")).rejects.toThrow(/not found/);
  });

  it("validates GitHub sources before any request", async () => {
    const gh = { kind: "github", owner: "o", repo: "r", url: "https://github.com/o/r", branch: "main", private: false };
    await expect(readProjectFile({ ...gh, commit: "main" }, "a.ts")).rejects.toThrow(/Invalid commit/);
    await expect(readProjectFile({ ...gh, owner: "bad owner", commit: "a".repeat(40) }, "a.ts")).rejects.toThrow(/Invalid repository/);
    await expect(readProjectFile({ ...gh, commit: "a".repeat(40), subdir: "../x" }, "a.ts")).rejects.toThrow(/Invalid folder/);
    await expect(readProjectFile({ kind: "local", path: "relative/dir" }, "a.ts")).rejects.toThrow(/development mode/);
  });
});
