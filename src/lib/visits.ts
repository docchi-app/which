import { getSupabase } from "./supabase";

const VISITOR_KEY = "docchi.visitor";
const SEEN_KEY = "docchi.lastSeen";
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
  } catch {
    // Metrics never get in the way.
  }
}
