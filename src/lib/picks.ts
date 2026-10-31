// Friends' picks: what your friends picked on a poll, once you've voted too. People choose once
// whether friends may see their picks (null = not asked yet); it's fair both ways, so only people
// who share theirs see their friends'. Any single pick can be hidden. Never guests, never Brain
// breaks; friends-only polls already show picks (CirclePicks). See the groups_friend_picks migration.

import { currentUser } from "./auth";
import { getSupabase } from "./supabase";

export type FriendPick = { username: string; avatarUrl: string | null; optionId: string };
export type Match = {
  shared: number;
  /** Polls we picked the same on (only once we've both answered 10). */
  agree?: number;
  topics?: { topic: string; shared: number; agree: number }[];
  split?: { pollId: string; question: string } | null;
};
export type MatchRow = { username: string; avatarUrl: string | null; shared: number; agree: number };

/** Fired when the setting or a hidden pick changes, so cards on screen refresh. */
export const PICKS_CHANGED = "eithr:picks-changed";

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("not configured");
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

// One answer per signed-in person per visit.
let setting: { uid: string; value: Promise<boolean | null> } | null = null;
let hidden: { uid: string; value: Promise<Set<string>> } | null = null;

/** true: friends see my picks; false: private; null: not asked yet (or not signed in). */
export async function picksSetting(): Promise<boolean | null> {
  const user = await currentUser();
  if (!user || user.is_anonymous || !getSupabase()) return null;
  if (setting?.uid !== user.id) setting = { uid: user.id, value: call<boolean | null>("my_picks_setting").catch(() => null) };
  return setting.value;
}

export async function setPicksSetting(share: boolean): Promise<void> {
  await call("set_picks_to_friends", { share });
  const user = await currentUser();
  if (user) setting = { uid: user.id, value: Promise.resolve(share) };
  window.dispatchEvent(new Event(PICKS_CHANGED));
}

/** Polls whose pick I've hidden from friends. */
export async function hiddenPickIds(): Promise<Set<string>> {
  const user = await currentUser();
  if (!user || user.is_anonymous || !getSupabase()) return new Set();
  if (hidden?.uid !== user.id)
    hidden = {
      uid: user.id,
      value: call<{ poll_id: string }[]>("my_hidden_picks")
        .then((rows) => new Set(rows.map((r) => r.poll_id)))
        .catch(() => new Set<string>()),
    };
  return hidden.value;
}

export async function hiddenPicks(): Promise<{ pollId: string; question: string }[]> {
  const rows = await call<{ poll_id: string; question: string | null }[]>("my_hidden_picks");
  return rows.map((r) => ({ pollId: r.poll_id, question: r.question ?? "A poll" }));
}

export async function hidePick(pollId: string, hide: boolean): Promise<void> {
  await call("hide_my_pick", { poll: pollId, hidden: hide });
  const ids = await hiddenPickIds();
  if (hide) ids.add(pollId);
  else ids.delete(pollId);
  window.dispatchEvent(new Event(PICKS_CHANGED));
}

export async function friendPicks(pollId: string): Promise<FriendPick[]> {
  const rows = await call<{ username: string; avatar_url: string | null; option_id: string }[]>("friend_picks", { poll: pollId });
  return rows.map((r) => ({ username: r.username, avatarUrl: r.avatar_url, optionId: r.option_id }));
}

/** "You and @priya": null when we can't compare (not friends, or one of us keeps picks private). */
export async function friendMatch(name: string): Promise<Match | null> {
  const m = await call<{ shared: number; agree?: number; topics?: Match["topics"]; split?: { poll_id: string; question: string } | null } | null>("friend_match", { name });
  if (!m) return null;
  return { shared: m.shared, agree: m.agree, topics: m.topics, split: m.split ? { pollId: m.split.poll_id, question: m.split.question } : null };
}

export async function myMatches(): Promise<MatchRow[]> {
  const rows = await call<{ username: string; avatar_url: string | null; shared: number; agree: number }[]>("my_matches");
  return rows.map((r) => ({ username: r.username, avatarUrl: r.avatar_url, shared: Number(r.shared), agree: Number(r.agree) }));
}

/** "@priya", "@priya and @arjun", "@priya and 2 more". */
export function names(people: { username: string }[]): string {
  if (people.length === 1) return `@${people[0].username}`;
  if (people.length === 2) return `@${people[0].username} and @${people[1].username}`;
  return `@${people[0].username} and ${people.length - 1} more`;
}

/** The line under the results: agreeing, or being the odd one out. */
export function picksLine(picks: FriendPick[], myOptionId: string): string {
  const same = picks.filter((p) => p.optionId === myOptionId);
  const other = picks.length - same.length;
  const others = `${other} ${other === 1 ? "friend" : "friends"}`;
  if (same.length && !other) return `You and ${names(same)} agree on this one.`;
  if (same.length) return `You and ${names(same)} picked this. ${others} went the other way.`;
  return `None of your friends picked this. ${others} went the other way. Bold.`;
}

const ASKED_KEY = "eithr.picksAskedAt";

/** Asked "Show your picks to friends?" in the last 3 days on this phone (closed without answering). */
export function askedRecently(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(ASKED_KEY) ?? 0) < 3 * 864e5;
  } catch {
    return true;
  }
}

export function markAsked() {
  try {
    localStorage.setItem(ASKED_KEY, String(Date.now()));
  } catch {}
}
