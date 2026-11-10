import { NextResponse, type NextRequest } from "next/server";
import { getGitHubToken } from "@/lib/auth/auth";
import { listUserRepos, RepoError } from "@/lib/repo/github";

/** The signed-in user's repositories, most recently pushed first. */
export async function GET(request: NextRequest) {
  const token = await getGitHubToken(request.headers);
  if (!token) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    return NextResponse.json({ repos: await listUserRepos(token) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof RepoError ? err.message : "Could not load your repositories.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
