import { getSupabase } from "./supabase";

/** New votes / comments from other people on my polls since I last opened My polls. */
export type Activity = {
  votes: number;
  comments: number;
  polls: Record<string, { votes: number; comments: number }>;
  /** The same polls, newest first, with their questions (for the Activity screen). */
  list: { pollId: string; question: string | null; votes: number; comments: number }[];
  /** Friends who tagged me in a comment, last 7 days. */
  tags: { pollId: string; question: string; by: string; at: string }[];
};

/** Fired after activity is marked seen, so the bell's dot clears everywhere. */
export const ACTIVITY_SEEN = "docchi:activity-seen";

const EMPTY: Activity = { votes: 0, comments: 0, polls: {}, list: [], tags: [] };

export async function fetchActivity(): Promise<Activity> {
  const supabase = getSupabase();
  if (!supabase) return EMPTY;
  const { data, error } = await supabase.rpc("my_activity");
  if (error || !data) return EMPTY;
  const d = data as {
    votes: number;
    comments: number;
    polls: { poll_id: string; question?: string | null; votes: number; comments: number }[];
    tags?: { poll_id: string; question: string; by: string; at: string }[];
  };
  return {
    votes: d.votes,
    comments: d.comments,
    polls: Object.fromEntries(d.polls.map((p) => [p.poll_id, { votes: p.votes, comments: p.comments }])),
    list: d.polls.map((p) => ({ pollId: p.poll_id, question: p.question ?? null, votes: p.votes, comments: p.comments })),
    tags: (d.tags ?? []).map((t) => ({ pollId: t.poll_id, question: t.question, by: t.by, at: t.at })),
  };
}

export async function markActivitySeen(): Promise<void> {
  await getSupabase()?.rpc("mark_activity_seen");
  window.dispatchEvent(new Event(ACTIVITY_SEEN));
}

/** "+12 votes · 3 comments" */
export function activityText(a: { votes: number; comments: number }) {
  return [
    a.votes ? `+${a.votes.toLocaleString("en-IN")} ${a.votes === 1 ? "vote" : "votes"}` : null,
    a.comments ? `${a.comments} ${a.comments === 1 ? "comment" : "comments"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
