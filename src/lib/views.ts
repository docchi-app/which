"use client";

import { useEffect, type RefObject } from "react";
import { getSupabase } from "./supabase";

// Views: how many people saw a poll. Each poll counts once per person: this
// phone remembers what it already counted (last 2,000 polls, 7 days), and sends
// new ones in small batches (2 seconds after the first, then at most every 10
// seconds, and when the app is closed), so scrolling never costs a request per
// card. The server adds them up every 10 seconds (see the views migration).

const KEY = "docchi.seen";
const KEEP_MS = 7 * 864e5;
const MAX_SEEN = 2000;
const FIRST_MS = 2000;
const EVERY_MS = 10_000;
const BATCH = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let seen: Map<string, number> | null = null;
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let lastSent = 0;
let failures = 0;
let token: string | null | undefined; // the signed-in (or guest) access token, kept for sends on close
let listening = false;

function load(): Map<string, number> {
  if (seen) return seen;
  seen = new Map();
  try {
    const now = Date.now();
    for (const [id, at] of JSON.parse(localStorage.getItem(KEY) ?? "[]") as [string, number][]) {
      if (now - at < KEEP_MS) seen.set(id, at);
    }
  } catch {}
  return seen;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify([...load()].slice(-MAX_SEEN)));
  } catch {}
}

/** This phone already counted a view of the poll. */
export const hasViewed = (pollId: string) => load().has(pollId);

/** Counts a view (once per person). True if it's new. The caller skips the creator's own polls. */
export function recordView(pollId: string): boolean {
  if (!UUID.test(pollId) || load().has(pollId)) return false;
  load().set(pollId, Date.now());
  save();
  pending.add(pollId);
  listen();
  schedule();
  return true;
}

/** Forgets what this phone counted (on sign-out). */
export function forgetViews() {
  seen = new Map();
  pending.clear();
  token = undefined;
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  // Leaving the app: send what's left (keepalive lets it finish after the page is gone).
  const leave = () => void flush(true);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && leave());
  window.addEventListener("pagehide", leave);
  getSupabase()
    ?.auth.onAuthStateChange((_event, session) => {
      token = session?.access_token ?? null;
    });
}

function schedule() {
  if (timer || !pending.size || failures >= 3) return;
  const wait = lastSent ? Math.max(EVERY_MS - (Date.now() - lastSent), 0) : FIRST_MS;
  timer = setTimeout(() => {
    timer = null;
    void flush(false);
  }, wait);
}

async function flush(leaving: boolean) {
  if (!pending.size || !url || !anonKey || failures >= 3) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const ids = [...pending].slice(0, BATCH);
  ids.forEach((id) => pending.delete(id));
  lastSent = Date.now();
  try {
    if (token === undefined && !leaving) token = (await getSupabase()?.auth.getSession())?.data.session?.access_token ?? null;
    // Signed in (or a guest): straight to the database. Signed out: through our server, which
    // hashes the visitor's connection so a count can't be faked from the browser.
    const res = token
      ? await fetch(`${url}/rest/v1/rpc/record_views`, {
          method: "POST",
          headers: { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ polls: ids }),
          keepalive: true,
        })
      : await fetch("/api/views", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
          keepalive: true,
        });
    if (!res.ok) throw new Error(String(res.status));
    failures = 0;
  } catch {
    // Try again later; after 3 failures in a row, stop for this visit (nothing breaks).
    failures++;
    ids.forEach((id) => pending.add(id));
  }
  if (!leaving) schedule();
}

/**
 * Counts a view once the element (a poll card) has been at least half on screen
 * for a second. onCounted runs when this person's view is new.
 */
export function useCountView(ref: RefObject<Element | null>, pollId: string, skip: boolean, onCounted: () => void) {
  useEffect(() => {
    const el = ref.current;
    if (skip || !el || hasViewed(pollId) || typeof IntersectionObserver === "undefined") return;
    let wait: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          wait ??= setTimeout(() => {
            io.disconnect();
            if (recordView(pollId)) onCounted();
          }, 1000);
        } else if (wait) {
          clearTimeout(wait);
          wait = null;
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (wait) clearTimeout(wait);
    };
    // onCounted is a state setter wrapper; re-observing on each render isn't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, pollId, skip]);
}
