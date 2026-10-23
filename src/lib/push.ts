import { getSupabase } from "./supabase";

export type PushKinds = { votes: boolean; circle: boolean; results: boolean; daily: boolean };

/**
 * ready: can turn on · install: iPhone/iPad in Safari, must add to Home Screen
 * first · unsupported: this browser can't · off: the app isn't set up for push.
 */
export type PushSupport = "ready" | "install" | "unsupported" | "off";

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

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
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_KEY!) }));
  await save(sub);
  return "on";
}

export async function turnOffPush(): Promise<void> {
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
    const sub = await currentSubscription();
    if (sub) await save(sub);
  } catch {
    // Next time.
  }
}

export async function getPushKinds(): Promise<PushKinds> {
  const { data, error } = (await getSupabase()?.rpc("get_push_settings")) ?? { data: null, error: null };
  if (error) throw error;
  return (data as PushKinds | null) ?? { votes: true, circle: true, results: true, daily: true };
}

export async function setPushKinds(kinds: PushKinds): Promise<void> {
  const { error } = (await getSupabase()?.rpc("set_push_settings", kinds)) ?? { error: null };
  if (error) throw error;
}

/** Pushes a test to this person's devices now. */
export async function sendTestPush(): Promise<"sent" | "too_many" | "failed"> {
  const session = (await getSupabase()?.auth.getSession())?.data.session;
  if (!session) return "failed";
  const res = await fetch("/api/push/test", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } });
  if (res.status === 429) return "too_many";
  return res.ok ? "sent" : "failed";
}
