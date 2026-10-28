// What each screen last showed, kept in memory while the app is open, so
// coming back to a screen shows it straight away (and it refreshes quietly).
// Cleared on sign-out and whenever the signed-in person changes; a full
// reload starts empty, except for the first polls of the feed, kept on the
// phone (FEED_SNAP) so the app opens straight onto them. That copy is wiped
// the same way, and the feed only uses it for the person who saved it.

type Entry = { value: unknown; at: number };

const store = new Map<string, Entry>();
export const FEED_SNAP = "eithr.feedSnap";

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
