// Deliberate smell: pricing reads the cart store, and the cart store calls pricing -> import cycle.
import { getCart } from "@/state/cartStore";
import { getMenuItem } from "@/data/db";
import { config } from "@/lib/config";
import { round2, sum } from "@/lib/utils";

export function subtotal(): number {
  return sum(getCart().map((l) => (getMenuItem(l.itemId)?.price ?? 0) * l.qty));
}

export function cartTotal(): number {
  return round2(subtotal() * (1 + config.taxRate));
}
