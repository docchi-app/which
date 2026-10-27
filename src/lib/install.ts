/**
 * Getting Eithr onto the Home Screen.
 *   installed: already opened from the Home Screen
 *   android:   Chrome & co. — a real install prompt when the browser offers one
 *   ios:       Safari (or another iPhone browser) — Share → Add to Home Screen
 *   in-app:    inside Instagram, Facebook, WhatsApp… — must open in a real browser first
 *   desktop:   not worth nudging
 */
export type InstallPlatform = "installed" | "android" | "ios" | "in-app" | "desktop";

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: PromptEvent | null = null;
const listeners = new Set<() => void>();
const SNOOZE_KEY = "docchi.installSnooze";
const VOTES_KEY = "docchi.votesHere";
/** Set when Eithr was just installed on Android: notifications get turned on inside the installed app. */
export const NOTIFY_IN_APP_KEY = "eithr.notifyInApp";

/** Installed on Android from this browser, and notifications not yet turned on in the app. */
export function notifyInAppPending(): boolean {
  try {
    return localStorage.getItem(NOTIFY_IN_APP_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearNotifyInApp() {
  try {
    localStorage.removeItem(NOTIFY_IN_APP_KEY);
  } catch {}
}

/** Call once at app start: keeps Chrome's install prompt for later. */
export function captureInstallPrompt() {
  const early = (window as { __docchiInstall?: PromptEvent }).__docchiInstall;
  if (early) deferred = early;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as PromptEvent;
    listeners.forEach((f) => f());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    snoozeInstall(3650);
    // Android moves notification permission to the installed app: ask there, on its first open.
    if (/Android/i.test(navigator.userAgent)) {
      try {
        localStorage.setItem(NOTIFY_IN_APP_KEY, "1");
      } catch {}
    }
    listeners.forEach((f) => f());
  });
}

export function onInstallChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Android offered a one-tap install. */
export const canPromptInstall = () => deferred !== null;

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  listeners.forEach((f) => f());
  return outcome === "accepted";
}

export function installPlatform(): InstallPlatform {
  const ua = navigator.userAgent;
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (standalone) return "installed";
  // Social apps' built-in browsers can't add to the Home Screen.
  if (/Instagram|FBAN|FBAV|FB_IAB|FBIOS|WhatsApp|Snapchat|Line\/|LinkedInApp|musical_ly|BytedanceWebview|TikTok|; wv\)/i.test(ua)) {
    return "in-app";
  }
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

export const isIPhoneLike = () => /iPad|iPhone|iPod/.test(navigator.userAgent);

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function installSnoozed(): boolean {
  return Number(store()?.getItem(SNOOZE_KEY) ?? 0) > Date.now();
}

export function snoozeInstall(days = 7) {
  try {
    store()?.setItem(SNOOZE_KEY, String(Date.now() + days * 864e5));
  } catch {
    // Fine: we'll just ask again next time.
  }
}

/** Counts votes made in this browser; true on the one that should bring up the nudge. */
export function countVoteForNudge(): boolean {
  const s = store();
  if (!s) return false;
  const n = Number(s.getItem(VOTES_KEY) ?? 0) + 1;
  s.setItem(VOTES_KEY, String(n));
  return n >= 3 && !installSnoozed() && installPlatform() !== "installed" && installPlatform() !== "desktop";
}
