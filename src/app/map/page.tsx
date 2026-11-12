import { Suspense } from "react";
import { ToStructure } from "@/components/app/ToStructure";

/** /map on its own opens the Structure page. */
export default function MapIndex() {
  return (
    <Suspense>
      <ToStructure />
    </Suspense>
  );
}
