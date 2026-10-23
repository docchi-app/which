import type { User } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";

/** Thrown by castVote when the viewer needs to sign in first. */
export class SignInRequired extends Error {
  constructor() {
    super("sign in to vote");
  }
}

/** Guest (anonymous) accounts from the first release can browse but not vote. */
export const canVote = (user: User | null | undefined) => Boolean(user && !user.is_anonymous);

export async function currentUser(): Promise<User | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

/** Calls back with the current user now and whenever they sign in or out. Returns an unsubscribe. */
export function onUserChange(callback: (user: User | null) => void): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session?.user ?? null));
  return () => data.subscription.unsubscribe();
}

const callbackUrl = () =>`${window.location.origin}/auth/callback`;

/**
 * Sends the viewer to Google. A guest account gets Google linked to it, so it
 * keeps its id and its votes; anyone else signs in normally.
 */
export async function continueWithGoogle(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured");
  const user = await currentUser();
  if (user?.is_anonymous) {
    const { error } = await supabase.auth.linkIdentity({ provider: "google", options: { redirectTo: callbackUrl() } });
    if (!error) return;
    // Linking can be switched off in Supabase ("Allow manual linking"). Don't
    // leave the viewer stuck: sign in normally; the guest's old votes stay behind.
    console.warn("Couldn't link Google to the guest account, signing in instead", error);
  }
  return signInWithGoogle();
}

/** Plain Google sign-in, used when that Google account already has a Docchi account. */
export async function signInWithGoogle(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl() },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await getSupabase()?.auth.signOut();
}

// The pick made before signing in, cast once Google sends the viewer back.

export type PendingVote = { pollId: string; optionId: string };

const PENDING_KEY = "docchi.pendingVote";

export function savePendingVote(vote: PendingVote) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(vote));
  } catch {
    // Storage blocked: the viewer just taps their pick again after signing in.
  }
}

export function takePendingVote(): PendingVote | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingVote) : null;
  } catch {
    return null;
  }
}
