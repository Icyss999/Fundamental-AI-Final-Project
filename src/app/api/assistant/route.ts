import { connection, type NextRequest } from "next/server";
import { assistantRequestAllowed, clientKey } from "@/lib/ai/limits";
import { deepseekConfig, streamChat } from "@/lib/ai/deepseek";
import { SYSTEM_PROMPT, WRAP_UP_NOTE } from "@/lib/ai/prompt";
import { parseChatRequest, type AssistantEvent, type AssistantStatus } from "@/lib/ai/protocol";
import { TOOL_SPECS } from "@/lib/ai/specs";

/** Whether the assistant can be used (the key is read per request, never sent to the browser). */
export async function GET() {
  await connection();
  const c = deepseekConfig();
  const status: AssistantStatus = { configured: c.key !== null, model: c.model };
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST { messages, context, effort, round, wrapUp } -> newline-delimited JSON stream of AssistantEvents: reasoning
 * and text deltas, then one "done" (with any tool calls for the browser to run) or "error".
 */
export async function POST(request: NextRequest) {
  const config = deepseekConfig();
  const { key } = config;
  if (!key) {
    return Response.json({ error: "The AI assistant is not set up: add DEEPSEEK_API_KEY to .env.local and restart the server." }, { status: 503 });
  }
  if (!assistantRequestAllowed(clientKey(request.headers))) {
    return Response.json({ error: "Too many AI requests from this address. Wait a few minutes and try again." }, { status: 429 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = parseChatRequest(body);
  if (typeof parsed === "string") return Response.json({ error: parsed }, { status: 400 });

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    ...(parsed.context ? [{ role: "system" as const, content: parsed.context }] : []),
    ...parsed.messages,
    ...(parsed.wrapUp ? [{ role: "system" as const, content: WRAP_UP_NOTE }] : []),
  ];
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(300_000)]);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AssistantEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for await (const event of streamChat({ config: { ...config, key }, messages, tools: TOOL_SPECS, effort: parsed.effort, signal })) send(event);
      } catch (err) {
        if (!signal.aborted) send({ type: "error", message: `The assistant failed: ${err instanceof Error ? err.message : String(err)}` });
      } finally {
        try {
          controller.close();
        } catch {
          // the browser went away
        }
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
