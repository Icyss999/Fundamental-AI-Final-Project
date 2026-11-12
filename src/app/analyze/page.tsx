import type { Metadata } from "next";
import { Suspense } from "react";
import { AnalyzeScreen } from "@/components/app/AnalyzeScreen";

export const metadata: Metadata = { title: "Reading the code · Kosmos" };

// The repository comes from ?repo=, known only in the browser: the screen renders below a Suspense boundary.
export default function AnalyzePage() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-[var(--paper)]" />}>
      <AnalyzeScreen />
    </Suspense>
  );
}
