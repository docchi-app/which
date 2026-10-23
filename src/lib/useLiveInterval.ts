import { useEffect, useRef } from "react";

/**
 * Runs `tick` every `ms` while the tab is visible, and once right away when
 * the viewer comes back to the tab. Nothing runs in the background.
 */
export function useLiveInterval(tick: () => void, ms: number, enabled = true) {
  const latest = useRef(tick);
  useEffect(() => {
    latest.current = tick;
  });

  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    const timer = window.setInterval(run, ms);
    document.addEventListener("visibilitychange", run);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, [ms, enabled]);
}
