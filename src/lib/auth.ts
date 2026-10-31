import type { User } from "@supabase/supabase-js";
import { forgetThisDevice } from "./push";
import { cacheOwner, clearScreenCache } from "./screen-cache";
import { getSupabase } from "./supabase";
import { forgetViews } from "./views";

/** Thrown by castVote when guest voting isn't available and the viewer must sign in first. */
export class SignInRequired extends Error {
  constructor() {
    super("sign in to vote");
  }
}

/**
 * Signed in with Google. Guests (anonymous accounts) can vote too, but their
 * votes only join the totals once they sign in; commenting and posting need this.
 */
export const isSignedIn = (user: User | null | undefined) => Boolean(user && !user.is_anonymous);

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
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cacheOwner(session?.user?.id ?? null);
    callback(session?.user ?? null);
  });
  return () => data.subscription.unsubscribe();
}

const callbackUrl = () => `${window.location.origin}/auth/callback`;

/**
 * Sends the viewer to Google. A guest account gets Google linked to it, so it
 * keeps its id and its votes; anyone else signs in normally.
 */
export async function continueWithGoogle(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured");
  // Our own Google route links a guest account itself (see /auth/google/callback).
  if (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) return signInWithGoogle();
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

/**
 * Plain Google sign-in. With our own Google client set up it runs through
 * /auth/google, so Google's screen names this site; otherwise Supabase hosts it.
 */
export async function signInWithGoogle(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured");
  if (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a route handler, not a page
    window.location.assign("/auth/google");
    return;
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl() },
  });
  if (error) throw error;
}

/**
 * The current user, starting a guest (anonymous) account if there's no one
 * yet. Null when guest accounts are switched off in Supabase.
 */
export async function currentOrGuest(): Promise<User | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const user = await currentUser();
  if (user) return user;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.warn("Guest voting is unavailable", error.message);
    return null;
  }
  return data.user;
}

export async function signOut(): Promise<void> {
  forgetAccount();
  forgetGuestPicks();
  forgetViews();
  clearScreenCache();
  await forgetThisDevice();
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

// Where to go after sign-in when there's no pending vote (e.g. back to /create).

const RETURN_KEY = "docchi.returnTo";

export function saveReturnTo(path: string) {
  try {
    sessionStorage.setItem(RETURN_KEY, path);
  } catch {
    // Storage blocked: sign-in just lands on the feed.
  }
}

export function takeReturnTo(): string | null {
  try {
    const path = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    // Only paths on this site: "//x" and "/\x" would leave it.
    return path && /^\/(?![/\\])/.test(path) && !/[\\\s]/.test(path) ? path : null;
  } catch {
    return null;
  }
}

// Picks made as a guest. Linking Google keeps them on the same account, but
// if that Google account already had Eithr the guest is left behind, so
// /auth/callback casts them again as the real account.

const GUEST_PICKS_KEY = "docchi.guestPicks";
const MAX_GUEST_PICKS = 50;

export function guestPicks(): PendingVote[] {
  try {
    return JSON.parse(localStorage.getItem(GUEST_PICKS_KEY) ?? "[]") as PendingVote[];
  } catch {
    return [];
  }
}

export function rememberGuestPick(vote: PendingVote) {
  try {
    const picks = guestPicks().filter((p) => p.pollId !== vote.pollId);
    localStorage.setItem(GUEST_PICKS_KEY, JSON.stringify([...picks, vote].slice(-MAX_GUEST_PICKS)));
  } catch {
    // Storage blocked: linking Google still keeps them; only the rare
    // "already had an account" case loses them.
  }
}

export function forgetGuestPicks() {
  try {
    localStorage.removeItem(GUEST_PICKS_KEY);
  } catch {
    // Nothing stored.
  }
}

// The last Google account signed in on this phone, so a sign-in that ran out on its own (not "Sign
// out") can be told apart from a new visitor: "You've been signed out" once, and a vote waits for
// Google instead of quietly starting a guest. Signing out on purpose forgets it.

export type LastAccount = { at: number; streak?: number | null; friends?: number | null; polls?: number | null; told?: boolean };
const ACCOUNT_KEY = "eithr.lastAccount";

export function lastAccount(): LastAccount | null {
  try {
    const a = JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? "null") as LastAccount | null;
    return a && typeof a.at === "number" ? a : null;
  } catch {
    return null;
  }
}

/** Signed in (again): remember it, and any numbers worth showing if the sign-in runs out. */
export function rememberAccount(extra: Partial<Omit<LastAccount, "at">> = {}) {
  try {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ ...(lastAccount() ?? {}), told: false, ...extra, at: Date.now() }));
  } catch {}
}

export function markSignedOutTold() {
  const a = lastAccount();
  if (!a) return;
  try {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ ...a, told: true }));
  } catch {}
}

export function forgetAccount() {
  try {
    localStorage.removeItem(ACCOUNT_KEY);
  } catch {}
}
