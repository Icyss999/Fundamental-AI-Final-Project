import { expect, it } from "vitest";
import { formatPrice } from "./format";

it("formats dollars", () => {
  expect(formatPrice(9.5)).toBe("$9.50");
});
