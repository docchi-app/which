import { deviceOf } from "./errors";
import { getSupabase } from "./supabase";

const VISITOR_KEY = "docchi.visitor";
const SEEN_KEY = "docchi.lastSeen";
const INFO_KEY = "eithr.visitorInfo";
/** Back after this long counts as a new session. */
const SESSION_GAP_MS = 30 * 60 * 1000;

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** A random id for this browser, made on first visit (no personal data). */
function visitorId(s: Storage): string {
  let id = s.getItem(VISITOR_KEY);
  if (!id) {
    id = crypto.randomUUID();
    s.setItem(VISITOR_KEY, id);
  }
  return id;
}

/** This browser's random visitor code (null when storage is blocked). */
export function visitorCode(): string | null {
  const s = store();
  try {
    return s ? visitorId(s) : null;
  } catch {
    return null;
  }
}

/** Remembers when the app was last on screen. */
export function markSeen() {
  try {
    store()?.setItem(SEEN_KEY, String(Date.now()));
  } catch {
    // Private mode: sessions just count per page load.
  }
}

/**
 * Counts this visit (one row per browser per day on the server). On page load
 * it always reports, so a sign-in is picked up; when the app comes back into
 * view it reports only if it was away for 30+ minutes (a new session).
 */
export async function trackVisit(onLoad: boolean): Promise<void> {
  const supabase = getSupabase();
  const s = store();
  if (!supabase || !s) return;
  try {
    const away = Date.now() - Number(s.getItem(SEEN_KEY) ?? 0);
    markSeen();
    const newSession = away > SESSION_GAP_MS;
    if (!onLoad && !newSession) return;
    await supabase.rpc("track_visit", { visitor: visitorId(s), new_session: newSession });
    await recordVisitor(s);
    if (onLoad) await noteOpened();
  } catch {
    // Metrics never get in the way.
  }
}

/**
 * Counts a tapped push (?n=<id>, only for the person it was sent to) or an opened email link
 * (?utm_source=email), then takes those bits off the address so a reload doesn't count again.
 */
async function noteOpened() {
  const supabase = getSupabase();
  if (!supabase) return;
  const url = new URL(location.href);
  const n = url.searchParams.get("n");
  const from = url.searchParams.get("utm_source");
  if (!from && !n) return;
  if (n && /^\d{1,15}$/.test(n)) await supabase.rpc("push_opened", { n: Number(n) });
  if (from === "email") await supabase.rpc("email_opened", { campaign: url.searchParams.get("utm_campaign") ?? "" });
  for (const k of ["n", "utm_source", "utm_medium", "utm_campaign"]) url.searchParams.delete(k);
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where this browser's first visit came from: an email, an invite, a shared poll, a social
 * app, another site, or typed in. Only a kind (and a site's name), never the full address.
 */
export function sourceOf(href: string, referrer: string, inApp: string | null) {
  const url = new URL(href);
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.searchParams.get("utm_source") === "email") return { source: "email" };
  if (url.searchParams.get("utm_source") === "push") return { source: "notification" };
  if (parts[0] === "move") return { source: "old_address" };
  if (parts[0] === "u" && parts[1] && url.searchParams.get("invite")) return { source: "invite", by: decodeURIComponent(parts[1]).slice(0, 30) };
  const poll = parts[0] === "p" ? parts[1] : url.searchParams.get("poll");
  if (poll && UUID.test(poll)) return { source: "poll", poll };
  const SOCIAL: Record<string, string> = { Instagram: "instagram", WhatsApp: "whatsapp", Facebook: "facebook", Snapchat: "snapchat" };
  if (inApp && SOCIAL[inApp]) return { source: SOCIAL[inApp] };
  let host = "";
  try {
    host = referrer ? new URL(referrer).hostname.replace(/^www\./, "").toLowerCase() : "";
  } catch {
    host = "";
  }
  if (!host || host === url.hostname) return { source: "direct" };
  if (/(^|\.)instagram\.com$/.test(host)) return { source: "instagram" };
  if (/(^|\.)(whatsapp\.com|wa\.me)$/.test(host)) return { source: "whatsapp" };
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me)$/.test(host)) return { source: "facebook" };
  if (/(^|\.)(t\.co|x\.com|twitter\.com)$/.test(host)) return { source: "x" };
  if (/(^|\.)snapchat\.com$/.test(host)) return { source: "snapchat" };
  if (/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com)$/.test(host)) return { source: "search" };
  return { source: "other_site", site: host.slice(0, 60) };
}

/**
 * Tells the server about this browser (see 20261206000000_people.sql): where the first
 * visit came from (once), and the phone type, install and notifications answer whenever
 * they change or someone signs in on it.
 */
async function recordVisitor(s: Storage) {
  const supabase = getSupabase();
  if (!supabase) return;
  const { device, browser, inApp } = deviceOf(navigator.userAgent, navigator.maxTouchPoints > 1);
  const installed =
    window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  const notif = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
  const uid = (await supabase.auth.getSession()).data.session?.user.id ?? null;
  const now = { device, browser, inApp, installed, notif, uid };
  const before = s.getItem(INFO_KEY);
  if (before === JSON.stringify(now)) return;
  const first = before === null ? sourceOf(location.href, document.referrer, inApp) : {};
  const { error } = await supabase.rpc("record_visitor", {
    visitor: visitorId(s),
    source: (first as { source?: string }).source ?? null,
    source_by: (first as { by?: string }).by ?? null,
    source_poll: (first as { poll?: string }).poll ?? null,
    site: (first as { site?: string }).site ?? null,
    device,
    browser,
    in_app: inApp,
    installed,
    notif,
  });
  if (!error) s.setItem(INFO_KEY, JSON.stringify(now));
}
