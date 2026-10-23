import { getSupabase } from "./supabase";

export type Profile = {
  /** null while it's still a guest_… name. */
  username: string | null;
  avatarUrl: string | null;
  joined: string;
  usernameChangedAt: string | null;
  pollsMade: number;
  votesReceived: number;
  shares: number;
  votesCast: number;
};

export async function getMyProfile(): Promise<Profile | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("my_profile");
  if (error) throw error;
  if (!data) return null;
  return {
    username: data.username,
    avatarUrl: data.avatar_url,
    joined: data.joined,
    usernameChangedAt: data.username_changed_at,
    pollsMade: data.polls_made,
    votesReceived: data.votes_received,
    shares: data.shares,
    votesCast: data.votes_cast,
  };
}

/** Throws an Error whose message is the reason code (taken, too_soon, …). */
export async function updateUsername(name: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.rpc("update_username", { name });
  if (error) throw new Error(/docchi:username_(\w+)/.exec(error.message)?.[1] ?? "failed");
}

/** 1234 → "1,234", 22400 → "22.4k". */
export function compactCount(n: number): string {
  if (n < 10_000) return n.toLocaleString("en-US");
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}
