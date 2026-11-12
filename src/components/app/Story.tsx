"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Sentence, TourStep } from "@/lib/graph/story";

/** Renders a sentence; module names and file paths are buttons that point at them on the map. */
export function SentenceText({
  sentence,
  labels,
  onModule,
  onFile,
}: {
  sentence: Sentence;
  labels: Record<string, string>;
  onModule: (module: string) => void;
  onFile?: (file: string) => void;
}) {
  return (
    <>
      {sentence.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : "module" in p ? (
          <button key={i} onClick={() => onModule(p.module)} className="font-bold underline decoration-2 underline-offset-[3px] hover:decoration-[3px]" title="Show it on the map">
            {labels[p.module] ?? p.module}
          </button>
        ) : (
          <button key={i} onClick={() => onFile?.(p.file)} className="font-mono text-[0.92em] underline decoration-[1.5px] underline-offset-[3px]" title="Show it on the map">
            {p.file.slice(p.file.lastIndexOf("/") + 1)}
          </button>
        ),
      )}
    </>
  );
}

/**
 * The narration box: yellow, overlapping the map panel's corner like a comic caption. It tells the
 * story of the current mode in plain words and offers the one next action. It can fold away.
 */
export function StoryBox({ title, children, actions, sticker }: { title: string; children: ReactNode; actions?: ReactNode; sticker?: ReactNode }) {
  // Folding lasts until the mode changes (the parent keys the box by mode).
  const [hidden, setHidden] = useState(false);

  if (hidden) {
    return (
      <button
        onClick={() => setHidden(false)}
        data-overlay
        className="k-btn k-btn-yellow k-btn-press absolute z-20 max-md:bottom-3 max-md:left-3 md:left-6 md:top-[-14px]"
        aria-label={`Show the story: ${title}`}
      >
        <span className="font-letter font-extrabold">Story</span>
      </button>
    );
  }
  return (
    <section
      aria-label={title}
      data-overlay
      className="k-fade absolute z-20 flex flex-col rounded-[4px] border-[2.5px] border-[var(--on-yel)] bg-[var(--yel)] text-[var(--on-yel)] max-md:inset-x-3 max-md:bottom-3 max-md:max-h-[44%] max-md:p-4 md:left-6 md:top-[-14px] md:w-[380px] md:p-5"
    >
      {sticker}
      <h1 className="font-letter mb-2 shrink-0 text-[21px] font-extrabold leading-[1.18] [text-wrap:balance] max-md:text-[19px]">{title}</h1>
      <div className="min-h-0 space-y-2 overflow-y-auto text-[15.5px] leading-[1.5] max-md:text-[15px]">{children}</div>
      <div className="mt-4 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 max-md:mt-3">
        {actions}
        <button onClick={() => setHidden(true)} className="k-link ml-auto !text-[var(--on-yel)] text-[14px]">
          Hide
        </button>
      </div>
    </section>
  );
}

/** 16-point starburst, stamped onto the narration box when something is done ("All tidy!"). */
export function Burst({ children }: { children: ReactNode }) {
  const points = Array.from({ length: 32 }, (_, i) => {
    const r = i % 2 === 0 ? 50 : 39;
    const a = (Math.PI * i) / 16 - Math.PI / 2;
    return `${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
  return (
    <span className="k-stamp pointer-events-none absolute -right-7 -top-9 grid h-[96px] w-[96px] place-items-center max-md:hidden" role="img" aria-label={typeof children === "string" ? children : undefined}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
        <polygon points={points} fill="var(--paper)" stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round" />
      </svg>
      <span className="font-letter relative text-center text-[15px] font-extrabold leading-[1.05] text-[var(--ink)]">{children}</span>
    </span>
  );
}

/** The tour: the narration box turned into a step-by-step guide. → / ← move, Esc leaves. */
export function TourBox({
  steps,
  index,
  onIndex,
  onExit,
  labels,
  onModule,
  onFile,
}: {
  steps: TourStep[];
  index: number;
  onIndex: (i: number) => void;
  onExit: () => void;
  labels: Record<string, string>;
  onModule: (module: string) => void;
  onFile: (file: string) => void;
}) {
  const step = steps[index];
  const last = index === steps.length - 1;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]"))) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (last) onExit();
        else onIndex(index + 1);
      } else if (e.key === "ArrowLeft" && index > 0) {
        e.preventDefault();
        onIndex(index - 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onExit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, last, onIndex, onExit]);

  if (!step) return null;
  return (
    <section
      aria-label="Tour of the map"
      data-overlay
      aria-live="polite"
      className="absolute z-20 flex flex-col rounded-[4px] border-[2.5px] border-[var(--on-yel)] bg-[var(--yel)] text-[var(--on-yel)] shadow-[5px_5px_0_var(--on-yel)] max-md:inset-x-3 max-md:bottom-3 max-md:max-h-[52%] max-md:p-4 md:left-6 md:top-[-14px] md:w-[400px] md:p-5"
    >
      <div key={index} className="k-fade min-h-0 overflow-y-auto">
        <div className="mb-2 flex items-start gap-3">
          <span className="font-letter grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border-[2.5px] border-[var(--on-yel)] bg-[var(--paper)] text-[20px] font-extrabold text-[var(--ink)]">{index + 1}</span>
          <h1 className="font-letter pt-0.5 text-[21px] font-extrabold leading-[1.18] [text-wrap:balance]">{step.title}</h1>
        </div>
        <div className="space-y-2 text-[15.5px] leading-[1.5]">
          {step.body.map((s, i) => (
            <p key={i}>
              <SentenceText sentence={s} labels={labels} onModule={onModule} onFile={onFile} />
            </p>
          ))}
        </div>
        {step.files && step.files.length > 0 && (
          <ul className="mt-3 space-y-1">
            {step.files.map((f) => (
              <li key={f.id} className="flex items-baseline justify-between gap-3 text-[14px]">
                <button onClick={() => onFile(f.id)} className="min-w-0 truncate text-left font-mono underline decoration-[1.5px] underline-offset-[3px]" title={f.id}>
                  {f.id.slice(f.id.lastIndexOf("/") + 1)}
                </button>
                <span className="shrink-0 tabular-nums">{f.loc} lines</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-4 flex shrink-0 items-center gap-3">
        <span className="text-[13.5px] font-bold tabular-nums">
          Step {index + 1} of {steps.length}
        </span>
        <span className="flex-1" />
        {index > 0 && (
          <button onClick={() => onIndex(index - 1)} className="k-link !text-[var(--on-yel)] text-[14px]">
            Back
          </button>
        )}
        {!last && (
          <button onClick={onExit} className="k-link !text-[var(--on-yel)] text-[14px]">
            Skip
          </button>
        )}
        <button onClick={() => (last ? onExit() : onIndex(index + 1))} className="k-btn k-btn-ink k-btn-press" aria-keyshortcuts="ArrowRight">
          {last ? "Done" : "Next →"}
        </button>
      </div>
    </section>
  );
}
