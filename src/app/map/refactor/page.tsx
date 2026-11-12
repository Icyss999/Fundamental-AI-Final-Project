import type { Metadata } from "next";
import { RefactorView } from "@/components/app/ModeViews";

export const metadata: Metadata = { title: "Refactor · Kosmos" };

export default function Page() {
  return <RefactorView />;
}
