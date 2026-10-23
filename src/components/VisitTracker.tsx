"use client";

import { useEffect } from "react";
import { markSeen, trackVisit } from "@/lib/visits";

/** Counts visits for the admin metrics. Renders nothing. */
export function VisitTracker() {
  useEffect(() => {
    trackVisit(true);
    const onChange = () => (document.visibilityState === "visible" ? trackVisit(false) : markSeen());
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return null;
}
