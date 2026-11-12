import { round2, currencySymbol } from "./utils";

export function formatPrice(n: number): string {
  return `${currencySymbol()}${round2(n).toFixed(2)}`;
}
