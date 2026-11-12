import { describe, expect, it } from "vitest";
import { pay } from "./paymentService";
import { saveOrder } from "@/data/db";

describe("paymentService", () => {
  it("marks an order as paid", () => {
    saveOrder({ id: "o1", items: [], paid: false });
    expect(pay("o1")).toBe(true);
  });
});
