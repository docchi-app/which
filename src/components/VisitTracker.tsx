"use client";

import { useEffect } from "react";
import { useTrackDepth } from "@/lib/back";
import { markSeen, trackVisit } from "@/lib/visits";

/** Counts visits for the admin metrics, and how deep into the app this screen is. Renders nothing. */
export function VisitTracker() {
  useTrackDepth();
  useEffect(() => {
    trackVisit(true);
    const onChange = () => (document.visibilityState === "visible" ? trackVisit(false) : markSeen());
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return null;
}
