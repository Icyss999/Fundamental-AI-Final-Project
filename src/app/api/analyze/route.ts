import type { NextRequest } from "next/server";
import { analyzeSource, errorMessage, type AnalyzeEvent } from "@/lib/analyze";
import { getGitHubToken } from "@/lib/auth/auth";

/**
 * POST { source: "https://github.com/owner/repo" } -> newline-delimited JSON stream of
 * progress events, ending with a single "result" or "error" event.
 */
export async function POST(request: NextRequest) {
  // Read before streaming starts: Better Auth may need to refresh its cookies.
  const token = await getGitHubToken(request.headers);
  let source: unknown;
  try {
    ({ source } = await request.json());
  } catch {
    return Response.json({ error: 'Body must be JSON: { "source": "https://github.com/owner/repo" }' }, { status: 400 });
  }
  if (typeof source !== "string" || source.trim() === "") {
    return Response.json({ error: "Paste a GitHub repository URL." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AnalyzeEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        const result = await analyzeSource(source.trim(), (step, detail) => send({ type: "progress", step, detail }), token);
        send({ type: "result", result });
      } catch (err) {
        send({ type: "error", message: errorMessage(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
