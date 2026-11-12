"use client";

import { useEffect, useRef, useState } from "react";
import { SidePanel } from "@/components/app/SidePanel";
import { Icon, Spinner } from "@/components/app/ui";
import { AUTOPILOT_STAGES } from "@/lib/ai/autopilot";
import { describeCall } from "@/lib/ai/execute";
import type { AssistantStatus } from "@/lib/ai/protocol";
import { Markdown, type Target } from "./Markdown";
import type { Assistant, AssistantMessage, ToolMessage } from "./useAssistant";
import type { Autopilot, StageStatus } from "./useAutopilot";

export type StatusState = AssistantStatus | "loading" | "error";

const STAGE_SHORT: Record<string, string> = { organize: "Sort", bugs: "Bugs", refactor: "Tidy-up" };

/** The chat, as the one side panel. The conversation lives in useAssistant, so it survives closing. */
export function AssistantPanel({
  assistant,
  status,
  suggestions,
  resolve,
  onTarget,
  onNewChat,
  onClose,
  autopilot,
}: {
  assistant: Assistant;
  autopilot: Autopilot;
  status: StatusState;
  suggestions: string[];
  /** A diagram target for inline code in replies (a file path or module label), if it names one. */
  resolve: (text: string) => Target | null;
  onTarget: (target: Target) => void;
  onNewChat: () => void;
  onClose: () => void;
}) {
  const { messages, busy } = assistant;
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const ready = typeof status === "object" && status.configured;

  // Follow the reply as it streams, unless the user scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current && messages.length > 0) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Ready to type as soon as the panel opens.
  useEffect(() => {
    if (ready) input.current?.focus({ preventScroll: true });
  }, [ready]);

  const submit = (text: string) => {
    if (!ready || busy || !text.trim()) return;
    stick.current = true;
    void assistant.send(text);
    setDraft("");
  };

  const results = new Map(messages.filter((m): m is ToolMessage => m.role === "tool").map((m) => [m.toolCallId, m]));

  return (
    <SidePanel
      title="Ask Kosmos"
      wide
      onClose={onClose}
      actions={
        messages.length > 0 && (
          <button onClick={onNewChat} className="k-btn k-btn-small" title="Start a new conversation">
            New chat
          </button>
        )
      }
    >
      {autopilot.stages && (
        <ol className="flex shrink-0 gap-1.5 border-b-2 border-dashed border-[var(--border)] px-4 py-2" aria-label="Full pass progress">
          {AUTOPILOT_STAGES.filter((stage) => autopilot.stages![stage.id]).map((stage, i) => (
            <StageChip key={stage.id} n={i + 1} title={STAGE_SHORT[stage.id] ?? stage.title} status={autopilot.stages![stage.id]!} />
          ))}
        </ol>
      )}

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <Intro status={status} suggestions={suggestions} onPick={submit} />
        ) : (
          <div className="space-y-5">
            {messages.map((m) =>
              m.role === "user" && m.stage ? (
                <p key={m.id} className="font-letter w-fit rounded-[4px] border-2 border-[var(--on-yel)] bg-[var(--yel)] px-2.5 py-0.5 text-[14px] font-extrabold text-[var(--on-yel)]">
                  {m.text.replace(/^Autopilot · /, "Full pass · ")}
                </p>
              ) : m.role === "user" ? (
                <div
                  key={m.id}
                  className="ml-10 whitespace-pre-wrap rounded-2xl rounded-br-[4px] border-2 border-[var(--ink)] bg-[var(--yel-soft)] px-3.5 py-2.5 text-[15px] leading-[1.5] [overflow-wrap:anywhere]"
                >
                  {m.text}
                </div>
              ) : m.role === "assistant" ? (
                <AssistantReply key={m.id} message={m} results={results} busy={busy} resolve={resolve} onTarget={onTarget} />
              ) : null,
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t-2 border-[var(--ink)] p-3">
        <div className="rounded-xl border-2 border-[var(--ink)] bg-[var(--canvas)] focus-within:shadow-[3px_3px_0_var(--cyan)]">
          <textarea
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit(draft);
              }
            }}
            disabled={!ready}
            rows={Math.min(8, Math.max(2, draft.split("\n").length))}
            placeholder={ready ? "Ask about a file, a bug, or how it all fits…" : "The AI isn't set up yet"}
            className="block w-full resize-none bg-transparent px-3.5 pt-3 text-[15px] leading-[1.5] outline-none placeholder:text-[var(--muted)] focus-visible:outline-none disabled:cursor-not-allowed"
            aria-label="Message Kosmos"
          />
          <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
            <label className="flex cursor-pointer items-center gap-2 px-1 text-[13.5px] text-[var(--muted)]" title="Slower, but better at reading code and finding bugs">
              <input type="checkbox" checked={assistant.effort === "high"} onChange={(e) => assistant.setEffort(e.target.checked ? "high" : "low")} className="h-4 w-4 accent-[var(--ink)]" />
              Think harder
            </label>
            {busy ? (
              <button onClick={assistant.stop} className="k-btn k-btn-primary !h-9 !w-9 !p-0" title="Stop" aria-label="Stop">
                <Icon.Stop className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button onClick={() => submit(draft)} disabled={!ready || !draft.trim()} className="k-btn k-btn-primary !h-9 !w-9 !p-0" title="Send (Enter)" aria-label="Send">
                <Icon.Send className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </SidePanel>
  );
}

function StageChip({ n, title, status }: { n: number; title: string; status: StageStatus }) {
  const icon =
    status === "running" ? (
      <Spinner className="h-3.5 w-3.5" />
    ) : status === "done" ? (
      <Icon.Check className="h-3.5 w-3.5 text-[var(--added)]" />
    ) : status === "pending" || status === "skipped" ? (
      <span className="text-[12px] font-bold tabular-nums">{n}</span>
    ) : (
      <Icon.Alert className="h-3.5 w-3.5 text-[var(--warn)]" />
    );
  const label = { running: "working", done: "done", pending: "waiting", stopped: "stopped", error: "failed", skipped: "not started" }[status];
  return (
    <li
      className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md border-2 px-2 py-1 text-[13.5px] ${status === "running" ? "border-[var(--ink)] bg-[var(--yel-soft)] font-bold" : status === "pending" || status === "skipped" ? "border-[var(--border)] text-[var(--muted)]" : "border-[var(--border)]"}`}
      title={`${title}: ${label}`}
    >
      {icon}
      <span className="truncate">{title}</span>
      <span className="sr-only">: {label}</span>
    </li>
  );
}

function Intro({ status, suggestions, onPick }: { status: StatusState; suggestions: string[]; onPick: (text: string) => void }) {
  if (status === "loading") {
    return (
      <p className="flex items-center gap-2 text-[15px] text-[var(--muted)]">
        <Spinner className="h-4 w-4" /> Connecting…
      </p>
    );
  }
  if (status === "error" || !status.configured) {
    return (
      <div className="space-y-2 text-[15px] leading-relaxed">
        <p className="font-letter text-[19px] font-extrabold">The AI needs a key first.</p>
        {status === "error" ? (
          <p className="text-[var(--muted)]">Kosmos couldn&apos;t reach its server. Is the app still running?</p>
        ) : (
          <>
            <p className="text-[var(--muted)]">
              Add a DeepSeek API key to <code className="font-mono text-[14px]">.env.local</code> and restart the server. Everything else in Kosmos works without it.
            </p>
            <pre className="rounded-lg border-2 border-[var(--ink)] px-3 py-2 font-mono text-[13px]">DEEPSEEK_API_KEY=sk-…</pre>
          </>
        )}
      </div>
    );
  }
  return (
    <div>
      <p className="font-letter text-[21px] font-extrabold leading-tight">What would you like to know?</p>
      <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--muted)]">
        Ask in your own words. Kosmos reads the code, runs its own checks, and points at what it finds on the map.
      </p>
      <ul className="mt-4 space-y-2">
        {suggestions.map((s) => (
          <li key={s}>
            <button onClick={() => onPick(s)} className="w-full rounded-xl border-2 border-[var(--ink)] px-3.5 py-2.5 text-left text-[14.5px] leading-snug hover:bg-[var(--yel-soft)]">
              {s.replace(/`/g, "")}
            </button>
          </li>
        ))}
      </ul>

    </div>
  );
}

function AssistantReply({
  message: m,
  results,
  busy,
  resolve,
  onTarget,
}: {
  message: AssistantMessage;
  results: Map<string, ToolMessage>;
  busy: boolean;
  resolve: (text: string) => Target | null;
  onTarget: (target: Target) => void;
}) {
  const thinking = m.streaming && !m.content;
  return (
    <div className="space-y-2.5">
      {(m.reasoning || thinking) && (
        <details className="group text-[14px]">
          <summary className="flex cursor-pointer select-none list-none items-center gap-1.5 font-bold text-[var(--muted)] hover:text-[var(--foreground)]">
            {thinking ? <Spinner className="h-3.5 w-3.5" /> : <span className="text-[10px] transition-transform group-open:rotate-90">▶</span>}
            {thinking ? "Thinking…" : "How it thought"}
          </summary>
          {m.reasoning && <p className="mt-1.5 max-h-60 overflow-y-auto whitespace-pre-wrap border-l-2 border-[var(--border)] pl-3 text-[13.5px] leading-relaxed text-[var(--muted)]">{m.reasoning}</p>}
        </details>
      )}
      {m.toolCalls.length > 0 && (
        <ul className="space-y-1">
          {m.toolCalls.map((c) => (
            <ToolRow key={c.id} name={c.function.name} args={c.function.arguments} result={results.get(c.id)} pending={busy} />
          ))}
        </ul>
      )}
      {m.content && <Markdown text={m.content} resolve={resolve} onTarget={onTarget} />}
      {m.stopped && <p className="text-[13.5px] text-[var(--muted)]">Stopped.</p>}
      {m.error && (
        <p className="flex items-start gap-1.5 rounded-lg border-2 border-[var(--danger)] px-2.5 py-1.5 text-[14px] text-[var(--danger)]">
          <Icon.Alert className="mt-0.5 h-4 w-4 shrink-0" />
          {m.error}
        </p>
      )}
    </div>
  );
}

function ToolRow({ name, args, result, pending }: { name: string; args: string; result?: ToolMessage; pending: boolean }) {
  const [open, setOpen] = useState(false);
  const running = !result && pending;
  const label = result ? result.summary : running ? `${describeCall(name, args)}…` : `${describeCall(name, args)} (cancelled)`;
  return (
    <li className="rounded-lg border-2 border-[var(--border)] text-[13.5px]">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left" title={`${name}: show the details`}>
        {running ? (
          <Spinner className="h-3.5 w-3.5 shrink-0" />
        ) : result?.ok ? (
          <Icon.Check className="h-3.5 w-3.5 shrink-0 text-[var(--added)]" />
        ) : (
          <Icon.Alert className="h-3.5 w-3.5 shrink-0 text-[var(--warn)]" />
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t-2 border-[var(--border)] px-2.5 py-2">
          <p className="font-mono text-[12px] text-[var(--muted)]">{name}</p>
          <ToolData label="Asked with" text={pretty(args)} />
          {result && <ToolData label="Got back" text={pretty(result.content)} />}
        </div>
      )}
    </li>
  );
}

function ToolData({ label, text }: { label: string; text: string }) {
  const shown = text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text;
  return (
    <div>
      <p className="text-[12.5px] font-bold text-[var(--muted)]">{label}</p>
      <pre className="mt-0.5 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--hover)] px-2 py-1.5 font-mono text-[12px] leading-relaxed">{shown}</pre>
    </div>
  );
}

function pretty(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json || "{}"), null, 2);
  } catch {
    return json;
  }
}
