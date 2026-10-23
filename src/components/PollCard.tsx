"use client";

import { useState, type CSSProperties } from "react";
import { castVote } from "@/lib/polls";
import { formatCount, percentages, timeLeft } from "@/lib/format";
import type { Poll, VoteResult } from "@/lib/types";
import { ArrowIcon, CommentIcon, ShareIcon } from "./icons";

const ANSWER_COLORS = ["var(--coral)", "var(--sky)", "var(--sun)", "var(--mint)"];

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
  onVoted: (pollId: string, result: VoteResult) => void;
  onNext: () => void;
};

export function PollCard({ poll, tag, onVoted, onNext }: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [justVoted, setJustVoted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read the clock once per card; closing mid-view is handled by cast_vote.
  const [now] = useState(() => Date.now());

  const voted = poll.myOptionId !== null;
  const closed = new Date(poll.closesAt).getTime() <= now;
  const showResults = voted || closed;

  async function vote(optionId: string) {
    if (pendingId || voted) return;
    setPendingId(optionId);
    setError(null);
    try {
      const result = await castVote(poll.id, optionId);
      setJustVoted(true);
      onVoted(poll.id, result);
    } catch (e) {
      console.error(e);
      setError("That vote didn't go through. Try again?");
    } finally {
      setPendingId(null);
    }
  }

  async function share() {
    const url = `${window.location.origin}/?poll=${poll.id}&src=share`;
    try {
      if (navigator.share) await navigator.share({ title: poll.question, text: `${poll.question} Docchi?`, url });
      else await navigator.clipboard.writeText(url);
    } catch {
      // Share sheet dismissed; nothing to do.
    }
  }

  const pcts = percentages(poll.options.map((o) => o.votes ?? 0));
  const mineIndex = poll.options.findIndex((o) => o.id === poll.myOptionId);
  const votesLabel = `${formatCount(poll.voteCount)} ${poll.voteCount === 1 ? "vote" : "votes"}`;

  return (
    <article className="poll-card" aria-labelledby={`q-${poll.id}`}>
      <div className="poll-meta">
        <span className="chip chip-sun">
          <span className="live-dot" aria-hidden="true" />
          {tag}
        </span>
        <span className="poll-by">
          by <strong>@{poll.creator}</strong> · {timeLeft(poll.closesAt, now)}
        </span>
      </div>

      <h1 id={`q-${poll.id}`} className="poll-question">
        {poll.question}
      </h1>

      {!showResults ? (
        <>
          <div className="answers">
            {poll.options.map((o, i) => (
              <button
                key={o.id}
                type="button"
                className="answer press"
                style={{ animationDelay: `${i * 0.08}s` }}
                onClick={() => vote(o.id)}
                disabled={pendingId !== null}
                aria-busy={pendingId === o.id}
                data-pending={pendingId === o.id || undefined}
              >
                <span className="answer-letter" style={{ background: ANSWER_COLORS[i] }}>
                  {"ABCD"[i]}
                </span>
                {o.text}
              </button>
            ))}
          </div>
          <p className="poll-foot-note">{votesLabel} · tap to reveal results</p>
        </>
      ) : (
        <>
          {voted && (
            <div className={`with-you${justVoted ? " pop" : ""}`} role="status">
              {poll.voteCount === 1 ? "First vote. You set the trend!" : `You're with the ${pcts[mineIndex]}%!`}
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
          <ul className="results" aria-label="Results">
            {poll.options.map((o, i) => {
              const mine = o.id === poll.myOptionId;
              return (
                <li key={o.id} className={`result${mine ? " result-mine" : ""}`}>
                  <span
                    className="result-bar"
                    aria-hidden="true"
                    style={{
                      width: `${pcts[i]}%`,
                      background: ANSWER_COLORS[i],
                      borderRightWidth: pcts[i] === 0 ? 0 : undefined,
                      animationDelay: `${i * 0.08}s`,
                    }}
                  />
                  <span className="result-row">
                    <span className="result-text">
                      {o.text}
                      {mine && <span className="chip chip-small">Your pick</span>}
                    </span>
                    <span className="result-pct" style={{ animationDelay: `${0.5 + i * 0.08}s` }}>
                      {pcts[i]}%
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="poll-foot-note">
            {votesLabel} · {closed ? "final results" : "live"}
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
        <button type="button" className="ghost-action" onClick={share}>
          <ShareIcon />
          Share
        </button>
        {showResults ? (
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
