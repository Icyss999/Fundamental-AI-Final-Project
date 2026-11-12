import { cartTotal } from "@/services/pricing";
import { sum } from "@/lib/utils";

export interface CartLine {
  itemId: string;
  qty: number;
}

let lines: CartLine[] = [];

export function getCart(): CartLine[] {
  return lines;
}

export function addToCart(itemId: string): void {
  const existing = lines.find((l) => l.itemId === itemId);
  if (existing) existing.qty += 1;
  else lines = [...lines, { itemId, qty: 1 }];
}

export function cartSize(): number {
  return sum(lines.map((l) => l.qty));
}

export function cartSummary(): string {
  return `${cartSize()} items, total ${cartTotal()}`;
}
