import { describe, expect, it } from "vitest";
import { addToCart, cartSize } from "./cartStore";

describe("cartStore", () => {
  it("counts quantities", () => {
    addToCart("m1");
    addToCart("m1");
    expect(cartSize()).toBe(2);
  });
});
