/**
 * One-time tips: a small bubble next to the thing it explains, shown at the
 * moment it's useful, never more than one at a time, and at most one every
 * two minutes. Each shows once per browser.
 */
export type TipId = "create" | "comments" | "leaders" | "circle" | "activity";

export const TIPS: Record<TipId, { text: string; anchor: string; skipOn?: string }> = {
  create: { text: "Got a question of your own? Tap + to make a poll.", anchor: '[data-tip="create"]', skipOn: "/create" },
  comments: { text: "See what everyone's saying.", anchor: '[data-tip="comments"]' },
  leaders: { text: "Votes on your polls count toward this week's leaderboard.", anchor: '[data-tip="leaders"]', skipOn: "/leaders" },
  circle: { text: "Polls just for your friends show up here.", anchor: '[data-tip="circle"]' },
  activity: { text: "Your polls got new votes. Tap to see.", anchor: '[data-tip="bell"]', skipOn: "/activity" },
};

export const TIP_EVENT = "docchi:tip";
/** Set once the first-visit "How Eithr works" sheet has been seen (or the first vote cast). */
export const HOW_IT_WORKS_KEY = "docchi.welcomed";
const SEEN_KEY = "docchi.tipsSeen";
const LAST_KEY = "docchi.tipLast";
const VOTES_KEY = "docchi.tipVotes";
const GAP_MS = 2 * 60 * 1000;

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function seen(): Set<string> {
  try {
    return new Set(JSON.parse(store()?.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function markTipSeen(id: TipId) {
  const s = seen();
  s.add(id);
  try {
    store()?.setItem(SEEN_KEY, JSON.stringify([...s]));
    store()?.setItem(LAST_KEY, String(Date.now()));
  } catch {
    // Private mode: the tip may show again next visit. Harmless.
  }
}

/** True if this tip may be shown now (not seen, not too soon after another). */
export function tipAllowed(id: TipId): boolean {
  const s = store();
  if (!s || seen().has(id)) return false;
  return Date.now() - Number(s.getItem(LAST_KEY) ?? 0) > GAP_MS;
}

export type TipRequest = { id: TipId; /** Only inside this poll's card (the feed shows many). */ poll?: string };

/** Ask for a tip; the tip layer shows it when the screen is free. */
export function showTip(id: TipId, poll?: string) {
  if (typeof window === "undefined" || !tipAllowed(id)) return;
  window.dispatchEvent(new CustomEvent<TipRequest>(TIP_EVENT, { detail: { id, poll } }));
}

/** After each vote in this browser: the tips that make sense at that point. */
export function tipsAfterVote(pollHasComments: boolean, pollId?: string) {
  const s = store();
  if (!s) return;
  const n = Number(s.getItem(VOTES_KEY) ?? 0) + 1;
  s.setItem(VOTES_KEY, String(n));
  if (pollHasComments && !seen().has("comments")) return showTip("comments", pollId);
  if (n >= 2) showTip("create");
  if (n >= 6) showTip("leaders");
  if (n >= 8) showTip("circle");
}
