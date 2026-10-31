"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBackClose } from "@/lib/back";
import { getFriendsVoted } from "@/lib/circle";
import {
  askedRecently,
  friendMatch,
  friendPicks,
  hiddenPickIds,
  hiddenPicks,
  hidePick,
  markAsked,
  myMatches,
  picksLine,
  picksSetting,
  PICKS_CHANGED,
  setPicksSetting,
  type FriendPick,
  type Match,
  type MatchRow,
} from "@/lib/picks";
import type { Poll } from "@/lib/types";
import { Avatar } from "./Avatar";

const TOPIC_LABEL: Record<string, string> = {
  cricket: "🏏 Cricket", sports: "⚽ Sports", movies: "🎬 Movies", music: "🎵 Music", tv: "📺 TV", celebs: "⭐ Celebs",
  food: "🍛 Food", festivals: "🪔 Festivals", travel: "✈️ Travel", fashion: "👗 Fashion", college: "🎓 College", work: "💼 Work",
  tech: "📱 Tech", science: "🔬 Science", relationships: "💞 Relationships", family: "🏠 Family", daily: "☀️ Daily life",
  news: "📰 News", fun: "🎉 Fun",
};

export type PicksState = {
  /** Friends' picks, once I share mine and have voted; null while unknown or off. */
  picks: FriendPick[] | null;
  /** My pick on this poll is hidden from friends. */
  hidden: boolean;
  /** Ask "Show your picks to friends?" (not asked yet, and friends voted here). */
  ask: boolean;
  dismissAsk: () => void;
  answered: () => void;
};

// Only one card asks at a time.
let askOpen = false;

/**
 * What friends picked on a voted poll (public and link polls; not Brain breaks). `enabled` once I've
 * voted, I'm signed in and the card is near the screen. `canAsk`: just voted on this card, the only
 * moment "Show your picks to friends?" comes up.
 */
export function useFriendPicks(poll: Poll, enabled: boolean, canAsk = false): PicksState {
  const [picks, setPicks] = useState<FriendPick[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [ask, setAsk] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    const again = () => setRound((n) => n + 1);
    window.addEventListener(PICKS_CHANGED, again);
    return () => window.removeEventListener(PICKS_CHANGED, again);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    (async () => {
      const share = await picksSetting();
      if (!live) return;
      if (share === null) {
        // Not asked yet: ask once friends have voted here (and not if they closed it lately).
        if (!canAsk || askOpen || askedRecently()) return;
        const f = await getFriendsVoted(poll.id).catch(() => null);
        if (live && f && f.count > 0 && !askOpen) {
          askOpen = true;
          setAsk(true);
        }
        return;
      }
      setAsk(false);
      if (!share) return setPicks(null);
      const [rows, ids] = await Promise.all([friendPicks(poll.id).catch(() => null), hiddenPickIds()]);
      if (!live) return;
      setPicks(rows);
      setHidden(ids.has(poll.id));
    })();
    return () => {
      live = false;
    };
  }, [enabled, canAsk, poll.id, poll.voteCount, round]);

  const dismissAsk = useCallback(() => {
    markAsked();
    askOpen = false;
    setAsk(false);
  }, []);
  const answered = useCallback(() => {
    askOpen = false;
    setAsk(false);
  }, []);
  return { picks, hidden, ask, dismissAsk, answered };
}

/** Up to 3 friends' faces on an answer row. */
export function RowFaces({ picks, optionId }: { picks: FriendPick[] | null; optionId: string }) {
  const on = picks?.filter((p) => p.optionId === optionId) ?? [];
  if (!on.length) return null;
  return (
    <span className="row-faces" aria-label={`${on.length} ${on.length === 1 ? "friend" : "friends"}: ${on.map((p) => "@" + p.username).join(", ")}`}>
      {on.slice(0, 3).map((p) => (
        <Avatar key={p.username} name={p.username} url={p.avatarUrl} size={20} />
      ))}
      {on.length > 3 && <span className="row-faces-more">+{on.length - 3}</span>}
    </span>
  );
}

/** "You and @priya picked this. 3 friends went the other way." and "Hide my pick on this one". */
export function FriendPicksLine({ poll, state }: { poll: Poll; state: PicksState }) {
  const [busy, setBusy] = useState(false);
  if (!state.picks || !poll.myOptionId) return null;
  async function toggle() {
    setBusy(true);
    try {
      await hidePick(poll.id, !state.hidden);
    } catch {
      // Stays as it was.
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="friend-picks">
      {state.picks.length > 0 && <p className="friend-picks-line">💜 {picksLine(state.picks, poll.myOptionId)}</p>}
      <button type="button" className="friend-picks-hide" onClick={toggle} disabled={busy}>
        {state.hidden ? "Your pick is hidden from friends · Show it" : "Hide my pick on this one"}
      </button>
    </div>
  );
}

/** The one-time ask, before any pick is shown. */
export function PicksAskSheet({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const close = useBackClose(true, onClose);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  async function choose(share: boolean) {
    setBusy(true);
    setError(false);
    try {
      await setPicksSetting(share);
      onDone();
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return createPortal(
    <div className="sheet-layer">
      <div className="sheet-backdrop" aria-hidden="true" onClick={close} />
      <section role="dialog" aria-modal="true" aria-labelledby="picks-title" className="sheet picks-sheet">
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="picks-title" className="sheet-title">
          Show your picks to friends?
        </h2>
        <p className="sheet-text">Your friends voted here too. See which side they took, and let them see yours.</p>
        <ul className="picks-rules">
          <li>Only people you&apos;ve added as friends see them. Never strangers.</li>
          <li>They see your pick only after they vote too.</li>
          <li>Hide any single pick, or switch it off in Settings.</li>
          <li>It covers your past picks too. Switching it off hides them all.</li>
        </ul>
        <button type="button" className="sheet-btn picks-yes press" onClick={() => choose(true)} disabled={busy}>
          Show to friends
        </button>
        <button type="button" className="sheet-later" onClick={() => choose(false)} disabled={busy}>
          Keep my picks private
        </button>
        <p className="picks-fair">If you keep them private, you won&apos;t see your friends&apos; picks either. Fair both ways.</p>
        {error && (
          <p className="poll-error" role="alert">
            That didn&apos;t save. Check your connection and try again.
          </p>
        )}
      </section>
    </div>,
    document.body,
  );
}

/** "You and @priya: 72%" on a friend's profile. */
export function MatchCard({ name }: { name: string }) {
  const [m, setM] = useState<Match | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    friendMatch(name)
      .then((x) => live && setM(x))
      .catch(() => live && setM(null));
    return () => {
      live = false;
    };
  }, [name]);
  if (!m) return null;
  if (m.agree === undefined) {
    return (
      <section className="match-card" aria-label={`You and @${name}`}>
        <b className="match-title">You and @{name}</b>
        <p className="match-note">
          {m.shared} of 10 polls answered together. Your match shows at 10.
        </p>
      </section>
    );
  }
  const pct = Math.round(((m.agree ?? 0) / Math.max(1, m.shared)) * 100);
  return (
    <section className="match-card" aria-label={`You and @${name}`}>
      <b className="match-title">You and @{name}</b>
      <div className="match-num">{pct}%</div>
      <span className="match-meter" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </span>
      <p className="match-note">
        You agree on <b>{m.agree} of {m.shared}</b> polls you both answered.
      </p>
      {!!m.topics?.length && (
        <ul className="match-topics">
          {m.topics.map((t) => (
            <li key={t.topic}>
              <span>{TOPIC_LABEL[t.topic] ?? t.topic}</span>
              <b>{Math.round((t.agree / Math.max(1, t.shared)) * 100)}%</b>
            </li>
          ))}
        </ul>
      )}
      {m.split && (
        <p className="match-note">
          Biggest split: <Link href={`/p/${m.split.pollId}`}>&ldquo;{m.split.question}&rdquo;</Link>
        </p>
      )}
    </section>
  );
}

/** "Your friends, by match" on the Friends tab (10+ polls in common). */
export function MatchesList() {
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  useEffect(() => {
    let live = true;
    myMatches()
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, []);
  if (!rows?.length) return null;
  const pct = (r: MatchRow) => Math.round((r.agree / Math.max(1, r.shared)) * 100);
  const opposite = rows.length > 1 ? rows[rows.length - 1] : null;
  return (
    <section className="match-card match-list" aria-labelledby="matches-title">
      <b id="matches-title" className="match-title">
        Your friends, by match
      </b>
      <ul className="match-topics">
        {rows.map((r) => (
          <li key={r.username}>
            <Link href={`/u/${r.username}`} className="match-person">
              <Avatar name={r.username} url={r.avatarUrl} size={24} />@{r.username}
            </Link>
            <b>
              {pct(r)}%{opposite && r.username === opposite.username && pct(r) < 50 ? " · your opposite" : ""}
            </b>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Settings: "Friends see my picks", and the picks I've hidden. */
export function PicksSettings() {
  const [share, setShare] = useState<boolean | null | undefined>(undefined);
  const [list, setList] = useState<{ pollId: string; question: string }[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    picksSetting().then(setShare, () => setShare(null));
    hiddenPicks().then(setList, () => setList([]));
  }, []);
  if (share === undefined) return null;
  return (
    <section className="settings-group" aria-labelledby="picks-settings-title">
      <h2 id="picks-settings-title" className="settings-heading">
        Friends
      </h2>
      <label className="settings-row">
        <span>
          <strong>Friends see my picks</strong>
          <span className="notif-hint">Only friends, only after they vote too. Off: you don&apos;t see theirs either.</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={!!share}
          onChange={(e) => {
            const on = e.target.checked;
            const before = share;
            setShare(on);
            setPicksSetting(on).catch(() => setShare(before));
          }}
        />
      </label>
      {!!list?.length && (
        <>
          <button type="button" className="settings-row" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <span>
              <strong>Hidden picks</strong>
              <span className="notif-hint">
                {list.length} {list.length === 1 ? "poll" : "polls"} your friends can&apos;t see your pick on
              </span>
            </span>
            <span aria-hidden="true">{open ? "▴" : "▾"}</span>
          </button>
          {open && (
            <ul className="hidden-picks">
              {list.map((h) => (
                <li key={h.pollId}>
                  <span>{h.question}</span>
                  <button
                    type="button"
                    className="friend-picks-hide"
                    onClick={() => hidePick(h.pollId, false).then(() => setList((l) => l?.filter((x) => x.pollId !== h.pollId) ?? null), () => {})}
                  >
                    Show it
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
