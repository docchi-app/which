import { installPlatform } from "./install";
import { getSupabase } from "./supabase";

export type PushKinds = { votes: boolean; comments: boolean; circle: boolean; results: boolean; daily: boolean; props: boolean };

/**
 * ready: can turn on · install: iPhone/iPad in Safari (add to Home Screen first)
 * or another app's built-in browser (open in a real browser first) · unsupported: this browser can't · off: the app isn't set up for push.
 */
export type PushSupport = "ready" | "install" | "unsupported" | "off";

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
/** Set when notifications were turned off on this device, so they're never turned back on by themselves. */
const OFF_KEY = "eithr.pushOff";

function setTurnedOff(off: boolean) {
  try {
    if (off) localStorage.setItem(OFF_KEY, "1");
    else localStorage.removeItem(OFF_KEY);
  } catch {}
}

function turnedOff(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) === "1";
  } catch {
    return false;
  }
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  if (!VAPID_KEY || !getSupabase()) return "off";
  const capable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIOS() && !isStandalone()) return "install";
  if (installPlatform() === "in-app") return "install";
  return capable ? "ready" : "unsupported";
}

/** Registers /sw.js (safe to call often). */
export async function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  } catch (e) {
    console.error(e);
    return null;
  }
}

function keyBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registerWorker();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

async function save(sub: PushSubscription) {
  const json = sub.toJSON();
  const { error } = (await getSupabase()?.rpc("save_push_subscription", {
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh,
    auth_key: json.keys?.auth,
  })) ?? { error: null };
  if (error) throw error;
}

/** Is this device subscribed (and allowed)? */
export async function isPushOn(): Promise<boolean> {
  if (pushSupport() !== "ready" || Notification.permission !== "granted") return false;
  return (await currentSubscription()) !== null;
}

/** Asks for permission (must run from a tap), subscribes and saves. */
export async function turnOnPush(): Promise<"on" | "denied"> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const reg = await registerWorker();
  if (!reg) throw new Error("no service worker");
  // A brand-new install can take a few seconds to get ready; never hang the button.
  const ready = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 15_000))]);
  if (!ready) throw new Error("service worker not ready");
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_KEY!) }));
  await save(sub);
  setTurnedOff(false);
  return "on";
}

export async function turnOffPush(): Promise<void> {
  setTurnedOff(true);
  const sub = await currentSubscription();
  if (!sub) return;
  await getSupabase()?.rpc("delete_push_subscription", { endpoint: sub.endpoint });
  await sub.unsubscribe();
}

/** Before signing out: stop this device getting the account's notifications. */
export async function forgetThisDevice(): Promise<void> {
  try {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await getSupabase()?.rpc("delete_push_subscription", { endpoint: sub.endpoint });
  } catch {
    // Signing out matters more.
  }
}

/**
 * On app start for a signed-in person: if this device is already subscribed,
 * make sure the server has it (and that it points at this account).
 */
export async function syncPush(): Promise<void> {
  try {
    if (pushSupport() !== "ready" || Notification.permission !== "granted") return;
    let sub = await currentSubscription();
    // Allowed but not subscribed (the subscription was lost, e.g. when Android moved the
    // permission to the installed app): subscribe again, no tap needed since it's allowed.
    // Never when they were turned off here on purpose.
    if (!sub) {
      if (turnedOff()) return;
      const reg = await registerWorker();
      const ready = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 10_000))]);
      if (!reg || !ready) return;
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_KEY!) });
    }
    await save(sub);
  } catch {
    // Next time.
  }
}

export async function getPushKinds(): Promise<PushKinds> {
  const { data, error } = (await getSupabase()?.rpc("get_push_settings")) ?? { data: null, error: null };
  if (error) throw error;
  // Older databases (before the Props migration) don't send "props".
  const kinds = (data as Partial<PushKinds> | null) ?? {};
  return { votes: true, comments: true, circle: true, results: true, daily: true, props: true, ...kinds };
}

export async function setPushKinds(kinds: PushKinds): Promise<void> {
  const { error } = (await getSupabase()?.rpc("set_push_settings", kinds)) ?? { error: null };
  if (error) throw error;
}

export type TestResult = "sent" | "too_many" | "secret_mismatch" | "no_migration" | "send_failed" | "no_device" | "not_configured" | "failed";

/** Pushes a test to this person's devices now. */
export async function sendTestPush(): Promise<{ result: TestResult; detail?: string }> {
  const session = (await getSupabase()?.auth.getSession())?.data.session;
  if (!session) return { result: "failed" };
  try {
    const res = await fetch("/api/push/test", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } });
    if (res.ok) return { result: "sent" };
    const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
    return { result: (body.error as TestResult) ?? "failed", detail: body.detail };
  } catch {
    return { result: "failed" };
  }
}
