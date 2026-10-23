import { getSupabase } from "./supabase";

export type Profile = {
  /** null while it's still a guest_… name. */
  username: string | null;
  /** false until they confirm or change their starting username. */
  usernameConfirmed: boolean;
  avatarUrl: string | null;
  joined: string;
  usernameChangedAt: string | null;
  pollsMade: number;
  votesReceived: number;
  shares: number;
  votesCast: number;
  /** Can open /admin. */
  isAdmin: boolean;
};

export async function getMyProfile(): Promise<Profile | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("my_profile");
  if (error) throw error;
  if (!data) return null;
  return {
    username: data.username,
    usernameConfirmed: data.username_confirmed ?? true,
    avatarUrl: data.avatar_url,
    joined: data.joined,
    usernameChangedAt: data.username_changed_at,
    pollsMade: data.polls_made,
    votesReceived: data.votes_received,
    shares: data.shares,
    votesCast: data.votes_cast,
    isAdmin: data.is_admin === true,
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

/** Free usernames to offer, built from the Google name. */
export async function getUsernameSuggestions(): Promise<string[]> {
  const { data, error } = (await getSupabase()?.rpc("username_suggestions")) ?? {};
  if (error) throw error;
  return (data as string[] | null) ?? [];
}

/** Fired after the username changes, so screens showing it refresh. */
export const PROFILE_CHANGED = "docchi:profile-changed";
