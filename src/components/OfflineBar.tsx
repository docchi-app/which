"use client";

import { useEffect, useState } from "react";
import { startOutbox } from "@/lib/outbox";

/** A small "You're offline" bar on every screen while the connection is gone. It also sends votes
 *  made while offline once the connection is back (see outbox.ts). */
export function OfflineBar() {
  const [offline, setOffline] = useState(false);

  useEffect(() => startOutbox(), []);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;
  return (
    <p className="offline-bar" role="status">
      📡 You&apos;re offline. Votes you make now are saved and sent when you&apos;re back.
    </p>
  );
}
