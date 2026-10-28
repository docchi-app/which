"use client";

import { useEffect, useState } from "react";
import { isSignedIn, onUserChange } from "@/lib/auth";
import { clearNotifyInApp, installPlatform, notifyInAppPending } from "@/lib/install";
import { MOVED_KEY } from "@/lib/move";
import { isPushOn, pushSupport } from "@/lib/push";
import { NotificationPrompt } from "./Notifications";
import { useBackClose } from "@/lib/back";

/**
 * First open of the app just installed on Android: notification permission belongs to the
 * installed app there, so this is where it gets turned on. Shows once.
 */
export function InAppNotify() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (installPlatform() !== "installed" || !notifyInAppPending() || pushSupport() !== "ready") return;
    let moved = false;
    try {
      moved = localStorage.getItem(MOVED_KEY) === "1";
    } catch {}
    if (moved) return; // the move's welcome sheet asks the same, right here
    return onUserChange(async (user) => {
      if (!user || !isSignedIn(user)) return;
      if (await isPushOn()) return clearNotifyInApp();
      setOpen(true);
    });
  }, []);

  function done() {
    clearNotifyInApp();
    setOpen(false);
  }

  // The back button counts as Done.
  const close = useBackClose(open, done);

  if (!open) return null;
  return (
    <div className="sheet-layer">
      <div className="sheet-backdrop" aria-hidden="true" onClick={close} />
      <section role="dialog" aria-modal="true" aria-labelledby="inapp-title" className="sheet move-sheet">
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="inapp-title" className="sheet-title">
          One last thing 🔔
        </h2>
        <p className="sheet-text">Turn on notifications in the app, so you hear when your polls take off and friends add you.</p>
        <NotificationPrompt inSheet pitch={<><strong>Turn on notifications</strong> for votes, friends and the Poll of the Day.</>} />
        <button type="button" className="sheet-later" onClick={close}>
          Done
        </button>
      </section>
    </div>
  );
}
