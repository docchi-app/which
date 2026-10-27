"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { isSignedIn, onUserChange } from "@/lib/auth";
import { fetchLeaderboard, type Board, type Leaderboard, type LeaderRow } from "@/lib/leaders";
import { recall, remember } from "@/lib/screen-cache";
import { isSupabaseConfigured } from "@/lib/supabase";
import { Avatar } from "./Avatar";
import { BottomNav } from "./BottomNav";
import { LogoMark, Wordmark } from "./Logo";

const PODIUM = ["var(--sun)", "var(--sky)", "var(--coral)"];

function shortDate(d: string) {
  return new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

function ago(iso: string | null) {
  if (!iso) return "";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

const votes = (n: number) => `${n.toLocaleString("en-IN")} ${n === 1 ? "vote" : "votes"}`;

/** Weekly leaderboard: top creators and hottest polls, Monday–Sunday India time. */
export function LeadersScreen() {
  // Coming back: the board you were on, shown straight away and then refreshed.
  const [view] = useState(() => recall<{ board: Board; which: "this" | "last"; fellBack: boolean }>("leaders:view"));
  const [board, setBoard] = useState<Board>(view?.board ?? "creators");
  const [which, setWhich] = useState<"this" | "last">(view?.which ?? "this");
  const [data, setData] = useState<Leaderboard | null | undefined>(() =>
    view ? recall<Leaderboard | null>(`leaders:${view.board}:${view.which}`) : undefined,
  );
  const [failed, setFailed] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [retry, setRetry] = useState(0);
  // This week was still empty on arrival, so we're showing last week instead.
  const [fellBack, setFellBack] = useState(view?.fellBack ?? false);
  const firstLoad = useRef(!view);
  const fellBackRef = useRef(fellBack);
  useEffect(() => {
    fellBackRef.current = fellBack;
  });

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    return onUserChange((u) => setSignedIn(isSignedIn(u)));
  }, []);

  useEffect(() => {
    if (isSupabaseConfigured && signedIn === null) return; // wait to know who's looking (for "you")
    let live = true;
    fetchLeaderboard(board, which)
      .then((d) => {
        if (!live) return;
        setFailed(false);
        // Arriving to an empty week: show last week's board rather than an empty one.
        if (firstLoad.current && which === "this" && !d?.rows.length) {
          firstLoad.current = false;
          setFellBack(true);
          setWhich("last");
          return;
        }
        firstLoad.current = false;
        setData(d);
        remember(`leaders:${board}:${which}`, d);
        remember("leaders:view", { board, which, fellBack: fellBackRef.current });
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [board, which, signedIn, retry]);

  const rows = data?.rows ?? [];
  const top = board === "creators" ? rows.slice(0, 3) : [];
  const rest = board === "creators" ? rows.slice(3) : rows;

  return (
    <div className="screen leaders-screen">
      <header className="app-header">
        <Link href="/" className="brand" aria-label="Eithr home">
          <LogoMark />
          <Wordmark />
        </Link>
      </header>

      <section className="leaders-hero">
        <div className="leaders-head">
          <h1 className="leaders-title">{which === "this" ? "This week" : "Last week"}</h1>
          <button
            type="button"
            className="leaders-week"
            onClick={() => {
              setFellBack(false);
              setWhich(which === "this" ? "last" : "this");
            }}
          >
            {which === "this" ? "Last week →" : "← This week"}
          </button>
        </div>
        <p className="leaders-sub">
          {data ? `${shortDate(data.weekStart)} – ${shortDate(data.weekEnd)}` : " "}
          {which === "this" && data?.updatedAt ? ` · updated ${ago(data.updatedAt)}` : ""}
        </p>
        {fellBack && which === "last" && <p className="leaders-sub">Nobody&apos;s on this week&apos;s board yet. Here&apos;s how last week ended.</p>}
        {which === "this" && data?.lastChamp && (
          <p className="leaders-champ">
            <span aria-hidden="true">👑</span> Last week&apos;s champ{" "}
            <Link href={`/u/${data.lastChamp.username}`}>@{data.lastChamp.username}</Link> · {votes(data.lastChamp.score)}
          </p>
        )}
      </section>

      <div className="leaders-controls">
        <div role="tablist" aria-label="Board" className="tabs leaders-tabs">
          {(
            [
              ["creators", "Top creators"],
              ["polls", "Hottest polls"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" type="button" aria-selected={board === id} className="tab press" onClick={() => setBoard(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {failed ? (
        <section className="poll-card soon leaders-empty">
          <h2 className="poll-question">Couldn&apos;t load the leaderboard.</h2>
          <button type="button" className="btn btn-coral press" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </button>
        </section>
      ) : data === undefined ? (
        <p className="admin-empty" aria-busy="true">Loading…</p>
      ) : !data || rows.length === 0 ? (
        <section className="poll-card soon leaders-empty">
          <span className="chip chip-sun">{which === "this" ? "Wide open" : "Quiet week"}</span>
          <h2 className="poll-question">{which === "this" ? "Nobody's on the board yet." : "No one made the board last week."}</h2>
          <p className="poll-foot-note">Votes on your public polls this week put you here. Post one and share it.</p>
          <Link href="/create" className="btn btn-coral press">
            Make a poll
          </Link>
        </section>
      ) : (
        <>
          {top.length > 0 && (
            <ol className="podium">
              {top.map((r, i) => (
                <li key={r.rank} className={`podium-spot podium-${i + 1}`} style={{ background: PODIUM[i] }} data-me={r.isMe || undefined}>
                  <span className="podium-rank">{i === 0 ? "👑" : `#${r.rank}`}</span>
                  <Avatar name={r.username ?? "?"} url={r.avatarUrl} size={i === 0 ? 56 : 46} />
                  <Link href={`/u/${r.username}`} className="podium-name">
                    @{r.username}
                  </Link>
                  <span className="podium-score">{votes(r.score)}</span>
                </li>
              ))}
            </ol>
          )}
          <ol className="leader-list" start={top.length + 1}>
            {rest.map((r) => (
              <LeaderItem key={`${r.rank}-${r.pollId ?? r.username}`} row={r} board={board} />
            ))}
          </ol>
        </>
      )}

      {board === "creators" && which === "this" && data && (
        <div className="leaders-me" role="status">
          {data.me?.rank ? (
            <>
              You&apos;re <strong>#{data.me.rank}</strong> this week · {votes(data.me.score)}
            </>
          ) : data.me ? (
            <>
              You have <strong>{votes(data.me.score)}</strong> this week.{" "}
              <Link href="/create">Post a poll</Link> to climb.
            </>
          ) : null}
        </div>
      )}

      <BottomNav current="leaders" />
    </div>
  );
}

function LeaderItem({ row, board }: { row: LeaderRow; board: Board }) {
  if (board === "polls") {
    return (
      <li className="leader-row" data-me={row.isMe || undefined}>
        <span className="leader-rank">{row.rank}</span>
        <Link href={`/p/${row.pollId}`} className="leader-main">
          <span className="leader-q">{row.question}</span>
          <span className="leader-by">
            by @{row.username ?? "someone"}
            {row.kind === "mystery" && " · mystery"}
            {row.closed && " · closed"}
          </span>
        </Link>
        <span className="leader-score">{row.score.toLocaleString("en-IN")}</span>
      </li>
    );
  }
  return (
    <li className="leader-row" data-me={row.isMe || undefined}>
      <span className="leader-rank">{row.rank}</span>
      <Avatar name={row.username ?? "?"} url={row.avatarUrl} size={36} />
      <Link href={`/u/${row.username}`} className="leader-main">
        <span className="leader-name">@{row.username}</span>
      </Link>
      <span className="leader-score">{row.score.toLocaleString("en-IN")}</span>
    </li>
  );
}
