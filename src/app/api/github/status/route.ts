import { connection } from "next/server";
import { githubOAuthConfigured } from "@/lib/auth/config";

/** Lets the UI explain the one-time setup instead of offering a sign-in that cannot work. */
export async function GET() {
  // Read the environment per request, not at build time (Cache Components would prerender this).
  await connection();
  return Response.json({ configured: githubOAuthConfigured() }, { headers: { "Cache-Control": "no-store" } });
}
