import type { NextRequest } from "next/server";
import { clientKey, sourceRequestAllowed } from "@/lib/ai/limits";
import { getGitHubToken } from "@/lib/auth/auth";
import { RepoError } from "@/lib/repo/github";
import { readProjectFile } from "@/lib/repo/source";

/**
 * POST { source: ProjectSource, path } -> { text }: one file of an analysed project, for the
 * assistant's read_file tool. GitHub projects are read at the analysed commit.
 */
export async function POST(request: NextRequest) {
  const token = await getGitHubToken(request.headers);
  if (!sourceRequestAllowed(clientKey(request.headers))) {
    return Response.json({ error: "Too many file reads from this address. Wait a few minutes." }, { status: 429 });
  }
  let body: { source?: unknown; path?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON: { source, path }." }, { status: 400 });
  }
  try {
    const text = await readProjectFile(body.source, body.path, token);
    return Response.json({ text }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof RepoError ? err.message : `Could not read the file: ${err instanceof Error ? err.message : String(err)}`;
    return Response.json({ error: message }, { status: err instanceof RepoError ? 404 : 500 });
  }
}
