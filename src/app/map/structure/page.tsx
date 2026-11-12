import type { Metadata } from "next";
import { StructureView } from "@/components/app/ModeViews";

export const metadata: Metadata = { title: "Structure · Kosmos" };

export default function Page() {
  return <StructureView />;
}
