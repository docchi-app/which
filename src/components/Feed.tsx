"use client";

import { useCallback, useEffect, useRef, useState, type TouchEvent } from "react";
import Link from "next/link";
import { savePendingVote, takePendingVote } from "@/lib/auth";
import { fetchFeed } from "@/lib/polls";
import { isSupabaseConfigured } from "@/lib/supabase";
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

export function Feed() {
  const [tab, setTab] = useState<FeedTab>("trending");
  const [polls, setPolls] = useState<Poll[] | null>(null);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const [sheet, setSheet] = useState<SheetPick | null>(null);
  // Poll whose vote was just cast on the way back from Google sign-in.
  const [celebrateId, setCelebrateId] = useState<string | null>(null);
  // Which way the last move went, so the next card comes in from that side.
  const [dir, setDir] = useState<"next" | "prev">("next");
  const touch = useRef<{ x: number; y: number; scrollY: number } | null>(null);

  const load = useCallback(async (which: FeedTab) => {
    setPolls(null);
    setFailed(false);
    setIndex(0);
    try {
      const list = await fetchFeed(which);
      // A shared link (?poll=…) puts that poll on top.
      const url = new URL(window.location.href);
      const shared = url.searchParams.get("poll");
      const at = shared ? list.findIndex((p) => p.id === shared) : -1;
      if (at > 0) list.unshift(...list.splice(at, 1));
      if (shared && url.searchParams.has("voted")) {
        setCelebrateId(shared);
        url.searchParams.delete("voted"); // no confetti replay on reload
        window.history.replaceState(window.history.state, "", url);
      }
      setPolls(list);
    } catch (e) {
      console.error(e);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    // Fetching on mount and on tab change is exactly what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(tab);
  }, [tab, load]);

  const onVoted = useCallback((pollId: string, r: VoteResult) => {
    setPolls((list) =>
      list?.map((p) =>
        p.id === pollId ? { ...p, myOptionId: r.myOptionId, voteCount: r.voteCount, options: r.options } : p,
      ) ?? null,
    );
  }, []);

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
  const go = useCallback(
    (delta: 1 | -1) => {
      if (!polls) return;
      setDir(delta === 1 ? "next" : "prev");
      setIndex((i) => Math.min(Math.max(i + delta, 0), polls.length));
    },
    [polls],
  );

  // Swipe up for the next poll, down for the previous one. On short screens
  // the page still scrolls first: a gesture that moved the page isn't a swipe.
  function onTouchStart(e: TouchEvent) {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, scrollY: window.scrollY };
  }
  function onTouchEnd(e: TouchEvent) {
    const start = touch.current;
    touch.current = null;
    if (!start || sheet) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dy) < 60 || Math.abs(dy) < Math.abs(dx) * 1.5) return;
    if (Math.abs(window.scrollY - start.scrollY) > 4) return;
    go(dy < 0 ? 1 : -1);
  }

  // Keyboard: ↓ / j for next, ↑ / k for previous (same scroll-edge rule).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (sheet || e.metaKey || e.ctrlKey || e.altKey) return;
      const doc = document.documentElement;
      const atBottom = window.scrollY + window.innerHeight >= doc.scrollHeight - 2;
      if ((e.key === "ArrowDown" && atBottom) || e.key === "j") go(1);
      else if ((e.key === "ArrowUp" && window.scrollY <= 0) || e.key === "k") go(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, sheet]);

  const poll = polls?.[index];

  function tagFor(p: Poll, i: number) {
    if (p.featuredToday) return "Poll of the Day";
    const rank = i + 1 - (polls?.[0]?.featuredToday ? 1 : 0);
    return tab === "trending" ? `Trending #${rank}` : "New";
  }

  return (
    <div className="screen">
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
      </div>

      <main className="stack" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className={`stack-deck enter-${dir}`}>
          <div className="stack-card stack-card-back" aria-hidden="true" />
          <div className="stack-card stack-card-mid" aria-hidden="true" />

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
              celebrate={poll.id === celebrateId}
              onVoted={onVoted}
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
          {polls && index === 0 && polls.length > 1 && <p className="swipe-hint">Swipe up for the next one</p>}
        </div>
      </main>

      <BottomNav current="feed" />

      {sheet && <SignInSheet pick={sheet} onClose={closeSheet} />}
    </div>
  );
}
