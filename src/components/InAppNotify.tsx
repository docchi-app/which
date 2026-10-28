"use client";

import { useEffect, useState } from "react";
import { firstOpenDone, firstOpenPending } from "@/lib/asks";
import { isSignedIn, onUserChange } from "@/lib/auth";
import { clearNotifyInApp } from "@/lib/install";
import { MOVED_KEY } from "@/lib/move";
import { isPushOn, pushSupport, turnedOff } from "@/lib/push";
import { NotifyAsk } from "./NotifyAsk";

/**
 * The first time Eithr is opened from the Home Screen (iPhone or Android): notifications
 * only work from there on iPhone, so this is the moment to ask, full screen, once.
 */
export function InAppNotify() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!firstOpenPending() || pushSupport() !== "ready") return;
    let moved = false;
    try {
      moved = localStorage.getItem(MOVED_KEY) === "1";
    } catch {}
    if (moved) return; // the move's welcome sheet asks the same, right here
    return onUserChange(async (user) => {
      if (!user || !isSignedIn(user)) return;
      if (Notification.permission === "denied" || turnedOff() || (await isPushOn())) return done();
      firstOpenDone();
      setOpen(true);
    });
  }, []);

  function done() {
    firstOpenDone();
    clearNotifyInApp();
    setOpen(false);
  }

  return open ? <NotifyAsk moment="first" onClose={done} /> : null;
}
