import type { ReactNode } from "react";
import { Suspense } from "react";
import { MapShell } from "@/components/app/MapShell";

/** The three map pages share one map: switching between them keeps it (and the AI's session) in place. */
export default function MapLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="h-dvh bg-[var(--gutter)]" />}>
      <MapShell>{children}</MapShell>
    </Suspense>
  );
}
