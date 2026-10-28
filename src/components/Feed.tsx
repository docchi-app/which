"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { guestPicks, isSignedIn, onUserChange, savePendingVote, takePendingVote } from "@/lib/auth";
import { countVoteForNudge } from "@/lib/install";
import { cleanUpSnapPhotos } from "@/lib/snap";
import { announceVote } from "@/lib/streak";
import { warmShareCard } from "@/lib/share";
import { HOW_IT_WORKS_KEY, showTip, tipsAfterVote } from "@/lib/tips";
import { FEED_PAGE_SIZE, fetchFeed, fetchPoll, recordOpen } from "@/lib/polls";
import { isSupabaseConfigured } from "@/lib/supabase";
import { FEED_CACHE, FEED_SNAP, recall, remember } from "@/lib/screen-cache";
import { warmProfile, warmTabs } from "@/lib/warm";
import { isPropsSlot, propsSlot, propsState } from "@/lib/props";
import { useLiveCounts } from "@/lib/live";
import { useLiveInterval } from "@/lib/useLiveInterval";
import type { FeedTab, LiveCounts, Poll, VoteResult } from "@/lib/types";
import { LogoMark, Wordmark } from "./Logo";
import { ANSWER_COLORS, PollCard } from "./PollCard";
import { PropsCard } from "./PropsCard";
import type { SheetPick } from "./SignInSheet";
import { BottomNav, FEED_TOP } from "./BottomNav";
import { Bell } from "./Bell";
import { StreakChip } from "./StreakChip";
import { useBackClose } from "@/lib/back";

// Sheets load only when they open, so the first screen needs less JavaScript.
const SignInSheet = dynamic(() => import("./SignInSheet").then((m) => m.SignInSheet), { ssr: false });
const ShareSheet = dynamic(() => import("./ShareSheet").then((m) => m.ShareSheet), { ssr: false });
const InstallSheet = dynamic(() => import("./InstallSheet").then((m) => m.InstallSheet), { ssr: false });
const HowItWorks = dynamic(() => import("./HowItWorks").then((m) => m.HowItWorks), { ssr: false });

const TABS: { id: FeedTab; label: string }[] = [
  { id: "trending", label: "For you" },
  { id: "new", label: "New" },
  { id: "circle", label: "Friends" },
];

// How often to look for polls posted since the feed loaded.
const NEW_POLLS_CHECK_MS = 45_000;
// Load the next page when the end of the list is this close (px below the screen).
const LOAD_AHEAD_PX = 1500;
// A long session: past this many items, the oldest ones above the screen are let go.
const MAX_ITEMS = 90;
const KEEP_ITEMS = 60;
// Pull down this far (px, after the drag is halved) at the top to refresh.
const PULL_TO_REFRESH = 64;

// A guest's 3rd vote is when we ask them to sign in so their votes count.
const SAVE_VOTES_AFTER = 3;
const SAVE_ASKED_KEY = "docchi.saveVotesAsked";
// The "Unlock Props" card shows at most once a day.
const PROPS_LOCKED_KEY = "docchi.propsLockedDay";
// The feed from last time, shown the moment the app opens (see FEED_SNAP in screen-cache).
const FEED_SNAP_MAX_AGE = 12 * 3600_000;
const today = () => new Date().toLocaleDateString("en-CA");

function shownToday(key: string) {
  try {
    return localStorage.getItem(key) === today();
  } catch {
    return false;
  }
}

function markShownToday(key: string) {
  try {
    localStorage.setItem(key, today());
  } catch {
    // Shown again next time. Harmless.
  }
}
// The guest's "votes not counted yet" bar: ✕ hides it for a day.
const GUEST_BAR_HIDDEN_KEY = "docchi.guestBarHidden";
const GUEST_TOAST_KEY = "docchi.guestToastShown";

function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return "1"; // storage blocked: skip one-time prompts rather than repeat them
  }
}

function store(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // Storage blocked: the prompt may show again. Harmless.
  }
}

/** One tab's list and where it was scrolled to. */
type TabState = { polls: Poll[]; hasMore: boolean; votedBefore: string[]; scrollY: number; at: number };
type FeedMemory = { tab: FeedTab; tabs: Partial<Record<FeedTab, TabState>> };
const TAB_MAX_AGE = 10 * 60_000;

/** Where the feed was, unless this visit opens a particular poll (a shared link, or one just posted). */
function savedFeed(initialPollId?: string): FeedMemory | null {
  if (initialPollId || typeof window === "undefined" || new URLSearchParams(window.location.search).has("poll")) return null;
  const m = recall<FeedMemory>(FEED_CACHE, TAB_MAX_AGE);
  return m?.tabs[m.tab] ? m : null;
}

/** The first polls of For you from the last visit on this phone, if they were this person's. */
function snapFromLastVisit(owner: string | null): Poll[] | null {
  try {
    const s = JSON.parse(localStorage.getItem(FEED_SNAP) ?? "null") as { owner: string | null; at: number; polls: Poll[] } | null;
    if (!s || s.owner !== owner || Date.now() - s.at > FEED_SNAP_MAX_AGE || !s.polls?.length) return null;
    return s.polls;
  } catch {
    return null;
  }
}

function saveSnap(owner: string | null, polls: Poll[]) {
  try {
    const first = polls.filter((p) => !isPropsSlot(p)).slice(0, 15);
    localStorage.setItem(FEED_SNAP, JSON.stringify({ owner, at: Date.now(), polls: first }));
  } catch {
    // Full or blocked: next time opens without it.
  }
}

/** Fresh numbers from the live loop, merged into the list (the same list if nothing moved). */
function mergeLive(list: Poll[], rows: LiveCounts[]): Poll[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  let changed = false;
  const next = list.map((p) => {
    const r = byId.get(p.id);
    if (!r) return p;
    const options = p.options.map((o) => (r.votes[o.id] !== undefined && r.votes[o.id] !== o.votes ? { ...o, votes: r.votes[o.id] } : o));
    const moved =
      r.voteCount !== p.voteCount ||
      r.viewCount !== p.viewCount ||
      r.commentCount !== p.commentCount ||
      r.recentVotes !== (p.recentVotes ?? 0) ||
      options.some((o, i) => o !== p.options[i]);
    if (!moved) return p;
    changed = true;
    // Never step back below what we already showed for our own vote (the server can lag a moment).
    return { ...p, voteCount: Math.max(r.voteCount, p.myOptionId ? 1 : 0), viewCount: r.viewCount, commentCount: r.commentCount, recentVotes: r.recentVotes, options };
  });
  return changed ? next : list;
}

/** `initialPollId` opens the feed on that poll (a shared /p/<id> link). */
export function Feed({ initialPollId }: { initialPollId?: string } = {}) {
  // Coming back from another screen: carry on where you were, no reload.
  const [saved] = useState(() => savedFeed(initialPollId));
  const tabsRef = useRef<Partial<Record<FeedTab, TabState>>>(saved?.tabs ?? {});
  const [tab, setTab] = useState<FeedTab>(saved?.tab ?? "trending");
  const savedTab = saved?.tabs[saved.tab];
  // Props cards already slotted into this list (a restored list has them).
  const propsAdded = useRef(!!saved);
  const [polls, setPolls] = useState<Poll[] | null>(() => {
    if (savedTab) return savedTab.polls;
    // A poll opened from a list (Profile): show it straight away.
    const opened = initialPollId ? recall<Poll>(`poll:${initialPollId}`, 60_000) : undefined;
    return opened ? [opened] : null;
  });
  // For callbacks that shouldn't change identity when the list does.
  const pollsRef = useRef(polls);
  useEffect(() => {
    pollsRef.current = polls;
  });
  const [hasMore, setHasMore] = useState(savedTab?.hasMore ?? false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [offline, setOffline] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(isSupabaseConfigured ? null : true);
  // A pick waiting for sign-in (guest voting is off), or "save": a guest asked to make their votes count.
  const [sheet, setSheet] = useState<SheetPick | "save" | null>(null);
  // Guest votes waiting to be counted (shown in the bar), and the one-time note after the first.
  const [waiting, setWaiting] = useState(0);
  const [guestBarHidden, setGuestBarHidden] = useState(true);
  const [guestToast, setGuestToast] = useState(false);
  const signedInRef = useRef(signedIn);
  useEffect(() => {
    signedInRef.current = signedIn;
  });
  const [sharing, setSharing] = useState<Poll | null>(null);
  const [installNudge, setInstallNudge] = useState(false);
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  // Poll whose vote was just cast on the way back from Google sign-in.
  const [celebrateId, setCelebrateId] = useState<string | null>(null);
  // Poll the viewer just posted (arrives from /create with ?created=1).
  const [createdId, setCreatedId] = useState<string | null>(null);
  // The poll a shared link opened (it sits on top, labelled).
  const [sharedId, setSharedId] = useState<string | null>(null);
  // Polls already voted on when the feed loaded (they sit at the end, under a label).
  const [votedBefore, setVotedBefore] = useState<Set<string>>(new Set(savedTab?.votedBefore ?? []));
  // Polls posted since this feed loaded ("New polls" pill).
  const [freshPolls, setFreshPolls] = useState(false);
  // A shared link whose poll is gone (deleted) or never existed.
  const [missingShared, setMissingShared] = useState(false);
  // Scrolled down: the logo row slides away, the tabs stay as a slim bar.
  const [slim, setSlim] = useState(false);
  const [hidePx, setHidePx] = useState(0);
  const [topHeight, setTopHeight] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const topRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLElement>(null);
  const tabsBarRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const ptrRef = useRef<HTMLDivElement>(null);
  const loadToken = useRef(0);
  const loadingMoreRef = useRef(false);
  // Scroll to this once the list has rendered (coming back, or switching back to a tab).
  const restoreY = useRef<number | null>(savedTab ? savedTab.scrollY : null);
  // Items let go from the top: scroll up by their height once they're gone.
  const shiftBy = useRef(0);
  // Opened from last visit's copy: who it belonged to, and whether they've started using it.
  const userId = useRef<string | null | undefined>(undefined);
  const fromSnap = useRef(false);
  const touched = useRef(false);
  const waitingFresh = useRef<{ list: Poll[]; hasMore: boolean; votedBefore: Set<string> } | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    return onUserChange((user) => {
      setSignedIn(isSignedIn(user));
      const first = userId.current === undefined;
      userId.current = user?.id ?? null;
      // Opening the app: show last visit's feed straight away while the fresh one loads.
      if (first && !saved && !initialPollId && tab === "trending" && !pollsRef.current) {
        const snap = snapFromLastVisit(userId.current);
        if (snap) {
          fromSnap.current = true;
          setPolls((cur) => cur ?? snap);
        }
      }
    });
    // Runs once: the first answer is about who opened the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Photos of my snaps that have disappeared: delete them (at most once a day).
  useEffect(() => {
    if (signedIn) cleanUpSnapPhotos().catch(() => {});
  }, [signedIn]);

  useEffect(() => {
    // Reads localStorage, so it can only run after hydration.
    setWaiting(signedIn === false ? guestPicks().length : 0);
    let until = 0;
    try {
      until = Number(localStorage.getItem(GUEST_BAR_HIDDEN_KEY) ?? 0);
    } catch {
      // Show it.
    }
    setGuestBarHidden(until > Date.now());
  }, [signedIn]);

  const hideGuestBar = useCallback(() => {
    try {
      localStorage.setItem(GUEST_BAR_HIDDEN_KEY, String(Date.now() + 864e5));
    } catch {
      // Hidden for this visit only.
    }
    setGuestBarHidden(true);
  }, []);

  useEffect(() => {
    if (!guestToast) return;
    const t = window.setTimeout(() => setGuestToast(false), 6000);
    return () => window.clearTimeout(t);
  }, [guestToast]);

  /** Loads a tab from the top. `quiet`: keep showing what's there until the new list arrives. */
  const load = useCallback(
    async (which: FeedTab, quiet = false) => {
      const token = ++loadToken.current;
      // A shared link (?poll=…) puts that poll on top, even if it has closed.
      const url = new URL(window.location.href);
      const shared = initialPollId ?? url.searchParams.get("poll");
      const justPosted = !!shared && url.searchParams.has("created");
      // Opened from a list that already had this poll: keep showing it while the rest loads.
      if (!quiet) setPolls((cur) => (shared && cur?.length === 1 && cur[0].id === shared ? cur : fromSnap.current ? cur : null));
      setFailed(false);
      try {
        // The shared poll and the feed load side by side.
        const sharedReq = shared ? fetchPoll(shared).catch(() => null) : null;
        const list = await fetchFeed(which);
        if (shared) {
          const at = list.findIndex((p) => p.id === shared);
          const sharedPoll = at >= 0 ? list.splice(at, 1)[0] : await sharedReq;
          if (sharedPoll) list.unshift(sharedPoll);
          else setMissingShared(true);
          setSharedId(sharedPoll ? shared : null);
          // A link-only poll you've opened shows in your feed from now on.
          if (sharedPoll?.visibility === "link" && !sharedPoll.isMine) recordOpen(shared).catch(() => {});
        }
        // From a "new comments" notification: open that poll's comments.
        if (shared && url.searchParams.has("comments")) {
          setCommentsFor(shared);
          url.searchParams.delete("comments");
          window.history.replaceState(window.history.state, "", url);
        }
        if (shared && (url.searchParams.has("voted") || url.searchParams.has("created"))) {
          if (url.searchParams.has("voted")) setCelebrateId(shared);
          if (url.searchParams.has("created")) {
            setCreatedId(shared);
            showTip("leaders");
            warmShareCard(shared); // a new poll is about to be shared
          }
          url.searchParams.delete("voted"); // no replay on reload
          url.searchParams.delete("created");
          window.history.replaceState(window.history.state, "", url);
        }
        if (token !== loadToken.current) return;
        const voted = new Set(list.filter((p) => p.myOptionId && p.id !== shared).map((p) => p.id));
        const more = list.length >= FEED_PAGE_SIZE;
        if (which === "trending" && !shared) saveSnap(userId.current ?? null, list);
        // Opened from last visit's copy and already reading or voting: don't swap the list
        // under their thumb. The "New polls" pill brings the fresh one.
        if (fromSnap.current && (touched.current || window.scrollY > 40)) {
          fromSnap.current = false;
          waitingFresh.current = { list, hasMore: more, votedBefore: voted };
          setFreshPolls(true);
          return;
        }
        fromSnap.current = false;
        propsAdded.current = false;
        setFreshPolls(false);
        setVotedBefore(voted);
        setHasMore(more);
        setPolls(list);
        // Just posted: open the share sheet once the card is in, so it goes to the group chat in one tap.
        if (justPosted && list[0]?.id === shared) window.setTimeout(() => setSharing((s) => s ?? list[0]), 700);
      } catch (e) {
        console.error(e);
        if (token === loadToken.current && !fromSnap.current) setFailed(true);
      }
    },
    [initialPollId],
  );

  // Offline: say so, and load again by itself once the connection is back.
  useEffect(() => {
    if (!failed) return;
    setOffline(!navigator.onLine);
    const back = () => load(tab);
    const gone = () => setOffline(true);
    window.addEventListener("online", back);
    window.addEventListener("offline", gone);
    return () => {
      window.removeEventListener("online", back);
      window.removeEventListener("offline", gone);
    };
  }, [failed, tab, load]);

  // First load (unless the list came back with us from another screen).
  useEffect(() => {
    if (savedTab) return;
    load(tab); // fetching on mount is exactly what this effect is for
    // Mount only: tab switches load in switchTab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Remembers this tab's list and scroll position (for switching back, and coming back to the feed). */
  const keepTab = useCallback(() => {
    const list = pollsRef.current;
    if (!list || initialPollId) return;
    tabsRef.current[tab] = { polls: list, hasMore, votedBefore: [...votedBefore], scrollY: window.scrollY, at: Date.now() };
    remember<FeedMemory>(FEED_CACHE, { tab, tabs: tabsRef.current });
  }, [tab, hasMore, votedBefore, initialPollId]);

  useEffect(() => {
    keepTab();
  }, [polls, keepTab]);
  useEffect(() => {
    let t = 0;
    const onScroll = () => {
      window.clearTimeout(t);
      t = window.setTimeout(keepTab, 200);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(t);
    };
  }, [keepTab]);

  const switchTab = useCallback(
    (next: FeedTab) => {
      if (next === tab) {
        // Tapping the tab you're on: back to the top.
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      keepTab();
      const kept = tabsRef.current[next];
      setTab(next);
      setFreshPolls(false);
      waitingFresh.current = null;
      fromSnap.current = false;
      if (kept && Date.now() - kept.at < TAB_MAX_AGE) {
        // Each tab keeps its place.
        loadToken.current++;
        propsAdded.current = true;
        setPolls(kept.polls);
        setHasMore(kept.hasMore);
        setVotedBefore(new Set(kept.votedBefore));
        restoreY.current = kept.scrollY;
        return;
      }
      propsAdded.current = false;
      restoreY.current = 0;
      load(next);
    },
    [tab, keepTab, load],
  );

  // New and Friends are a step away from For you: the phone's back button returns to
  // For you (instead of closing the app), and tapping For you takes that step back.
  const backToForYou = useBackClose(tab !== "trending", () => switchTab("trending"));

  // Put the scroll position back once the restored list has rendered. Coming back from another
  // screen, Next.js scrolls the new page to the top right after this, so it's done again once
  // that has happened.
  useLayoutEffect(() => {
    if (restoreY.current === null || !polls) return;
    const y = restoreY.current;
    restoreY.current = null;
    window.scrollTo(0, y);
    let tries = 0;
    let frame = requestAnimationFrame(function again() {
      if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
      if (++tries < 3) frame = requestAnimationFrame(again);
    });
    return () => cancelAnimationFrame(frame);
  }, [polls]);

  // After letting the oldest items go, stay exactly where you were.
  useLayoutEffect(() => {
    if (!shiftBy.current) return;
    window.scrollBy(0, -shiftBy.current);
    shiftBy.current = 0;
  }, [polls]);

  const feedReady = !!polls;

  // Props: a few polls in, a question about your friends (For you only, signed in).
  useEffect(() => {
    if (!feedReady || !signedIn || tab !== "trending" || propsAdded.current || initialPollId) return;
    propsAdded.current = true;
    const token = loadToken.current;
    propsState()
      .then((st) => {
        if (token !== loadToken.current) return;
        let slots: number[] = [];
        if (st.state === "ready") slots = [3, 8].slice(0, Math.min(2, st.left ?? 0));
        else if (st.state === "locked" && !shownToday(PROPS_LOCKED_KEY)) {
          slots = [5];
          markShownToday(PROPS_LOCKED_KEY);
        }
        if (!slots.length) return;
        setPolls((list) => {
          if (!list) return list;
          const next = [...list];
          slots.forEach((at, n) => next.splice(Math.min(at + n, next.length), 0, propsSlot(n)));
          return next;
        });
      })
      .catch(() => {});
  }, [feedReady, signedIn, tab, initialPollId]);

  // Once the feed is in, get Profile ready in the background.
  useEffect(() => {
    if (!feedReady || !signedIn) return;
    warmProfile();
    warmTabs();
  }, [feedReady, signedIn]);

  // Load the next page well before the end, so scrolling never meets a spinner.
  const loadMore = useCallback(() => {
    const list = pollsRef.current;
    if (!list || !hasMore || loadingMoreRef.current) return;
    // The shared poll sits on top without a cursor; page from the last list poll.
    const after = [...list].reverse().find((p) => p.cursor)?.cursor;
    if (!after) return;
    const token = loadToken.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    fetchFeed(tab, after)
      .then((more) => {
        if (token !== loadToken.current) return;
        const cur = pollsRef.current ?? [];
        const seen = new Set(cur.map((p) => p.id));
        const fresh = more.filter((p) => !seen.has(p.id));
        // A long session: let the oldest items above the screen go, keeping the place exactly.
        let drop = 0;
        if (cur.length + fresh.length > MAX_ITEMS) {
          const items = listRef.current?.querySelectorAll<HTMLElement>("[data-feed-item]") ?? [];
          const n = cur.length + fresh.length - KEEP_ITEMS;
          const cut = items[n];
          if (cut && cut.getBoundingClientRect().top < 0 && items.length === cur.length) {
            drop = n;
            shiftBy.current = cut.offsetTop - items[0].offsetTop;
          }
        }
        setPolls([...cur.slice(drop), ...fresh]);
        setHasMore(more.length >= FEED_PAGE_SIZE);
      })
      .catch((e) => console.error(e))
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [hasMore, tab]);

  useEffect(() => {
    const el = endRef.current;
    if (!el || !feedReady || !hasMore) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && loadMore(), { rootMargin: `0px 0px ${LOAD_AHEAD_PX}px 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [feedReady, hasMore, loadMore, polls?.length]);

  const onVoted = useCallback((pollId: string, r: VoteResult) => {
    touched.current = true;
    store(HOW_IT_WORKS_KEY);
    announceVote();
    if (signedInRef.current === false) {
      setWaiting(guestPicks().length);
      // A guest's first vote: say once what that means.
      if (!stored(GUEST_TOAST_KEY)) {
        store(GUEST_TOAST_KEY);
        setGuestToast(true);
      }
      // A guest's 3rd vote: ask them to sign in so their votes count (once).
      if (guestPicks().length >= SAVE_VOTES_AFTER && !stored(SAVE_ASKED_KEY)) {
        store(SAVE_ASKED_KEY);
        window.setTimeout(() => setSheet((s) => s ?? "save"), 1800);
      }
    } else if (countVoteForNudge()) {
      // After the 3rd vote here, once a week at most: offer the Home Screen.
      window.setTimeout(() => setInstallNudge(true), 1800);
    }
    tipsAfterVote((pollsRef.current?.find((p) => p.id === pollId)?.commentCount ?? 0) > 0, pollId);
    setPolls((list) =>
      list?.map((p) =>
        p.id === pollId
          ? { ...p, myOptionId: r.myOptionId, voteCount: r.voteCount, options: r.options, question: r.question || p.question }
          : p,
      ) ?? null,
    );
  }, []);

  const onRefresh = useCallback((fresh: Poll) => {
    setPolls((list) => list?.map((p) => (p.id === fresh.id ? fresh : p)) ?? null);
  }, []);

  // Live numbers for the cards on screen, in one request every few seconds.
  useLiveCounts((rows) => setPolls((list) => (list ? mergeLive(list, rows) : list)));

  // Is there a poll newer than anything in the loaded feed?
  useLiveInterval(
    async () => {
      if (!polls || freshPolls) return;
      try {
        const [newest] = await fetchFeed("new", undefined, 1);
        const newestLoaded = polls.reduce((m, p) => (p.createdAt > m ? p.createdAt : m), "");
        if (newest && newest.createdAt > newestLoaded && !polls.some((p) => p.id === newest.id)) setFreshPolls(true);
      } catch {
        // Try again next time.
      }
    },
    NEW_POLLS_CHECK_MS,
    !!polls,
  );

  /** Back to the top with the newest polls (the pill, the Feed button, pull to refresh). */
  const refresh = useCallback(async () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    const waitingList = waitingFresh.current;
    if (waitingList) {
      waitingFresh.current = null;
      propsAdded.current = false;
      setFreshPolls(false);
      setVotedBefore(waitingList.votedBefore);
      setHasMore(waitingList.hasMore);
      setPolls(waitingList.list);
      return;
    }
    propsAdded.current = false;
    await load(tab, true);
  }, [load, tab]);

  useEffect(() => {
    const top = () => (window.scrollY > 0 || !freshPolls ? window.scrollTo({ top: 0, behavior: "smooth" }) : refresh());
    window.addEventListener(FEED_TOP, top);
    return () => window.removeEventListener(FEED_TOP, top);
  }, [freshPolls, refresh]);

  // The slim bar: how far the header moves up so only the tabs stay (everything above them).
  useLayoutEffect(() => {
    const topEl = topRef.current;
    const head = headRef.current;
    const bar = tabsBarRef.current;
    if (!topEl || !head || !bar) return;
    const measure = () => {
      // The status-bar area above the header stays covered.
      const safeTop = Math.max(0, parseFloat(getComputedStyle(head).paddingTop) - 14);
      setHidePx(Math.max(0, bar.offsetTop - safeTop));
      setTopHeight(topEl.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(topEl);
    return () => ro.disconnect();
  }, []);

  // Scrolling down hides the logo row; any scroll up brings it back. The bottom bar dims while
  // you scroll down. Read once per frame, so it costs nothing on cheap phones.
  useEffect(() => {
    let lastY = window.scrollY;
    let frame = 0;
    let undim = 0;
    const root = document.documentElement;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const dy = y - lastY;
        if (y <= hidePx + 8) {
          setSlim(false);
          lastY = y;
        } else if (dy > 6) {
          setSlim(true);
          root.classList.add("feed-scrolling");
          window.clearTimeout(undim);
          undim = window.setTimeout(() => root.classList.remove("feed-scrolling"), 600);
          lastY = y;
        } else if (dy < -6) {
          setSlim(false);
          root.classList.remove("feed-scrolling");
          lastY = y;
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      window.clearTimeout(undim);
      root.classList.remove("feed-scrolling");
    };
  }, [hidePx]);

  // Pull to refresh: at the very top, pull down and let go. The list follows the finger
  // (moved directly, no re-render per frame) and the eyes spin while it loads.
  const live = useRef({ sheetOpen: false, refresh, refreshing });
  useEffect(() => {
    live.current = { sheetOpen: !!sheet || !!sharing, refresh, refreshing };
  });
  useEffect(() => {
    let start: { x: number; y: number } | null = null;
    let pull = 0;
    const list = () => listRef.current;
    const show = (d: number, animate: boolean) => {
      const l = list();
      const ptr = ptrRef.current;
      const t = animate ? "transform 0.25s cubic-bezier(0.2, 0.9, 0.2, 1)" : "none";
      if (l) {
        l.style.transition = t;
        l.style.transform = d ? `translateY(${d}px)` : "";
      }
      if (ptr) {
        ptr.style.transition = `${t}, opacity 0.2s`;
        ptr.style.transform = `translateY(${d - 44}px) rotate(${d * 4}deg)`;
        ptr.style.opacity = d ? String(Math.min(1, d / PULL_TO_REFRESH)) : "0";
      }
    };
    const onStart = (e: TouchEvent) => {
      // Never from inside a sheet or menu: those scroll on their own.
      const inLayer = (e.target as Element | null)?.closest?.(".sheet-layer, .snap-menu, .tip");
      start = window.scrollY <= 0 && e.touches.length === 1 && !inLayer && !live.current.sheetOpen && !live.current.refreshing
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
        : null;
      pull = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || window.scrollY > 0) {
        if (pull) show(0, true);
        start = pull ? start : null;
        pull = 0;
        return;
      }
      e.preventDefault();
      pull = Math.min(dy * 0.5, 110);
      show(pull, false);
    };
    const onEnd = async () => {
      if (!start) return;
      start = null;
      if (pull < PULL_TO_REFRESH) {
        pull = 0;
        show(0, true);
        return;
      }
      pull = 0;
      show(PULL_TO_REFRESH, true);
      ptrRef.current?.classList.add("ptr-spin");
      setRefreshing(true);
      try {
        await live.current.refresh();
      } finally {
        setRefreshing(false);
        ptrRef.current?.classList.remove("ptr-spin");
        show(0, true);
      }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  // Keyboard: j / k jump to the next / previous poll (arrows and space scroll as usual).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (sheet || sharing || e.metaKey || e.ctrlKey || e.altKey || (e.key !== "j" && e.key !== "k")) return;
      if ((e.target as HTMLElement)?.closest("input, textarea, [contenteditable]")) return;
      const items = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-feed-item]") ?? [])];
      const line = (tabsBarRef.current?.getBoundingClientRect().bottom ?? 0) + 4;
      const tops = items.map((el) => el.getBoundingClientRect().top);
      const target = e.key === "j" ? tops.find((t) => t > line + 4) : [...tops].reverse().find((t) => t < line - 4);
      if (target !== undefined) window.scrollBy({ top: target - line, behavior: "smooth" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, sharing]);

  const onNeedSignIn = useCallback(
    (pollId: string, optionId: string) => {
      const p = polls?.find((x) => x.id === pollId);
      const i = p?.options.findIndex((o) => o.id === optionId) ?? -1;
      if (!p || i < 0) return;
      savePendingVote({ pollId, optionId });
      setSheet({ text: p.options[i].text, color: ANSWER_COLORS[i] });
    },
    [polls],
  );

  const closeSheet = useCallback(() => {
    takePendingVote();
    setSheet(null);
  }, []);

  function tagFor(p: Poll, i: number) {
    if (tab === "circle") return p.visibility === "circle" ? "Friends only" : "From a friend";
    if (p.featuredToday) return "Poll of the Day";
    if (votedBefore.has(p.id)) return "You voted";
    if (p.kind === "snap") return "Quick snap";
    if (p.kind === "hot_take") return "Hot take";
    if (p.kind === "mystery") return "Mystery poll";
    if (tab === "new") return "New";
    const before = polls?.slice(0, i).filter((x) => !isPropsSlot(x) && !x.featuredToday && x.id !== sharedId).length ?? i;
    return `Trending #${before + 1}`;
  }

  const removePoll = useCallback((id: string) => setPolls((list) => list?.filter((p) => p.id !== id) ?? null), []);

  return (
    <div className="screen screen-feed">
      <div ref={topRef} className={`feed-top${slim ? " slim" : ""}`} style={{ "--hide": `${hidePx}px` } as CSSProperties}>
        <header ref={headRef} className="app-header">
          <Link href="/" className="brand" aria-label="Eithr home">
            <LogoMark />
            <Wordmark />
          </Link>
          <div className="header-actions">
            <StreakChip />
            <Bell />
          </div>
        </header>

        {waiting > 0 && !guestBarHidden && (
          <div className="guest-bar" role="status">
            <span aria-hidden="true">🕒</span>
            <p>
              <strong>
                {waiting} {waiting === 1 ? "vote" : "votes"}
              </strong>{" "}
              not counted yet
            </p>
            <button type="button" className="guest-bar-btn press" onClick={() => setSheet("save")}>
              Count {waiting === 1 ? "it" : "them"}
            </button>
            <button type="button" className="guest-bar-close" aria-label="Hide for now" onClick={hideGuestBar}>
              ×
            </button>
          </div>
        )}

        {!isSupabaseConfigured && (
          <p className="demo-banner">Demo mode: sample polls, votes aren&apos;t saved. Add Supabase keys to go live.</p>
        )}

        {missingShared && (
          <p className="demo-banner" role="status">
            That poll isn&apos;t available anymore. Its creator may have deleted it. Here&apos;s what&apos;s hot instead.
          </p>
        )}

        <div ref={tabsBarRef} role="tablist" aria-label="Feed" className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              className="tab press"
              data-tip={t.id === "circle" ? "circle" : undefined}
              onClick={() => (t.id === "trending" && tab !== "trending" ? backToForYou() : switchTab(t.id))}
            >
              {t.label}
            </button>
          ))}
          {/* On the slim bar, the bell comes along so a new notification is never missed. */}
          <span className="tabs-bell">
            <Bell mini hidden={!slim} />
          </span>
        </div>

        {freshPolls && (
          <button type="button" className="fresh-pill press" onClick={refresh}>
            <span className="live-dot" aria-hidden="true" />
            New polls ↑
          </button>
        )}
      </div>

      <div ref={ptrRef} className="ptr" aria-hidden="true" style={{ "--ptr-top": `${topHeight}px` } as CSSProperties}>
        <LogoMark />
      </div>

      <main ref={listRef} className="feed-list" role="feed" aria-busy={!polls || loadingMore} aria-label="Polls">
        {failed ? (
          <section className="poll-card empty-card">
            {offline ? (
              <>
                <span className="chip chip-white">📡 Offline</span>
                <h1 className="poll-question">You&apos;re offline.</h1>
                <p className="poll-foot-note">Polls load by themselves as soon as you&apos;re back online.</p>
              </>
            ) : (
              <h1 className="poll-question">Couldn&apos;t load polls.</h1>
            )}
            <button type="button" className="btn btn-coral press" onClick={() => load(tab)}>
              Try again
            </button>
          </section>
        ) : !polls ? (
          [0, 1].map((n) => <GhostCard key={n} />)
        ) : tab === "circle" && polls.length === 0 ? (
          <section className="poll-card empty-card">
            <span className="chip chip-circle">Friends</span>
            <h1 className="poll-question">Nothing from your friends yet.</h1>
            <p className="poll-foot-note">Add friends and their polls land here, including the ones they share only with friends.</p>
            <div className="empty-actions">
              <Link href="/friends" className="btn btn-coral press">
                Add friends
              </Link>
            </div>
          </section>
        ) : (
          <>
            {polls.map((poll, i) => {
              const firstVoted = votedBefore.has(poll.id) && (i === 0 || !votedBefore.has(polls[i - 1].id));
              return (
                <Fragment key={poll.id}>
                  {i === 0 && poll.id === sharedId && <p className="feed-label">Shared with you</p>}
                  {i === 1 && polls[0].id === sharedId && <p className="feed-divider">More polls</p>}
                  {firstVoted && <p className="feed-divider">Polls you&apos;ve voted on</p>}
                  <div className="feed-item" data-feed-item aria-posinset={i + 1} aria-setsize={hasMore ? -1 : polls.length}>
                    {isPropsSlot(poll) ? (
                      <PropsCard />
                    ) : (
                      <PollCard
                        poll={poll}
                        tag={tagFor(poll, i)}
                        signedIn={signedIn}
                        celebrate={poll.id === celebrateId}
                        justCreated={poll.id === createdId}
                        onVoted={onVoted}
                        onRefresh={onRefresh}
                        onNeedSignIn={onNeedSignIn}
                        onSaveVotes={() => setSheet("save")}
                        onShare={() => setSharing(poll)}
                        onReported={removePoll}
                        onDeleted={removePoll}
                        openComments={poll.id === commentsFor}
                      />
                    )}
                  </div>
                </Fragment>
              );
            })}
            {loadingMore && [0, 1].map((n) => <GhostCard key={`more-${n}`} />)}
            {!hasMore && !loadingMore && (
              <section className="poll-card empty-card feed-end">
                <span className="chip chip-mint">All caught up</span>
                <h2 className="poll-question">That&apos;s every poll for now.</h2>
                <p className="poll-foot-note">New ones drop every day.</p>
                <div className="your-turn">
                  <strong>Your turn</strong>
                  <div className="your-turn-tiles">
                    <Link href="/snap" className="your-turn-tile your-turn-snap press">
                      <span aria-hidden="true">📸</span>
                      Snap one
                    </Link>
                    <Link href="/create" className="your-turn-tile press">
                      <span aria-hidden="true">✍️</span>
                      Type a poll
                    </Link>
                  </div>
                </div>
                {polls.length > 2 && (
                  <div className="empty-actions">
                    <button type="button" className="btn btn-white press" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
                      Back to top ↑
                    </button>
                  </div>
                )}
              </section>
            )}
          </>
        )}
        <div ref={endRef} className="feed-end-marker" aria-hidden="true" />
      </main>

      <BottomNav current="feed" />

      {guestToast && !sheet && (
        <p className="guest-toast" role="status">
          ✓ <strong>Voted as a guest.</strong> You see results right away. Sign in anytime and your votes join the totals.
        </p>
      )}
      {sheet && <SignInSheet pick={sheet === "save" ? undefined : sheet} onClose={closeSheet} />}
      {sharing && <ShareSheet poll={sharing} onClose={() => setSharing(null)} />}
      <HowItWorks />
      {installNudge && !sheet && !sharing && <InstallSheet reason="nudge" onClose={() => setInstallNudge(false)} />}
    </div>
  );
}

/** A grey card outline while polls load. */
function GhostCard() {
  return (
    <section className="poll-card ghost-card" aria-hidden="true">
      <div className="skeleton skeleton-chip" />
      <div className="skeleton skeleton-title" />
      {[0, 1].map((n) => (
        <div key={n} className="skeleton skeleton-answer" />
      ))}
    </section>
  );
}
