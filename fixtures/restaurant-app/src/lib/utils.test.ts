import { expect, it } from "vitest";
import { byId, round2, sum } from "./utils";

it("rounds, sums and finds by id", () => {
  expect(round2(1.005)).toBe(1);
  expect(sum([1, 2, 3])).toBe(6);
  expect(byId([{ id: "a" }], "a")).toEqual({ id: "a" });
});
