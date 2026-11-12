"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { mapHref } from "./routes";

/** Sends /map?repo=… to its Structure page. */
export function ToStructure() {
  const repo = useSearchParams().get("repo");
  const router = useRouter();
  useEffect(() => {
    router.replace(repo ? mapHref("structure", repo) : "/");
  }, [repo, router]);
  return null;
}
