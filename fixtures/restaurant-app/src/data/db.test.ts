import { expect, it } from "vitest";
import { getMenuItem, getMenuItems } from "./db";

it("serves the menu", () => {
  expect(getMenuItems()).toHaveLength(2);
  expect(getMenuItem("m2")?.name).toBe("Banh Mi");
});
