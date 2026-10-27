"use client";

import { getSupabase } from "./supabase";

// Docchi is now Eithr: moving people from the old address (dochhi.vercel.app) to the new one
// without signing in again. The browser keeps sign-ins per address, so the old address hands the
// session to the new one in the link's #fragment: browsers never send a fragment to any server,
// the new address uses it once and wipes it from the address bar, and the old address forgets
// the session at once (so the two can't both refresh it).

/** Where people move to. */
export const NEW_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL || "https://eithr.app").replace(/\/$/, "");
/** The old addresses (comma-separated in NEXT_PUBLIC_MOVE_FROM; for testing it can be "localhost"). */
const OLD_HOSTS = (process.env.NEXT_PUBLIC_MOVE_FROM || "dochhi.vercel.app").split(",").map((h) => h.trim()).filter(Boolean);

export const isOldAddress = () => typeof window !== "undefined" && OLD_HOSTS.includes(window.location.hostname);

/** Who's signed in here, for the move sheet. */
export async function moveAccount(): Promise<"google" | "guest" | null> {
  const session = (await getSupabase()?.auth.getSession())?.data.session;
  if (!session) return null;
  return session.user.is_anonymous ? "guest" : "google";
}

/** Goes to the same page on the new address, taking this sign-in along. */
export async function moveToNewAddress() {
  const path = window.location.pathname + window.location.search;
  const supabase = getSupabase();
  // A fresh session, so the new address gets a token that's valid for the next hour.
  const session = supabase && (await supabase.auth.getSession()).data.session ? (await supabase.auth.refreshSession()).data.session : null;
  if (!session || !supabase) {
    window.location.href = NEW_ORIGIN + path;
    return;
  }
  const hand = new URLSearchParams({ at: session.access_token, rt: session.refresh_token, to: path });
  forgetHere(supabase);
  window.location.href = `${NEW_ORIGIN}/move#${hand.toString()}`;
}

/**
 * Forgets the sign-in on this address only. Never signOut(): even "local" sign-out ends the
 * session on the server, and the new address is using that same session now.
 */
function forgetHere(supabase: NonNullable<ReturnType<typeof getSupabase>>) {
  void supabase.auth.stopAutoRefresh();
  for (const c of document.cookie.split("; ")) {
    const name = c.split("=")[0];
    if (name.startsWith("sb-")) document.cookie = `${name}=; Max-Age=0; path=/`;
  }
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("sb-")) localStorage.removeItem(k);
  } catch {}
}

export type Handoff = { at: string; rt: string; to: string; name: string };

/** On the new address: what the old one handed over (and wipe it from the address bar). */
export function takeHandoff(): Handoff | null {
  const raw = window.location.hash.slice(1);
  history.replaceState(null, "", window.location.pathname);
  const hand = new URLSearchParams(raw);
  const at = hand.get("at");
  const rt = hand.get("rt");
  if (!at || !rt) return null;
  const to = hand.get("to") ?? "/";
  return { at, rt, to: /^\/(?![/\\])/.test(to) ? to : "/", name: whoIs(at) };
}

/** A friendly name for the account in an access token (shown before using it). */
function whoIs(token: string): string {
  try {
    const claims = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as {
      is_anonymous?: boolean;
      email?: string;
      user_metadata?: { full_name?: string; name?: string };
    };
    if (claims.is_anonymous) return "your guest account";
    return claims.user_metadata?.full_name || claims.user_metadata?.name || claims.email || "your account";
  } catch {
    return "your account";
  }
}

export const MOVED_KEY = "eithr.moved";
export const MOVED_EVENT = "eithr:moved";

/** Signs in on the new address with the handed-over session. */
export async function finishMove(hand: Handoff): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase.auth.setSession({ access_token: hand.at, refresh_token: hand.rt });
  if (error) return false;
  try {
    localStorage.setItem(MOVED_KEY, "1");
  } catch {}
  window.dispatchEvent(new Event(MOVED_EVENT));
  return true;
}
