"use client";

import { useEffect, useState } from "react";
import { MOVED_EVENT, MOVED_KEY } from "@/lib/move";
import { InstallSheet } from "./InstallSheet";
import { NotificationPrompt } from "./Notifications";

/**
 * Right after moving from the old address: the two things a new address can't inherit, the
 * Home Screen app and notification permission, each one tap away.
 */
export function MovedWelcome() {
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    const check = () => {
      let moved = false;
      try {
        moved = localStorage.getItem(MOVED_KEY) === "1";
      } catch {}
      if (!moved || window.location.pathname === "/move") return;
      setStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
      setOpen(true);
    };
    // On load (storage is only readable after mount), and when a move finishes on this page.
    check();
    // After a move, wait until the app has left /move for the page you were on.
    let timer = 0;
    const later = (tries = 0) => {
      if (window.location.pathname !== "/move" || tries > 20) return check();
      timer = window.setTimeout(() => later(tries + 1), 250);
    };
    const onMoved = () => later();
    window.addEventListener(MOVED_EVENT, onMoved);
    return () => {
      window.removeEventListener(MOVED_EVENT, onMoved);
      window.clearTimeout(timer);
    };
  }, []);

  function done() {
    try {
      localStorage.removeItem(MOVED_KEY);
    } catch {}
    setOpen(false);
  }

  if (installing) return <InstallSheet reason="app" onClose={() => setInstalling(false)} />;
  if (!open) return null;
  return (
    <div className="sheet-layer">
      <div className="sheet-backdrop" aria-hidden="true" onClick={done} />
      <section role="dialog" aria-modal="true" aria-labelledby="moved-title" className="sheet move-sheet">
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="moved-title" className="sheet-title">
          You&apos;re in 🎉
        </h2>
        <p className="sheet-text">Everything came with you. Two quick things so Eithr works like before:</p>
        {!standalone && (
          <button type="button" className="btn btn-white press move-step" onClick={() => setInstalling(true)}>
            📲 Add Eithr to your Home Screen
          </button>
        )}
        <NotificationPrompt pitch={<><strong>Turn notifications back on</strong> for votes, friends and the Poll of the Day.</>} />
        <button type="button" className="sheet-later" onClick={done}>
          Done
        </button>
      </section>
    </div>
  );
}
