"use client";

import { useEffect, useState } from "react";
import { isOldAddress, moveAccount, moveToNewAddress, NEW_ORIGIN } from "@/lib/move";
import { LogoMark } from "./Logo";
import { useBackClose } from "@/lib/back";

const SNOOZE_KEY = "eithr.moveLater";

/**
 * On the old address only (dochhi.vercel.app): "Docchi is now Eithr", with one tap to the same
 * page on eithr.app, already signed in. Shows once per visit; "Later" hides it for this visit.
 */
export function MoveSheet() {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<"google" | "guest" | null>(null);
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOldAddress()) return;
    let snoozed = false;
    try {
      snoozed = sessionStorage.getItem(SNOOZE_KEY) === "1" && !new URLSearchParams(window.location.search).has("move");
    } catch {}
    if (snoozed) return;
    void moveAccount().then((w) => {
      setWho(w);
      setInstalled(window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
      setOpen(true);
    });
  }, []);

  // The back button counts as "later".
  const close = useBackClose(open, later);

  if (!open) return null;
  const host = NEW_ORIGIN.replace(/^https?:\/\//, "");

  function later() {
    try {
      sessionStorage.setItem(SNOOZE_KEY, "1");
    } catch {}
    setOpen(false);
  }

  async function go() {
    setBusy(true);
    try {
      await moveToNewAddress();
    } catch {
      window.location.href = NEW_ORIGIN;
    }
  }

  return (
    <div className="sheet-layer">
      <div className="sheet-backdrop" aria-hidden="true" onClick={close} />
      <section role="dialog" aria-modal="true" aria-labelledby="move-title" className="sheet move-sheet">
        <div className="sheet-handle" aria-hidden="true" />
        <div className="move-mark" aria-hidden="true">
          <LogoMark size={64} />
        </div>
        <h2 id="move-title" className="sheet-title">
          Docchi is now Eithr 🎉
        </h2>
        <p className="sheet-text">
          Same app, same polls, new name. We&apos;re moving to <strong>{host}</strong>
          {who === "google"
            ? ". You'll stay signed in, with all your polls, votes, friends and streak."
            : who === "guest"
              ? ". Your votes come with you, no sign-in needed."
              : "."}
        </p>
        {installed && (
          <p className="move-note">
            📲 Then add Eithr to your Home Screen. This Docchi icon stops working in a couple of weeks.
          </p>
        )}
        <button type="button" className="btn btn-coral press move-go" onClick={go} disabled={busy}>
          {busy ? "Opening Eithr…" : "Open Eithr →"}
        </button>
        <button type="button" className="sheet-later" onClick={close} disabled={busy}>
          Later
        </button>
      </section>
    </div>
  );
}
