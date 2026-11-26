"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Reloads the page data every few seconds so online status and plug status stay live. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      // Do not reload while someone is typing in a form.
      const el = document.activeElement;
      if (el && ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) return;
      router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
