"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { guestPicks, isSignedIn, onUserChange, savePendingVote, takePendingVote } from "@/lib/auth";
import { countVoteForNudge } from "@/lib/install";
import { cleanUpSnapPhotos } from "@/lib/snap";
import { announceVote } from "@/lib/streak";
import { warmShareCard } from "@/lib/share";
import { showTip, tipsAfterVote } from "@/lib/tips";
import { FEED_PAGE_SIZE, fetchFeed, fetchPoll, recordOpen } from "@/lib/polls";
import { isSupabaseConfigured } from "@/lib/supabase";
import { recall, remember } from "@/lib/screen-cache";
import { warmProfile } from "@/lib/warm";
import { useLiveInterval } from "@/lib/useLiveInterval";
import type { FeedTab, Poll, VoteResult } from "@/lib/types";
import { LogoMark, Wordmark } from "./Logo";
import { ANSWER_COLORS, PollCard } from "./PollCard";
import { SignInSheet, type SheetPick } from "./SignInSheet";
import { ShareSheet } from "./ShareSheet";
import { BottomNav } from "./BottomNav";
import { InstallSheet } from "./InstallSheet";
import { Bell } from "./Bell";
import { StreakChip } from "./StreakChip";

const TABS: { id: FeedTab; label: string }[] = [
  { id: "trending", label: "For you" },
  { id: "new", label: "New" },
  { id: "circle", label: "Friends" },
];

// How often to look for polls posted since the feed loaded.
const NEW_POLLS_CHECK_MS = 45_000;

// A guest's 3rd vote is when we ask them to sign in so their votes count.
const SAVE_VOTES_AFTER = 3;
const SAVE_ASKED_KEY = "docchi.saveVotesAsked";
const WELCOMED_KEY = "docchi.welcomed";
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

// A drag this far (px), or a flick this fast (px/ms), moves to the next card.
const SWIPE_DISTANCE = 90;
const SWIPE_VELOCITY = 0.5;

type FeedSnapshot = { tab: FeedTab; polls: Poll[]; index: number; hasMore: boolean; votedBefore: Set<string> };
const FEED_CACHE = "feed";

/** Where the feed was, unless this visit opens a particular poll (a shared link, or one just posted). */
function savedFeed(initialPollId?: string): FeedSnapshot | null {
  if (initialPollId || typeof window === "undefined" || new URLSearchParams(window.location.search).has("poll")) return null;
  // Older than this, start fresh: the feed has probably moved on.
  return recall<FeedSnapshot>(FEED_CACHE, 10 * 60_000) ?? null;
}

/** `initialPollId` opens the feed on that poll (a shared /p/<id> link). */
export function Feed({ initialPollId }: { initialPollId?: string } = {}) {
  // Coming back from another screen: carry on at the same card, no reload.
  const [saved] = useState(() => savedFeed(initialPollId));
  const skipLoad = useRef(!!saved);
  const [tab, setTab] = useState<FeedTab>(saved?.tab ?? "trending");
  const [polls, setPolls] = useState<Poll[] | null>(saved?.polls ?? null);
  // For callbacks that shouldn't change identity when the list does.
  const pollsRef = useRef(polls);
  useEffect(() => {
    pollsRef.current = polls;
  });
  const [hasMore, setHasMore] = useState(saved?.hasMore ?? false);
  const [index, setIndex] = useState(saved?.index ?? 0);
  const [failed, setFailed] = useState(false);
  const [offline, setOffline] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(isSupabaseConfigured ? null : true);
  // A pick waiting for sign-in (guest voting is off), or "save": a guest asked to make their votes count.
  const [sheet, setSheet] = useState<SheetPick | "save" | null>(null);
  // First visit: a line saying what Docchi is, until dismissed or the first vote.
  const [welcome, setWelcome] = useState(false);
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
  // Polls already voted on when the feed loaded (they sit at the end).
  const [votedBefore, setVotedBefore] = useState<Set<string>>(saved?.votedBefore ?? new Set());
  // Which way the last move went, so the next card comes in from that side.
  const [dir, setDir] = useState<"next" | "prev">("next");
  // Polls posted since this feed loaded ("New polls" pill).
  const [freshPolls, setFreshPolls] = useState(false);
  // A shared link whose poll is gone (deleted) or never existed.
  const [missingShared, setMissingShared] = useState(false);

  const stackRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const loadToken = useRef(0);
  const loadingMore = useRef(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    return onUserChange((user) => setSignedIn(isSignedIn(user)));
  }, []);

  // Photos of my snaps that have disappeared: delete them (at most once a day).
  useEffect(() => {
    if (signedIn) cleanUpSnapPhotos().catch(() => {});
  }, [signedIn]);

  useEffect(() => {
    // Reads localStorage, so it can only run after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (signedIn === false && !stored(WELCOMED_KEY)) setWelcome(true);
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

  const dismissWelcome = useCallback(() => {
    store(WELCOMED_KEY);
    setWelcome(false);
  }, []);

  const load = useCallback(async (which: FeedTab) => {
    const token = ++loadToken.current;
    setPolls(null);
    setFailed(false);
    setFreshPolls(false);
    setIndex(0);
    try {
      const list = await fetchFeed(which);
      // A shared link (?poll=…) puts that poll on top, even if it has closed.
      const url = new URL(window.location.href);
      const shared = initialPollId ?? url.searchParams.get("poll");
      const justPosted = !!shared && url.searchParams.has("created");
      if (shared) {
        const at = list.findIndex((p) => p.id === shared);
        const sharedPoll = at >= 0 ? list.splice(at, 1)[0] : await fetchPoll(shared).catch(() => null);
        if (sharedPoll) list.unshift(sharedPoll);
        else setMissingShared(true);
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
      setVotedBefore(new Set(list.filter((p) => p.myOptionId && p.id !== shared).map((p) => p.id)));
      setHasMore(list.length >= FEED_PAGE_SIZE);
      setPolls(list);
      // Just posted: open the share sheet once the card is in, so it goes to the group chat in one tap.
      if (justPosted && list[0]?.id === shared) window.setTimeout(() => setSharing((s) => s ?? list[0]), 700);
    } catch (e) {
      console.error(e);
      if (token === loadToken.current) setFailed(true);
    }
  }, [initialPollId]);

  // Offline: say so, and load again by itself once the connection is back.
  useEffect(() => {
    if (!failed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  useEffect(() => {
    // Restored from the last visit: the cards are already here.
    if (skipLoad.current) {
      skipLoad.current = false;
      return;
    }
    // Fetching on mount and on tab change is exactly what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(tab);
  }, [tab, load]);

  // Once the feed is in, get Profile ready in the background.
  const feedReady = !!polls;
  useEffect(() => {
    if (feedReady && signedIn) warmProfile();
  }, [feedReady, signedIn]);

  // Remember where the feed is, for coming back from another screen.
  useEffect(() => {
    if (polls && !initialPollId) remember<FeedSnapshot>(FEED_CACHE, { tab, polls, index, hasMore, votedBefore });
  }, [tab, polls, index, hasMore, votedBefore, initialPollId]);

  // Load the next page a few cards before the end.
  useEffect(() => {
    if (!polls || !hasMore || loadingMore.current || index < polls.length - 3) return;
    const token = loadToken.current;
    // The shared poll sits on top without a cursor; page from the last list poll.
    const after = [...polls].reverse().find((p) => p.cursor)?.cursor;
    if (!after) return;
    loadingMore.current = true;
    fetchFeed(tab, after)
      .then((more) => {
        if (token !== loadToken.current) return;
        setPolls((list) => {
          if (!list) return list;
          const seen = new Set(list.map((p) => p.id));
          return [...list, ...more.filter((p) => !seen.has(p.id))];
        });
        setHasMore(more.length >= FEED_PAGE_SIZE);
      })
      .catch((e) => console.error(e))
      .finally(() => {
        loadingMore.current = false;
      });
  }, [index, polls, hasMore, tab]);

  const onVoted = useCallback((pollId: string, r: VoteResult) => {
    dismissWelcome();
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
    tipsAfterVote((pollsRef.current?.find((p) => p.id === pollId)?.commentCount ?? 0) > 0);
    setPolls((list) =>
      list?.map((p) =>
        p.id === pollId
          ? { ...p, myOptionId: r.myOptionId, voteCount: r.voteCount, options: r.options, question: r.question || p.question }
          : p,
      ) ?? null,
    );
  }, [dismissWelcome]);

  const onRefresh = useCallback((fresh: Poll) => {
    setPolls((list) => list?.map((p) => (p.id === fresh.id ? fresh : p)) ?? null);
  }, []);

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

  // index === polls.length is the "all caught up" card.
  const total = polls?.length ?? 0;
  const go = useCallback(
    (delta: 1 | -1) => {
      if (!polls) return;
      setDir(delta === 1 ? "next" : "prev");
      setIndex((i) => Math.min(Math.max(i + delta, 0), polls.length));
    },
    [polls],
  );

  // Latest values for the native touch handlers below.
  const live = useRef({ go, canNext: false, canPrev: false, sheetOpen: false });
  useEffect(() => {
    live.current = { go, canNext: !!polls && index < total, canPrev: index > 0, sheetOpen: !!sheet || !!sharing };
  });

  // A new card always starts from rest, wherever the last drag left the slot.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    card.style.transition = "none";
    card.style.transform = "";
    card.style.opacity = "";
  }, [index, tab]);

  // Swipe pager. The card follows the finger and flies off past the threshold.
  // A tall card scrolls inside itself first; only at its edge does a drag
  // become a swipe. The page itself never scrolls, so there's no pull-to-refresh.
  useEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    let g: { x: number; y: number; t: number; mode: "drag" | "native" | null; scroller: HTMLElement | null } | null =
      null;

    const setCard = (offset: number, transition: string) => {
      const card = cardRef.current;
      if (!card) return;
      card.style.transition = transition;
      card.style.transform = offset ? `translateY(${offset}px)` : "";
      card.style.opacity = offset ? String(1 - Math.min(Math.abs(offset) / 700, 0.35)) : "";
    };

    function start(e: TouchEvent) {
      if (e.touches.length !== 1 || live.current.sheetOpen) return void (g = null);
      const t = e.touches[0];
      const scroller = (e.target as Element).closest<HTMLElement>(".poll-card");
      g = { x: t.clientX, y: t.clientY, t: performance.now(), mode: null, scroller };
    }

    function move(e: TouchEvent) {
      if (!g) return;
      const t = e.touches[0];
      const dx = t.clientX - g.x;
      const dy = t.clientY - g.y;
      if (g.mode === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        const s = g.scroller;
        const canScroll = !!s && (dy < 0 ? s.scrollTop + s.clientHeight < s.scrollHeight - 1 : s.scrollTop > 0);
        g.mode = Math.abs(dx) > Math.abs(dy) || canScroll ? "native" : "drag";
      }
      if (g.mode !== "drag") return;
      e.preventDefault();
      const allowed = dy < 0 ? live.current.canNext : live.current.canPrev;
      setCard(allowed ? dy : dy * 0.25, "none"); // rubber-band at either end
    }

    function end(e: TouchEvent) {
      const gesture = g;
      g = null;
      if (!gesture || gesture.mode !== "drag") return;
      const dy = (e.changedTouches[0]?.clientY ?? gesture.y) - gesture.y;
      const speed = Math.abs(dy) / Math.max(performance.now() - gesture.t, 1);
      const delta = dy < 0 ? 1 : -1;
      const allowed = delta === 1 ? live.current.canNext : live.current.canPrev;
      if (allowed && (Math.abs(dy) > SWIPE_DISTANCE || speed > SWIPE_VELOCITY)) {
        const fly = (cardRef.current?.offsetHeight ?? 600) + 80;
        setCard(delta === 1 ? -fly : fly, "transform 0.18s ease-in, opacity 0.18s ease-in");
        window.setTimeout(() => live.current.go(delta), 170);
      } else {
        setCard(0, "transform 0.3s cubic-bezier(0.2, 0.9, 0.2, 1), opacity 0.3s");
      }
    }

    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, []);

  // Keyboard: ↓ / j for next, ↑ / k for previous.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (sheet || sharing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowDown" || e.key === "j") go(1);
      else if (e.key === "ArrowUp" || e.key === "k") go(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, sheet, sharing]);

  const poll = polls?.[index];

  function tagFor(p: Poll, i: number) {
    if (tab === "circle") return p.visibility === "circle" ? "Friends only" : "From a friend";
    if (p.featuredToday) return "Poll of the Day";
    if (votedBefore.has(p.id)) return "You voted";
    if (p.kind === "snap") return "Quick snap";
    if (p.kind === "hot_take") return "Hot take";
    if (p.kind === "mystery") return "Mystery poll";
    if (tab === "new") return "New";
    const rank = i + 1 - (polls?.[0]?.featuredToday ? 1 : 0);
    return `Trending #${rank}`;
  }

  return (
    <div className="screen screen-feed">
      <header className="app-header">
        <Link href="/" className="brand" aria-label="Docchi home">
          <LogoMark />
          <Wordmark />
        </Link>
        <div className="header-actions">
          <StreakChip />
          <Bell />
        </div>
      </header>

      {welcome && (
        <div className="welcome" role="note">
          <p>
            <strong>Vote on what everyone argues about.</strong> See where you land.
          </p>
          <button type="button" className="welcome-close" aria-label="Got it" onClick={dismissWelcome}>
            ×
          </button>
        </div>
      )}

      {waiting > 0 && !guestBarHidden && !welcome && (
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

      <div role="tablist" aria-label="Feed" className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            className="tab press"
            data-tip={t.id === "circle" ? "circle" : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        {freshPolls && (
          <button type="button" className="fresh-pill press" onClick={() => load(tab)}>
            <span className="live-dot" aria-hidden="true" />
            Fresh polls ↑
          </button>
        )}
      </div>

      <main className="stack" ref={stackRef}>
        <div className={`stack-deck enter-${dir}`}>
          <div className="stack-card stack-card-back" aria-hidden="true" />
          <div className="stack-card stack-card-mid" aria-hidden="true" />

          <div className="swipe-card" ref={cardRef}>
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
              <section className="poll-card empty-card" aria-busy="true">
                <div className="skeleton skeleton-chip" />
                <div className="skeleton skeleton-title" />
                {[0, 1, 2].map((n) => (
                  <div key={n} className="skeleton skeleton-answer" />
                ))}
              </section>
            ) : poll ? (
              <PollCard
                key={poll.id}
                poll={poll}
                tag={tagFor(poll, index)}
                signedIn={signedIn}
                celebrate={poll.id === celebrateId}
                justCreated={poll.id === createdId}
                onVoted={onVoted}
                onRefresh={onRefresh}
                onNeedSignIn={onNeedSignIn}
                onSaveVotes={() => setSheet("save")}
                onShare={() => setSharing(poll)}
                onNext={() => go(1)}
                onReported={(id) => setPolls((list) => list?.filter((p) => p.id !== id) ?? null)}
                onDeleted={(id) => setPolls((list) => list?.filter((p) => p.id !== id) ?? null)}
                openComments={poll.id === commentsFor}
              />
            ) : (
              tab === "circle" && polls.length === 0 ? (
                <section className="poll-card empty-card">
                  <span className="chip chip-circle">Friends</span>
                  <h1 className="poll-question">Nothing from your friends yet.</h1>
                  <p className="poll-foot-note">
                    Add friends and their polls land here, including the ones they share only with friends.
                  </p>
                  <div className="empty-actions">
                    <Link href="/friends" className="btn btn-coral press">
                      Add friends
                    </Link>
                  </div>
                </section>
              ) : (
              <section className="poll-card empty-card">
                <span className="chip chip-mint">All caught up</span>
                <h1 className="poll-question">That&apos;s every poll for now.</h1>
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
                <div className="empty-actions">
                  <button
                    type="button"
                    className="btn btn-white press"
                    onClick={() => {
                      setDir("prev");
                      setIndex(0);
                    }}
                  >
                    Start over
                  </button>
                </div>
              </section>
              )
            )}
          </div>
          {polls && index === 0 && polls.length > 1 && <p className="swipe-hint">Swipe up for the next one</p>}
        </div>
      </main>

      <BottomNav current="feed" />

      {guestToast && !sheet && (
        <p className="guest-toast" role="status">
          ✓ <strong>Voted as a guest.</strong> You see results right away. Sign in anytime and your votes join the totals.
        </p>
      )}
      {sheet && <SignInSheet pick={sheet === "save" ? undefined : sheet} onClose={closeSheet} />}
      {sharing && <ShareSheet poll={sharing} onClose={() => setSharing(null)} />}
      {installNudge && !sheet && !sharing && <InstallSheet reason="nudge" onClose={() => setInstallNudge(false)} />}
    </div>
  );
}
