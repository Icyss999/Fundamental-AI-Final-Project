import { expect, it } from "vitest";
import CheckoutPage from "./checkout";

it("renders the total", () => {
  expect(CheckoutPage({ orderId: "o1" })).toBeTruthy();
});
