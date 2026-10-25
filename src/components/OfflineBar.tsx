"use client";

import { useEffect, useState } from "react";

/** A small "You're offline" bar on every screen while the connection is gone. */
export function OfflineBar() {
  const [offline, setOffline] = useState(false);

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
      📡 You&apos;re offline. Votes and new polls wait for your connection.
    </p>
  );
}
