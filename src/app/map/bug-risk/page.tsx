import type { Metadata } from "next";
import { RiskView } from "@/components/app/ModeViews";

export const metadata: Metadata = { title: "Bug risk · Kosmos" };

export default function Page() {
  return <RiskView />;
}
