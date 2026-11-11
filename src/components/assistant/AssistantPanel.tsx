"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, Spinner } from "@/components/app/ui";
import { AUTOPILOT_STAGES } from "@/lib/ai/autopilot";
import { describeCall } from "@/lib/ai/execute";
import type { AssistantStatus } from "@/lib/ai/protocol";
import { Markdown, type Target } from "./Markdown";
import type { Assistant, AssistantMessage, ToolMessage } from "./useAssistant";
import type { Autopilot, StageStatus } from "./useAutopilot";

export type StatusState = AssistantStatus | "loading" | "error";

/** The chat docked beside both tabs. The conversation lives in useAssistant (kept while closed). */
export function AssistantPanel({
  assistant,
  status,
  suggestions,
  resolve,
  onTarget,
  onNewChat,
  onClose,
  autopilot,
  autoRun,
  onAutoRunChange,
}: {
  assistant: Assistant;
  autopilot: Autopilot;
  /** Run the autopilot whenever a project loads. */
  autoRun: boolean;
  onAutoRunChange: (value: boolean) => void;
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
  const stick = useRef(true);
  const ready = typeof status === "object" && status.configured;

  // Follow the reply as it streams, unless the user scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = (text: string) => {
    if (!ready || busy || !text.trim()) return;
    stick.current = true;
    void assistant.send(text);
    setDraft("");
  };

  const results = new Map(messages.filter((m): m is ToolMessage => m.role === "tool").map((m) => [m.toolCallId, m]));

  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--panel)]" aria-label="AI assistant">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--border)] px-4">
        <Icon.Sparkle className="h-4 w-4 shrink-0 text-[var(--ai)]" />
        <span className="shrink-0 whitespace-nowrap text-[12px] font-semibold uppercase tracking-wider text-[var(--muted)]">AI</span>
        {typeof status === "object" && status.configured && (
          <span className="min-w-0 truncate rounded-full bg-[var(--hover)] px-2 py-px font-mono text-[10.5px] text-[var(--muted)]" title="DeepSeek model (DEEPSEEK_MODEL)">
            {status.model}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap">
          {ready && !busy && (
            <button
              onClick={() => void autopilot.start()}
              className="inline-flex items-center gap-1 rounded-md bg-[var(--ai-soft)] px-2 py-0.5 text-[11.5px] font-medium text-[var(--ai)] hover:brightness-95 dark:hover:brightness-125"
              title="Let the AI rearrange the diagram, review the code for bugs and plan the refactoring"
            >
              <Icon.Sparkle className="h-3 w-3" />
              Autopilot
            </button>
          )}
          {messages.length > 0 && (
            <button onClick={onNewChat} className="rounded-md px-2 py-0.5 text-[11.5px] font-medium text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]" title="Start a new conversation">
              New chat
            </button>
          )}
          <button onClick={onClose} className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]" title="Close the assistant">
            <Icon.Close className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>

      {autopilot.stages && (
        <div className="flex shrink-0 items-center gap-1 border-b border-[var(--border)] px-3 py-1.5" aria-label="Autopilot progress">
          {AUTOPILOT_STAGES.map((stage, i) => (
            <StageChip key={stage.id} n={i + 1} title={stage.title} status={autopilot.stages![stage.id]} />
          ))}
        </div>
      )}

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <Intro status={status} suggestions={suggestions} onPick={submit} onAutopilot={() => void autopilot.start()} autoRun={autoRun} onAutoRunChange={onAutoRunChange} />
        ) : (
          <div className="space-y-4">
            {messages.map((m) =>
              m.role === "user" && m.stage ? (
                <div key={m.id} className="flex items-center gap-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--ai)]">
                  <span className="h-px flex-1 bg-[var(--ai-soft)]" />
                  <Icon.Sparkle className="h-3 w-3" />
                  {m.text}
                  <span className="h-px flex-1 bg-[var(--ai-soft)]" />
                </div>
              ) : m.role === "user" ? (
                <div key={m.id} className="ml-10 whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--accent-soft)] px-3 py-2 text-[13px] leading-relaxed [overflow-wrap:anywhere]">
                  {m.text}
                </div>
              ) : m.role === "assistant" ? (
                <AssistantReply key={m.id} message={m} results={results} busy={busy} resolve={resolve} onTarget={onTarget} />
              ) : null,
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--border)] p-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--canvas)] focus-within:border-[var(--ai)]">
          <textarea
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
            placeholder={ready ? "Ask about the architecture, a bug, or a refactoring…" : "The assistant is not set up yet"}
            className="block w-full resize-none bg-transparent px-3 pt-2.5 text-[13px] leading-relaxed outline-none placeholder:text-[var(--muted)] disabled:cursor-not-allowed"
            aria-label="Message the assistant"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <label className="flex cursor-pointer items-center gap-1.5 rounded-md px-1 text-[11.5px] text-[var(--muted)]" title="More reasoning per step: slower, better at reading code and finding bugs">
              <input type="checkbox" checked={assistant.effort === "high"} onChange={(e) => assistant.setEffort(e.target.checked ? "high" : "low")} className="accent-[var(--ai)]" />
              Think harder
            </label>
            {busy ? (
              <button onClick={assistant.stop} className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--foreground)] text-[var(--background)]" title="Stop">
                <Icon.Stop className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                onClick={() => submit(draft)}
                disabled={!ready || !draft.trim()}
                className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--ai)] text-white disabled:opacity-35"
                title="Send (Enter)"
              >
                <Icon.Send className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

function StageChip({ n, title, status }: { n: number; title: string; status: StageStatus }) {
  const icon =
    status === "running" ? (
      <Spinner className="h-3 w-3 text-[var(--ai)]" />
    ) : status === "done" ? (
      <Icon.Check className="h-3 w-3 text-[var(--added)]" />
    ) : status === "pending" ? (
      <span className="grid h-3.5 w-3.5 place-items-center rounded-full border border-[var(--border)] text-[9px] text-[var(--muted)]">{n}</span>
    ) : (
      <Icon.Alert className="h-3 w-3 text-[var(--warn)]" />
    );
  return (
    <span
      className={`inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] ${status === "running" ? "bg-[var(--ai-soft)] font-medium text-[var(--ai)]" : status === "pending" ? "text-[var(--muted)]" : ""}`}
      title={`${title}: ${status}`}
    >
      {icon}
      <span className="truncate">{title}</span>
    </span>
  );
}

function Intro({
  status,
  suggestions,
  onPick,
  onAutopilot,
  autoRun,
  onAutoRunChange,
}: {
  status: StatusState;
  suggestions: string[];
  onPick: (text: string) => void;
  onAutopilot: () => void;
  autoRun: boolean;
  onAutoRunChange: (value: boolean) => void;
}) {
  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 text-[13px] text-[var(--muted)]">
        <Spinner className="h-3.5 w-3.5" /> Connecting…
      </div>
    );
  }
  if (status === "error" || !status.configured) {
    return (
      <div className="space-y-2 text-[13px] leading-relaxed text-[var(--muted)]">
        <p className="font-medium text-[var(--foreground)]">Set up the assistant</p>
        {status === "error" ? (
          <p>The server could not be reached. Is the app running?</p>
        ) : (
          <>
            <p>
              Add your DeepSeek API key to <code className="rounded bg-[var(--hover)] px-1 font-mono text-[12px]">.env.local</code> and restart the server:
            </p>
            <pre className="rounded-lg bg-[var(--hover)] px-3 py-2 font-mono text-[11.5px] text-[var(--foreground)]">DEEPSEEK_API_KEY=sk-…</pre>
          </>
        )}
      </div>
    );
  }
  return (
    <div>
      <section className="mb-4 rounded-xl border border-[var(--ai)]/30 bg-[var(--ai-soft)] p-3">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--ai)]">
          <Icon.Sparkle className="h-3.5 w-3.5" /> Autopilot
        </p>
        <ol className="mt-1.5 space-y-0.5 text-[12px] leading-relaxed text-[var(--foreground)]">
          <li>1 · Rearrange the diagram into the project&apos;s real architecture (MQ clustering + named modules)</li>
          <li>2 · Review the riskiest code for bugs and feed the findings into the Bayesian ranking</li>
          <li>3 · Write architecture rules, plan the refactoring with A*, and draft a patch per step</li>
        </ol>
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-[var(--muted)]">
            <input type="checkbox" checked={autoRun} onChange={(e) => onAutoRunChange(e.target.checked)} className="accent-[var(--ai)]" />
            Run when a project loads
          </label>
          <button onClick={onAutopilot} className="rounded-lg bg-[var(--ai)] px-3 py-1 text-[12.5px] font-medium text-white hover:brightness-110">
            Run autopilot
          </button>
        </div>
      </section>
      <p className="text-[13px] leading-relaxed text-[var(--muted)]">
        Or ask me anything. I can explore the <strong className="font-medium text-[var(--foreground)]">diagram</strong>, find where a <strong className="font-medium text-[var(--foreground)]">bug</strong> most likely is, and plan and write a{" "}
        <strong className="font-medium text-[var(--foreground)]">refactoring</strong>. I run the app&apos;s own algorithms (Bayesian ranking, the rule engine, A* search), read the code, and point at what I find in the diagram.
      </p>
      <div className="mt-4 space-y-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="flex w-full items-start gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-left text-[12.5px] leading-snug hover:border-[var(--ai)] hover:bg-[var(--ai-soft)]"
          >
            <Icon.Sparkle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ai)]" />
            {s.replace(/`/g, "")}
          </button>
        ))}
      </div>
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
    <div className="space-y-2">
      {(m.reasoning || thinking) && (
        <details className="group text-[12px]">
          <summary className="flex cursor-pointer select-none list-none items-center gap-1.5 text-[var(--muted)] hover:text-[var(--foreground)]">
            {thinking ? <Spinner className="h-3 w-3" /> : <span className="text-[9px] transition-transform group-open:rotate-90">▶</span>}
            {thinking ? "Thinking…" : "Thought process"}
          </summary>
          {m.reasoning && <p className="mt-1.5 max-h-60 overflow-y-auto whitespace-pre-wrap border-l-2 border-[var(--border)] pl-3 text-[11.5px] leading-relaxed text-[var(--muted)]">{m.reasoning}</p>}
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
      {m.stopped && <p className="text-[11.5px] text-[var(--muted)]">Stopped.</p>}
      {m.error && (
        <p className="flex items-start gap-1.5 rounded-lg bg-[var(--danger-soft)] px-2.5 py-1.5 text-[12px] text-[var(--danger)]">
          <Icon.Alert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {m.error}
        </p>
      )}
    </div>
  );
}

function ToolRow({ name, args, result, pending }: { name: string; args: string; result?: ToolMessage; pending: boolean }) {
  const [open, setOpen] = useState(false);
  const running = !result && pending;
  const label = result ? result.summary : running ? `${describeCall(name, args)}…` : `${describeCall(name, args)} — cancelled`;
  return (
    <li className="rounded-lg border border-[var(--border)] text-[12px]">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left" title={name}>
        {running ? (
          <Spinner className="h-3 w-3 shrink-0 text-[var(--ai)]" />
        ) : result?.ok ? (
          <Icon.Check className="h-3 w-3 shrink-0 text-[var(--added)]" />
        ) : (
          <Icon.Alert className="h-3 w-3 shrink-0 text-[var(--warn)]" />
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="shrink-0 font-mono text-[10px] text-[var(--muted)]">{name}</span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-[var(--border)] px-2.5 py-2">
          <ToolData label="Arguments" text={pretty(args)} />
          {result && <ToolData label="Result" text={pretty(result.content)} />}
        </div>
      )}
    </li>
  );
}

function ToolData({ label, text }: { label: string; text: string }) {
  const shown = text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">{label}</p>
      <pre className="mt-0.5 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--hover)] px-2 py-1.5 font-mono text-[10.5px] leading-relaxed">{shown}</pre>
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
