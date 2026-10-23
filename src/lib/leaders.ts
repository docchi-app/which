import { getSupabase } from "./supabase";

export type Board = "creators" | "polls";

export type LeaderRow = {
  rank: number;
  score: number;
  username: string | null;
  avatarUrl: string | null;
  isMe: boolean;
  /** polls board only */
  pollId?: string;
  question?: string;
  kind?: string;
  closed?: boolean;
};

export type Leaderboard = {
  weekStart: string;
  weekEnd: string;
  updatedAt: string | null;
  rows: LeaderRow[];
  /** creators board, signed in: your place (rank null = not in the top 100 yet) */
  me: { rank: number | null; score: number } | null;
  lastChamp: { username: string; avatarUrl: string | null; score: number } | null;
};

type Raw = {
  week_start: string;
  week_end: string;
  updated_at: string | null;
  rows: { rank: number; score: number; username: string | null; avatar_url: string | null; is_me: boolean | null; poll_id?: string; question?: string; kind?: string; closed?: boolean }[];
  me: { rank: number | null; score: number } | null;
  last_champ: { username: string; avatar_url: string | null; score: number } | null;
};

export async function fetchLeaderboard(board: Board, which: "this" | "last"): Promise<Leaderboard | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_leaderboard", { board, which });
  if (error) throw error;
  const d = data as Raw;
  return {
    weekStart: d.week_start,
    weekEnd: d.week_end,
    updatedAt: d.updated_at,
    rows: d.rows.map((r) => ({
      rank: r.rank,
      score: r.score,
      username: r.username,
      avatarUrl: r.avatar_url,
      isMe: Boolean(r.is_me),
      pollId: r.poll_id,
      question: r.question,
      kind: r.kind,
      closed: r.closed,
    })),
    me: d.me,
    lastChamp: d.last_champ && { username: d.last_champ.username, avatarUrl: d.last_champ.avatar_url, score: d.last_champ.score },
  };
}
