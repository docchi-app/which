import { getSupabase } from "./supabase";

/** Days in a row (India time) with at least one vote; alive until midnight. */
export type Streak = { current: number; best: number; today: boolean };

export const NO_STREAK: Streak = { current: 0, best: 0, today: false };

/** Fired after a vote, so the streak chip refreshes. */
export const STREAK_CHANGED = "docchi:streak-changed";
export const announceVote = () => window.dispatchEvent(new Event(STREAK_CHANGED));

/** Streak lengths worth a little celebration. */
export const MILESTONES = [3, 7, 14, 30, 50, 100, 200, 365];

export async function fetchStreak(): Promise<Streak> {
  const supabase = getSupabase();
  if (!supabase) return NO_STREAK;
  const { data, error } = await supabase.rpc("my_streak");
  if (error || !data) return NO_STREAK;
  const d = data as { current: number; best: number; today: boolean };
  return { current: d.current, best: d.best, today: d.today };
}

export type RecentResult = {
  pollId: string;
  question: string;
  voteCount: number;
  winner: string;
  winnerPct: number;
  myPick: string | null;
  mine: boolean;
};

/** Polls I voted on or made that closed in the last 3 days. */
export async function fetchRecentResults(): Promise<RecentResult[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("recent_results");
  if (error || !data) return [];
  return (
    data as { poll_id: string; question: string; vote_count: number; winner: string; winner_pct: number; my_pick: string | null; mine: boolean }[]
  ).map((r) => ({
    pollId: r.poll_id,
    question: r.question,
    voteCount: r.vote_count,
    winner: r.winner,
    winnerPct: r.winner_pct,
    myPick: r.my_pick,
    mine: r.mine,
  }));
}
