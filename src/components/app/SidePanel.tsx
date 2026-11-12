"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./ui";

/**
 * The one side panel: it slides in over the map from the right (a bottom sheet on phones), takes
 * focus when it opens, gives it back when it closes, and closes on Escape or its × button.
 */
export function SidePanel({
  title,
  actions,
  onClose,
  children,
  wide = false,
  label,
}: {
  title: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** Accessible name when the title is not plain text. */
  label?: string;
}) {
  const panel = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // A menu or input inside the panel handles its own Escape first.
      if (e.target instanceof Element && e.target.closest("[role=menu]")) return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <aside
      ref={panel}
      tabIndex={-1}
      data-overlay
      aria-label={label ?? (typeof title === "string" ? title : undefined)}
      className={`k-sheet absolute z-30 flex flex-col overflow-hidden border-[2.5px] border-[var(--ink)] bg-[var(--panel)] outline-none max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[80%] max-md:rounded-t-2xl max-md:border-b-0 md:bottom-4 md:right-4 md:top-4 md:rounded-2xl md:shadow-[5px_5px_0_var(--ink)] ${wide ? "md:w-[480px]" : "md:w-[430px]"}`}
    >
      <div className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-[var(--border)] md:hidden" aria-hidden />
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b-2 border-[var(--ink)] px-5 py-2">
        <h2 className="font-letter min-w-0 flex-1 truncate text-[20px] font-extrabold leading-tight">{title}</h2>
        {actions}
        <button onClick={onClose} className="k-btn !h-9 !w-9 shrink-0 !p-0" title="Close (Esc)" aria-label="Close panel">
          <Icon.Close className="h-4 w-4" />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </aside>
  );
}
