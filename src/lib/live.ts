"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { fetchLiveCounts } from "./polls";
import type { LiveCounts } from "./types";

// Live numbers for the cards on screen. One loop for the whole feed: every 5 seconds it asks
// for the counts of the polls on screen (at most 12) in one small request. When nothing has
// moved for a minute it asks every 15 seconds; it stops while the app is in the background or
// nobody has touched it for a minute, and starts again on the next scroll or tap. A card that
// comes on screen gets fresh numbers within half a second.

const FAST_MS = 5000;
const SLOW_MS = 15_000;
const QUIET_AFTER_MS = 60_000;
const IDLE_MS = 60_000;
const SOON_MS = 400;

const onScreen = new Map<string, number>(); // poll id → how many cards show it right now
const fetchedAt = new Map<string, number>();
const seen = new Map<string, string>(); // poll id → its last numbers, to notice change
const listeners = new Set<(rows: LiveCounts[]) => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let timerAt = 0;
let inFlight = false;
let lastChange = 0;
let lastActive = 0;
let listening = false;

const idle = () => document.visibilityState !== "visible" || Date.now() - lastActive > IDLE_MS;

function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timerAt = Date.now() + ms;
  timer = setTimeout(tick, ms);
}

/** Ask soon, unless a request is already due sooner. */
function soon() {
  if (inFlight || (timer && timerAt - Date.now() <= SOON_MS)) return;
  schedule(SOON_MS);
}

async function tick() {
  timer = null;
  // Asleep until the next scroll, tap or return to the app.
  if (idle() || !onScreen.size || !listeners.size) return;
  const ids = [...onScreen.keys()].slice(0, 12);
  inFlight = true;
  try {
    const rows = await fetchLiveCounts(ids);
    const now = Date.now();
    ids.forEach((id) => fetchedAt.set(id, now));
    for (const r of rows) {
      const sig = `${r.voteCount}|${r.viewCount}|${r.commentCount}|${r.recentVotes}`;
      if (seen.has(r.id) && seen.get(r.id) !== sig) lastChange = now;
      seen.set(r.id, sig);
    }
    listeners.forEach((f) => f(rows));
  } catch {
    // Offline for a moment: try again next time.
  } finally {
    inFlight = false;
  }
  schedule(Date.now() - lastChange > QUIET_AFTER_MS ? SLOW_MS : FAST_MS);
}

function listen() {
  if (listening) return;
  listening = true;
  lastActive = Date.now();
  lastChange = Date.now();
  const active = () => {
    const wasIdle = Date.now() - lastActive > IDLE_MS;
    lastActive = Date.now();
    if (wasIdle) lastChange = Date.now(); // back after a break: quick updates again
    if (!timer && !inFlight) soon();
  };
  for (const e of ["scroll", "pointerdown", "keydown", "touchstart"]) window.addEventListener(e, active, { passive: true, capture: true });
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && active());
}

/** Tracks whether the card is on screen; its poll's numbers are fetched while it is. */
export function useLiveCard(ref: RefObject<Element | null>, pollId: string, enabled: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof IntersectionObserver === "undefined") return;
    listen();
    let showing = false;
    const hide = () => {
      if (!showing) return;
      showing = false;
      const n = (onScreen.get(pollId) ?? 1) - 1;
      if (n > 0) onScreen.set(pollId, n);
      else onScreen.delete(pollId);
    };
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !showing) {
        showing = true;
        onScreen.set(pollId, (onScreen.get(pollId) ?? 0) + 1);
        if (Date.now() - (fetchedAt.get(pollId) ?? 0) > FAST_MS) soon();
      } else if (!entry.isIntersecting) hide();
    });
    io.observe(el);
    return () => {
      io.disconnect();
      hide();
    };
  }, [ref, pollId, enabled]);
}

/** Calls `onRows` with fresh numbers for the cards on screen, every few seconds. */
export function useLiveCounts(onRows: (rows: LiveCounts[]) => void) {
  const latest = useRef(onRows);
  useEffect(() => {
    latest.current = onRows;
  });
  useEffect(() => {
    const f = (rows: LiveCounts[]) => latest.current(rows);
    listeners.add(f);
    listen();
    soon();
    return () => {
      listeners.delete(f);
    };
  }, []);
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A number that counts up to its new value over a few seconds instead of jumping, so votes
 * coming in look like votes coming in. Only between real values; it never makes numbers up.
 * Going down, or with reduced motion, it changes at once.
 */
export function useCountUp(target: number): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  useEffect(() => {
    const from = shownRef.current;
    if (from === target) return;
    if (target < from || reducedMotion()) {
      shownRef.current = target;
      setShown(target); // snap to the real value: nothing to animate
      return;
    }
    const diff = target - from;
    const steps = Math.min(diff, 24);
    const every = Math.min(3000, 300 + diff * 200) / steps;
    let i = 0;
    const t = window.setInterval(() => {
      i++;
      const v = i >= steps ? target : from + Math.round((diff * i) / steps);
      shownRef.current = v;
      setShown(v);
      if (i >= steps) window.clearInterval(t);
    }, every);
    return () => window.clearInterval(t);
  }, [target]);
  return shown;
}

/**
 * True once the element is within about a screen of being visible (and stays true), so a card's
 * extra requests (friends who voted, a snap's photo) wait until someone is about to see it.
 */
export function useNearScreen(ref: RefObject<Element | null>): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    if (typeof IntersectionObserver === "undefined") {
      // Very old browser: just load everything.
      const t = window.setTimeout(() => setNear(true), 0);
      return () => window.clearTimeout(t);
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "100% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, near]);
  return near;
}
