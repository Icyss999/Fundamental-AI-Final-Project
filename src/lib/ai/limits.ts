import { createRateLimiter } from "./rate-limit";

/** Per-address limits for the AI endpoints (one chat turn makes a request per tool round). */
export const assistantRequestAllowed = createRateLimiter({ limit: 200, windowMs: 10 * 60_000 });
export const sourceRequestAllowed = createRateLimiter({ limit: 600, windowMs: 10 * 60_000 });

export function clientKey(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0].trim() || headers.get("x-real-ip") || "local";
}
