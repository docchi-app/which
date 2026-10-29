"use client";

import { useEffect } from "react";
import { reportThrown } from "@/lib/errors";
import { clearScreenCache } from "@/lib/screen-cache";

/** "Something went wrong" in place of a screen that failed to draw; the error goes to Admin → Errors. */
export function Oops({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // What the screens saved (in memory and the feed's copy on the phone) may be what broke
    // it: start clean, so Try again or a reload don't hit the same thing.
    clearScreenCache();
    // Errors from the server arrive without their message; the digest still groups them.
    const digest = (error as { digest?: string } | null)?.digest;
    reportThrown(digest && error instanceof Error ? Object.assign(new Error(`${error.message} (${digest})`), { stack: error.stack }) : error, "Render");
  }, [error]);

  return (
    <main className="oops">
      <span className="oops-logo" aria-hidden="true">
        eithr<span>?</span>
      </span>
      <div className="oops-card">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M8 15c1.2-1 2.5-1.5 4-1.5s2.8.5 4 1.5" />
          <path d="M9 9h.01M15 9h.01" />
        </svg>
        <h1>Something went wrong</h1>
        <p>This screen didn&apos;t load. We&apos;ve been told about it, so you don&apos;t need to report it.</p>
        <button type="button" className="oops-retry press" onClick={() => retry()}>
          Try again
        </button>
        {/* A full load: the app may be in a bad state. */}
        <button type="button" className="oops-home" onClick={() => window.location.assign("/")}>
          Go to the feed
        </button>
      </div>
    </main>
  );
}
