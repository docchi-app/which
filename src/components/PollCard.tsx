"use client";

import { useState, type CSSProperties } from "react";
import { SignInRequired } from "@/lib/auth";
import { castVote, fetchPoll } from "@/lib/polls";
import { useLiveInterval } from "@/lib/useLiveInterval";
import { formatCount, percentages, timeLeft } from "@/lib/format";
import type { Poll, VoteResult } from "@/lib/types";
import { ArrowIcon, CommentIcon, ShareIcon } from "./icons";

const LIVE_REFRESH_MS = 5000;

export const ANSWER_COLORS = ["var(--coral)", "var(--sky)", "var(--sun)", "var(--mint)"];
// Hot takes: Agree / Disagree.
const TAKE_COLORS = ["var(--sun)", "var(--sky)"];

// 16 pieces fanned out in an ellipse, as on the canvas.
const CONFETTI = Array.from({ length: 16 }, (_, n) => {
  const a = (n / 16) * Math.PI * 2;
  const r = 70 + (n % 3) * 26;
  return {
    dx: `${Math.round(Math.cos(a) * r * 1.6)}px`,
    dy: `${Math.round(Math.sin(a) * r)}px`,
    color: ANSWER_COLORS[n % 4],
    size: n % 2 ? 9 : 12,
    round: n % 3 === 0,
    delay: (n % 4) * 0.03,
  };
});

type Props = {
  poll: Poll;
  tag: string;
  /** false when the viewer must sign in first; null while that's still unknown. */
  canVote: boolean | null;
  /** Play the vote celebration on mount (returning from sign-in). */
  celebrate?: boolean;
  /** The viewer just posted this poll: nudge them to share it. */
  justCreated?: boolean;
  onVoted: (pollId: string, result: VoteResult) => void;
  /** Fresher numbers for this poll arrived (live updates). */
  onRefresh: (poll: Poll) => void;
  onNeedSignIn: (pollId: string, optionId: string) => void;
  onShare: () => void;
  onNext: () => void;
};

/** Docchi's own polls carry a tick. */
export function VerifiedTick() {
  return (
    <span className="verified" role="img" aria-label="Verified">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </span>
  );
}

/** How split a hot take is: 100 = dead even, 0 = everyone agrees. */
function spiciness(pcts: number[]) {
  const split = 100 - Math.abs((pcts[0] ?? 0) - (pcts[1] ?? 0));
  const label = split >= 80 ? "Split down the middle" : split >= 50 ? "Spicy" : "Mild: most people agree";
  return { split, label };
}

export function PollCard({
  poll,
  tag,
  canVote,
  celebrate = false,
  justCreated = false,
  onVoted,
  onRefresh,
  onNeedSignIn,
  onShare,
  onNext,
}: Props) {
  // The pick being saved. The card switches to results the moment you tap;
  // the bars fill in when the server answers.
  const [lockingId, setLockingId] = useState<string | null>(null);
  const [justVoted, setJustVoted] = useState(celebrate);
  const [error, setError] = useState<string | null>(null);
  // Read the clock once per card; closing mid-view is handled by cast_vote.
  const [now] = useState(() => Date.now());

  const voted = poll.myOptionId !== null;
  const closed = new Date(poll.closesAt).getTime() <= now;
  const showResults = voted || closed;
  const isTake = poll.kind === "hot_take";
  const isMystery = poll.kind === "mystery";
  const colors = isTake ? TAKE_COLORS : ANSWER_COLORS;

  async function vote(optionId: string) {
    if (lockingId || voted) return;
    if (canVote === false) return onNeedSignIn(poll.id, optionId);
    setLockingId(optionId);
    setError(null);
    try {
      const result = await castVote(poll.id, optionId);
      setJustVoted(true);
      onVoted(poll.id, result);
    } catch (e) {
      if (e instanceof SignInRequired) onNeedSignIn(poll.id, optionId);
      else {
        console.error(e);
        setError("That vote didn't go through. Try again?");
      }
    } finally {
      setLockingId(null);
    }
  }

  // Live: while this card is on screen, fetch fresh numbers every few seconds.
  // Results stay hidden until you vote, so before that only the total moves.
  useLiveInterval(
    async () => {
      if (lockingId) return;
      try {
        const fresh = await fetchPoll(poll.id);
        const changed =
          fresh &&
          (fresh.voteCount !== poll.voteCount ||
            fresh.commentCount !== poll.commentCount ||
            fresh.options.some((o, i) => o.votes !== poll.options[i]?.votes));
        if (changed) onRefresh({ ...fresh, question: fresh.question ?? poll.question });
      } catch {
        // Offline for a moment: try again on the next tick.
      }
    },
    LIVE_REFRESH_MS,
    !closed,
  );

  const pcts = percentages(poll.options.map((o) => o.votes ?? 0));
  const mineId = poll.myOptionId ?? lockingId;
  const mineIndex = poll.options.findIndex((o) => o.id === mineId);
  const votesLabel = `${formatCount(poll.voteCount)} ${poll.voteCount === 1 ? "vote" : "votes"}`;
  const spice = isTake && showResults ? spiciness(pcts) : null;

  const withYou = !showResults
    ? "Locking in your pick…"
    : poll.voteCount === 1
      ? "First vote. You set the trend!"
      : isTake
        ? `You're with the ${pcts[mineIndex]}% who ${mineIndex === 0 ? "agree" : "disagree"}!`
        : `You're with the ${pcts[mineIndex]}%!`;

  return (
    <article className={`poll-card poll-${poll.kind}`} aria-labelledby={`q-${poll.id}`}>
      {justCreated && (
        <div className="created-banner" role="status">
          <span>
            <strong>Your poll is live!</strong> Share it so friends can vote.
          </span>
          <button type="button" className="btn btn-coral press" onClick={onShare}>
            <ShareIcon size={18} />
            Share
          </button>
        </div>
      )}
      <div className="poll-meta">
        <span className={`chip ${poll.kind === "classic" || poll.featuredToday ? "chip-sun" : "chip-white"}`}>
          {isTake ? <ChiliIcon /> : isMystery ? <span aria-hidden="true">?</span> : <span className="live-dot" aria-hidden="true" />}
          {tag}
        </span>
        <span className="poll-by">
          by <strong>@{poll.creator}</strong>
          {poll.isSystem && <VerifiedTick />} · {timeLeft(poll.closesAt, now)}
        </span>
      </div>

      {isMystery && !poll.question ? (
        <>
          {/* The real question stays on the server until you vote. */}
          <div className="mystery-blur" aria-hidden="true">
            <span />
            <span />
          </div>
          <h1 id={`q-${poll.id}`} className="poll-question mystery-teaser">
            {poll.teaser}
          </h1>
          <p className="mystery-hint">Pick on gut. The question shows up after you tap.</p>
        </>
      ) : isMystery ? (
        <div className="mystery-reveal">
          <small>The question was</small>
          <h1 id={`q-${poll.id}`} className="poll-question">
            {poll.question}
          </h1>
        </div>
      ) : (
        <h1 id={`q-${poll.id}`} className="poll-question">
          {poll.question}
        </h1>
      )}

      {!showResults && !lockingId ? (
        <>
          <div className={isTake ? "take-answers" : "answers"}>
            {poll.options.map((o, i) =>
              isTake ? (
                <button
                  key={o.id}
                  type="button"
                  className={`take-btn press${i === 1 ? " take-btn-dark" : ""}`}
                  onClick={() => vote(o.id)}
                >
                  {o.text}
                </button>
              ) : (
                <button
                  key={o.id}
                  type="button"
                  className="answer press"
                  style={{ animationDelay: `${i * 0.08}s` }}
                  onClick={() => vote(o.id)}
                >
                  <span className="answer-letter" style={{ background: colors[i] }}>
                    {"ABCD"[i]}
                  </span>
                  {o.text}
                </button>
              ),
            )}
          </div>
          <p className="poll-foot-note">
            {votesLabel} · {isTake ? "tap to see how spicy this is" : "tap to reveal results"}
          </p>
        </>
      ) : (
        <>
          {(voted || lockingId) && (
            <div className={`with-you${justVoted ? " pop" : ""}${showResults ? "" : " locking"}`} role="status">
              {withYou}
              {justVoted &&
                CONFETTI.map((c, n) => (
                  <span
                    key={n}
                    className="confetti"
                    aria-hidden="true"
                    style={
                      {
                        "--dx": c.dx,
                        "--dy": c.dy,
                        width: c.size,
                        height: c.size,
                        background: c.color,
                        borderRadius: c.round ? "50%" : 3,
                        animationDelay: `${c.delay}s`,
                      } as CSSProperties
                    }
                  />
                ))}
            </div>
          )}
          {spice && (
            <div className="spice-meter">
              <strong>Spice meter</strong>
              <span className="spice-track" aria-hidden="true">
                <span className="spice-fill" style={{ width: `${spice.split}%` }} />
              </span>
              <strong>{spice.label}</strong>
            </div>
          )}
          <ul className="results" aria-label="Results">
            {poll.options.map((o, i) => {
              const mine = o.id === mineId;
              return (
                <li key={o.id} className={`result${mine ? " result-mine" : ""}`}>
                  {showResults && (
                    <span
                      className="result-bar"
                      aria-hidden="true"
                      style={{
                        width: `${pcts[i]}%`,
                        background: colors[i],
                        borderRightWidth: pcts[i] === 0 ? 0 : undefined,
                        animationDelay: `${i * 0.08}s`,
                      }}
                    />
                  )}
                  <span className="result-row">
                    <span className="result-text">
                      {o.text}
                      {mine && <span className="chip chip-small">Your pick</span>}
                    </span>
                    {showResults && (
                      <span className="result-pct" style={{ animationDelay: `${0.5 + i * 0.08}s` }}>
                        {pcts[i]}%
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {spice && spice.split >= 70 && voted && (
            <button type="button" className="btn btn-white press settle-btn" onClick={onShare}>
              <ShareIcon size={18} />
              Too close to call. Settle this
            </button>
          )}
          <p className="poll-foot-note">
            {!closed && showResults && <span className="live-dot live-dot-small" aria-hidden="true" />}
            {votesLabel} · {closed ? "final results" : showResults ? "live" : "counting…"}
          </p>
        </>
      )}

      {error && (
        <p className="poll-error" role="alert">
          {error}
        </p>
      )}

      <div className="poll-actions">
        <span className="ghost-action" aria-label={`${poll.commentCount} comments`}>
          <CommentIcon />
          {poll.commentCount}
        </span>
        <button type="button" className="ghost-action" onClick={onShare}>
          <ShareIcon />
          Share
        </button>
        {showResults || lockingId ? (
          <button type="button" className="btn btn-coral press next-btn" onClick={onNext}>
            Next <ArrowIcon size={18} />
          </button>
        ) : (
          <button type="button" className="skip-btn" onClick={onNext} aria-label="Skip to next poll">
            Skip
          </button>
        )}
      </div>
    </article>
  );
}

function ChiliIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 6c-5 1-9 6-9 13 4-1 13-4 15-10a3 3 0 0 0-6-3z" />
      <path d="M15 5c0-2 1-3 3-3" />
    </svg>
  );
}
