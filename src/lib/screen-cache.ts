// What each screen last showed, kept in memory while the app is open, so
// coming back to a screen shows it straight away (and it refreshes quietly).
// Cleared on sign-out and whenever the signed-in person changes; a full
// reload starts empty, except for the first polls of the feed, kept on the
// phone (FEED_SNAP) so the app opens straight onto them. That copy is wiped
// the same way, and the feed only uses it for the person who saved it.

type Entry = { value: unknown; at: number };

const store = new Map<string, Entry>();
export const FEED_SNAP = "eithr.feedSnap";
/** The feed's lists and scroll position. */
export const FEED_CACHE = "feed";

function forgetFeedSnap() {
  try {
    localStorage.removeItem(FEED_SNAP);
  } catch {}
}
let owner: string | null | undefined;

export function remember<T>(key: string, value: T) {
  store.set(key, { value, at: Date.now() });
}

/** The value saved under `key`, if it's younger than `maxAgeMs`. */
export function recall<T>(key: string, maxAgeMs = 30 * 60_000): T | undefined {
  const hit = store.get(key);
  if (!hit || Date.now() - hit.at > maxAgeMs) return undefined;
  return hit.value as T;
}

/**
 * Opening the feed on a poll (`/?poll=…`) from another screen: the feed must load
 * that poll rather than carry on where it was. (While the app moves between
 * screens, the feed can't yet see the new address, so it's told this way.)
 */
export function openingFeedOnPoll() {
  store.delete(FEED_CACHE);
}

/**
 * Polls that are gone (removed by an admin, hidden by reports or the AI check, deleted):
 * out of every list the feed remembers, and out of the copy kept on the phone, so going
 * back to a tab or reopening the app doesn't bring them back.
 */
export function forgetPolls(ids: string[]) {
  if (!ids.length) return;
  const gone = new Set(ids);
  const feed = store.get(FEED_CACHE)?.value as { tabs?: Record<string, { polls: { id: string }[] } | undefined> } | undefined;
  // In place: the feed holds the same lists.
  for (const t of Object.values(feed?.tabs ?? {})) if (t) t.polls = t.polls.filter((p) => !gone.has(p.id));
  for (const id of ids) store.delete(`poll:${id}`);
  try {
    const s = JSON.parse(localStorage.getItem(FEED_SNAP) ?? "null") as { polls?: { id: string }[] } | null;
    if (s?.polls?.some((p) => gone.has(p.id))) {
      s.polls = s.polls.filter((p) => !gone.has(p.id));
      localStorage.setItem(FEED_SNAP, JSON.stringify(s));
    }
  } catch {}
}

export function clearScreenCache() {
  store.clear();
  forgetFeedSnap();
}

/** Who's signed in (null: nobody). A different person starts with an empty cache. */
export function cacheOwner(id: string | null) {
  if (owner !== undefined && owner !== id) {
    store.clear();
    forgetFeedSnap();
  }
  owner = id;
}
