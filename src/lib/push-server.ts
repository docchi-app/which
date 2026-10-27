// Server only: holds the VAPID private key and the cron secret.
import webpush from "web-push";

/** A device to push to, and what to show. */
export type PushTarget = { endpoint: string; p256dh: string; auth: string };
export type PushPayload = { title: string; body: string; url: string; tag?: string | null };

// Trimmed: a stray space or newline pasted into Vercel shouldn't break push.
const env = (name: string) => process.env[name]?.trim() || undefined;
const url = env("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const publicKey = env("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
const privateKey = env("VAPID_PRIVATE_KEY");
export const cronSecret = env("PUSH_CRON_SECRET");

/** Everything the sender needs is configured. */
export const pushConfigured = Boolean(url && anonKey && publicKey && privateKey && cronSecret);

let ready = false;
function setup() {
  if (ready) return;
  webpush.setVapidDetails(env("VAPID_SUBJECT") || "mailto:hello@docchi.app", publicKey!, privateKey!);
  ready = true;
}

/** Calls a database function as the anonymous role (the push_… ones check the secret). */
export async function rpc<T>(fn: string, args: Record<string, unknown>, token?: string): Promise<T> {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anonKey!, Authorization: `Bearer ${token ?? anonKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** The signed-in user behind an access token, or null. */
export async function userFromToken(token: string): Promise<string | null> {
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey!, Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string; is_anonymous?: boolean };
  return user.id && !user.is_anonymous ? user.id : null;
}

/**
 * Sends to many devices, a few at a time. Resolves to the endpoints the push
 * service says no longer exist (404 / 410), so they can be deleted.
 */
// Only real push services (the database checks this too), so a stored endpoint
// can never point the sender at another server.
const PUSH_HOST = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)$/;

export function isPushEndpoint(endpoint: string) {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

export async function sendAll(
  items: { target: PushTarget; payload: PushPayload }[],
): Promise<{ sent: number; gone: string[]; failed: number; firstError?: string }> {
  setup();
  const gone: string[] = [];
  let sent = 0;
  let failed = 0;
  let firstError: string | undefined;
  const queue = [...items];
  async function worker() {
    for (let item = queue.shift(); item; item = queue.shift()) {
      if (!isPushEndpoint(item.target.endpoint)) {
        gone.push(item.target.endpoint);
        continue;
      }
      try {
        await webpush.sendNotification(
          { endpoint: item.target.endpoint, keys: { p256dh: item.target.p256dh, auth: item.target.auth } },
          JSON.stringify(item.payload),
          // "high": Android holds "normal" pushes while the phone is idle until it next wakes
          // (they arrived when the app was opened). Every push shows a notification, which
          // is what high priority asks for.
          { TTL: 60 * 60 * 6, urgency: "high", topic: item.payload.tag?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined },
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(item.target.endpoint);
        else {
          failed++;
          firstError ??= `${status ?? ""} ${(e as { body?: string }).body ?? (e as Error).message}`.trim().slice(0, 200);
        }
      }
    }
  }
  await Promise.all(Array.from({ length: 16 }, worker));
  if (firstError) console.error("push send failed:", firstError);
  return { sent, gone, failed, firstError };
}
