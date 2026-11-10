import { describe, expect, it } from "vitest";
import { cartTotal, subtotal } from "./pricing";

describe("pricing", () => {
  it("adds tax once", () => {
    expect(cartTotal()).toBe(Math.round(subtotal() * 108) / 100);
  });
});
