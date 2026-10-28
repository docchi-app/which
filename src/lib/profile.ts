import { forgetThisDevice } from "./push";
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

export type BestRank = { rank: number; week: string };

/** Best weekly rank on the creators board (null = never in the top 100). name: whose; mine if left out. */
export async function getBestRank(name?: string): Promise<BestRank | null> {
  const { data } = (await getSupabase()?.rpc("best_rank", { name: name ?? null })) ?? {};
  return (data as BestRank | null) ?? null;
}

export class DeleteAccountError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/**
 * Deletes my account for good. Snap photos first (Storage can't be cleared
 * from SQL, and the database refuses while any are left), then everything
 * else in one go, then this device forgets the session and Eithr's settings.
 */
export async function deleteMyAccount(confirm: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new DeleteAccountError("demo");
  const { data: files } = await supabase.rpc("my_storage_files");
  const paths = (files as string[] | null) ?? [];
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await supabase.storage.from("snaps").remove(paths.slice(i, i + 100));
    if (error) throw new DeleteAccountError("photos_left");
  }
  await forgetThisDevice().catch(() => {});
  const { error } = await supabase.rpc("delete_my_account", { confirm });
  if (error) throw new DeleteAccountError(/docchi:(\w+)/.exec(error.message)?.[1] ?? "failed");
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith("docchi.")) localStorage.removeItem(key);
  } catch {
    // Storage blocked: nothing saved to clear.
  }
}

export const DELETE_ERRORS: Record<string, string> = {
  confirm: "Type DELETE to confirm.",
  photos_left: "Couldn't remove your snap photos. Check your connection and try again.",
  sign_in: "You're signed out already.",
  demo: "Demo mode: there's no account to delete.",
};

/** Settings → "Email me what I missed" (the evening summary for people without notifications). */
export async function emailSummary(off: boolean | null = null): Promise<{ on: boolean; hasEmail: boolean } | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("my_email_summary", { off });
  if (error) throw error;
  return { on: data.on === true, hasEmail: data.has_email === true };
}
