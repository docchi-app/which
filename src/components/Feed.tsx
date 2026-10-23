"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { canVote as userCanVote, onUserChange, savePendingVote, takePendingVote } from "@/lib/auth";
import { FEED_PAGE_SIZE, fetchFeed, fetchPoll } from "@/lib/polls";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useLiveInterval } from "@/lib/useLiveInterval";
import type { FeedTab, Poll, VoteResult } from "@/lib/types";
import { LogoMark, Wordmark } from "./Logo";
import { ANSWER_COLORS, PollCard } from "./PollCard";
import { SignInSheet, type SheetPick } from "./SignInSheet";
import { BottomNav } from "./BottomNav";
import { TrophyIcon } from "./icons";

const TABS: { id: FeedTab; label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
];

// How often to look for polls posted since the feed loaded.
const NEW_POLLS_CHECK_MS = 45_000;

// A drag this far (px), or a flick this fast (px/ms), moves to the next card.
const SWIPE_DISTANCE = 90;
const SWIPE_VELOCITY = 0.5;

export function Feed() {
  const [tab, setTab] = useState<FeedTab>("trending");
  const [polls, setPolls] = useState<Poll[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const [canVote, setCanVote] = useState<boolean | null>(isSupabaseConfigured ? null : true);
  const [sheet, setSheet] = useState<SheetPick | null>(null);
  // Poll whose vote was just cast on the way back from Google sign-in.
  const [celebrateId, setCelebrateId] = useState<string | null>(null);
  // Poll the viewer just posted (arrives from /create with ?created=1).
  const [createdId, setCreatedId] = useState<string | null>(null);
  // Polls already voted on when the feed loaded (they sit at the end).
  const [votedBefore, setVotedBefore] = useState<Set<string>>(new Set());
  // Which way the last move went, so the next card comes in from that side.
  const [dir, setDir] = useState<"next" | "prev">("next");
  // Polls posted since this feed loaded ("New polls" pill).
  const [freshPolls, setFreshPolls] = useState(false);

  const stackRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const loadToken = useRef(0);
  const loadingMore = useRef(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    return onUserChange((user) => setCanVote(userCanVote(user)));
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
      const shared = url.searchParams.get("poll");
      if (shared) {
        const at = list.findIndex((p) => p.id === shared);
        const sharedPoll = at >= 0 ? list.splice(at, 1)[0] : await fetchPoll(shared).catch(() => null);
        if (sharedPoll) list.unshift(sharedPoll);
      }
      if (shared && (url.searchParams.has("voted") || url.searchParams.has("created"))) {
        if (url.searchParams.has("voted")) setCelebrateId(shared);
        if (url.searchParams.has("created")) setCreatedId(shared);
        url.searchParams.delete("voted"); // no replay on reload
        url.searchParams.delete("created");
        window.history.replaceState(window.history.state, "", url);
      }
      if (token !== loadToken.current) return;
      setVotedBefore(new Set(list.filter((p) => p.myOptionId && p.id !== shared).map((p) => p.id)));
      setHasMore(list.length >= FEED_PAGE_SIZE);
      setPolls(list);
    } catch (e) {
      console.error(e);
      if (token === loadToken.current) setFailed(true);
    }
  }, []);

  useEffect(() => {
    // Fetching on mount and on tab change is exactly what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(tab);
  }, [tab, load]);

  // Load the next page a few cards before the end.
  useEffect(() => {
    if (!polls || !hasMore || loadingMore.current || index < polls.length - 3) return;
    loadingMore.current = true;
    const token = loadToken.current;
    fetchFeed(tab, polls.length)
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
    setPolls((list) =>
      list?.map((p) =>
        p.id === pollId ? { ...p, myOptionId: r.myOptionId, voteCount: r.voteCount, options: r.options } : p,
      ) ?? null,
    );
  }, []);

  const onRefresh = useCallback((fresh: Poll) => {
    setPolls((list) => list?.map((p) => (p.id === fresh.id ? fresh : p)) ?? null);
  }, []);

  // Is there a poll newer than anything in the loaded feed?
  useLiveInterval(
    async () => {
      if (!polls || freshPolls) return;
      try {
        const [newest] = await fetchFeed("new", 0, 1);
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
    live.current = { go, canNext: !!polls && index < total, canPrev: index > 0, sheetOpen: !!sheet };
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
      if (sheet || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowDown" || e.key === "j") go(1);
      else if (e.key === "ArrowUp" || e.key === "k") go(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, sheet]);

  const poll = polls?.[index];

  function tagFor(p: Poll, i: number) {
    if (p.featuredToday) return "Poll of the Day";
    if (votedBefore.has(p.id)) return "You voted";
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
        <Link href="/leaders" aria-label="Leaderboard" className="icon-btn press">
          <TrophyIcon size={22} className="wiggle" />
        </Link>
      </header>

      {!isSupabaseConfigured && (
        <p className="demo-banner">Demo mode: sample polls, votes aren&apos;t saved. Add Supabase keys to go live.</p>
      )}

      <div role="tablist" aria-label="Feed" className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            className="tab press"
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
                <h1 className="poll-question">Couldn&apos;t load polls.</h1>
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
                canVote={canVote}
                celebrate={poll.id === celebrateId}
                justCreated={poll.id === createdId}
                onVoted={onVoted}
                onRefresh={onRefresh}
                onNeedSignIn={onNeedSignIn}
                onNext={() => go(1)}
              />
            ) : (
              <section className="poll-card empty-card">
                <span className="chip chip-mint">All caught up</span>
                <h1 className="poll-question">That&apos;s every poll for now.</h1>
                <p className="poll-foot-note">New ones drop every day. Or make your own.</p>
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
                  <Link href="/create" className="btn btn-coral press">
                    Make a poll
                  </Link>
                </div>
              </section>
            )}
          </div>
          {polls && index === 0 && polls.length > 1 && <p className="swipe-hint">Swipe up for the next one</p>}
        </div>
      </main>

      <BottomNav current="feed" />

      {sheet && <SignInSheet pick={sheet} onClose={closeSheet} />}
    </div>
  );
}
