"use client";

import { installPlatform, installSnoozed, snoozeInstall } from "./install";
import { isPushOn, pushSupport, turnedOff } from "./push";

/**
 * Asking people back in. Notifications are the way back, and on iPhone they only work
 * from the Home Screen, and only after a tap on "Allow". So at the moments it's worth
 * it (you posted a poll, got props, added a friend) we ask for whichever step is
 * missing: add Eithr to the Home Screen, or turn notifications on. Each kind of ask
 * comes at most once a week, and never after "Don't Allow" or turning them off in
 * Settings.
 */
export type AskMoment = "posted" | "props" | "friend";
export type Ask = { kind: "install" | "push"; moment: AskMoment };

const ASK_EVENT = "eithr:ask";
const PUSH_ASK_KEY = "eithr.pushAskAt";
const FIRST_OPEN_KEY = "eithr.firstOpenAsked";
const WEEK = 7 * 864e5;

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function set(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Asked again next time; fine.
  }
}

/** Something worth hearing about again just happened. MomentAsk decides whether to ask. */
export function askAt(moment: AskMoment) {
  window.dispatchEvent(new CustomEvent<AskMoment>(ASK_EVENT, { detail: moment }));
}

export function onAsk(f: (moment: AskMoment) => void): () => void {
  const h = (e: Event) => f((e as CustomEvent<AskMoment>).detail);
  window.addEventListener(ASK_EVENT, h);
  return () => window.removeEventListener(ASK_EVENT, h);
}

/** What to ask now, if anything (and from now on it counts as asked). */
export async function askFor(moment: AskMoment): Promise<Ask | null> {
  const support = pushSupport();
  if (support === "ready") {
    // A poll you just posted has its own "Get a ping when votes come in" row.
    if (moment === "posted") return null;
    if (Notification.permission !== "default" || turnedOff() || (await isPushOn())) return null;
    if (Number(get(PUSH_ASK_KEY) ?? 0) > Date.now()) return null;
    set(PUSH_ASK_KEY, String(Date.now() + WEEK));
    return { kind: "push", moment };
  }
  // iPhone Safari, or inside Instagram/WhatsApp: the Home Screen comes first.
  if (support !== "install" || installPlatform() === "desktop" || installSnoozed()) return null;
  snoozeInstall(7);
  return { kind: "install", moment };
}

/** The first open from the Home Screen asks for notifications once, full screen. */
export function firstOpenPending(): boolean {
  return installPlatform() === "installed" && get(FIRST_OPEN_KEY) !== "1";
}
export function firstOpenDone() {
  set(FIRST_OPEN_KEY, "1");
  // The week before the next ask starts now.
  set(PUSH_ASK_KEY, String(Date.now() + WEEK));
}
