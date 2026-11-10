import type { AnalysisResult, AnalyzeEvent, AnalyzeStep } from "@/lib/analyze";

/** Calls /api/analyze and reads its progress stream until the result (or error) arrives. */
export async function streamAnalysis(
  source: string,
  signal: AbortSignal,
  onProgress: (step: AnalyzeStep, detail?: string) => void,
): Promise<AnalysisResult> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    for (let nl = buffer.indexOf("\n"); nl !== -1; nl = buffer.indexOf("\n")) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const event = JSON.parse(line) as AnalyzeEvent;
      if (event.type === "progress") onProgress(event.step, event.detail);
      else if (event.type === "result") return event.result;
      else throw new Error(event.message);
    }
  }
  throw new Error("The analysis ended unexpectedly. Please try again.");
}
