import { config } from "./config";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

export function byId<T extends { id: string }>(items: T[], id: string): T | undefined {
  return items.find((i) => i.id === id);
}

export function currencySymbol(): string {
  return config.currency === "USD" ? "$" : config.currency;
}
