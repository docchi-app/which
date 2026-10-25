"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  giveProp,
  isOffer,
  nextProp,
  PROPS_FRIENDS_NEEDED,
  PROPS_PER_DAY,
  propsErrorText,
  shuffleProp,
  skipProp,
  type PropOffer,
  type PropsState,
} from "@/lib/props";
import { ArrowIcon } from "./icons";
import { Avatar } from "./Avatar";

// Hearts fanned out in a circle when props are sent.
const HEARTS = Array.from({ length: 12 }, (_, n) => {
  const a = (n / 12) * Math.PI * 2;
  return { dx: `${Math.round(Math.cos(a) * 130)}px`, dy: `${Math.round(Math.sin(a) * 110)}px`, delay: (n % 3) * 0.04 };
});

/**
 * "💜 About your friends": a question Docchi wrote, with 4 of your friends as
 * answers. Pick one (anonymously), shuffle, or skip. In the feed, `onNext`
 * moves on to the next poll.
 */
export function PropsCard({ onNext }: { onNext?: () => void }) {
  const [data, setData] = useState<PropOffer | PropsState | null>(null);
  const [sent, setSent] = useState<{ to: string; left: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    nextProp()
      .then((d) => {
        setData(d);
        setSent(null);
      })
      .catch((e) => setError(propsErrorText(e)));
  }, []);

  useEffect(() => {
    // Fetching on mount is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function act<T>(fn: () => Promise<T>, then: (r: T) => void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      then(await fn());
    } catch (e) {
      setError(propsErrorText(e));
      if (/no_offer|not_an_option/.test((e as Error).message)) load();
    } finally {
      setBusy(false);
    }
  }

  const footer = (extra?: React.ReactNode) => (
    <div className="poll-actions props-actions">
      {extra}
      {onNext && (
        <button type="button" className="btn btn-coral press next-btn" onClick={onNext}>
          Polls <ArrowIcon size={18} />
        </button>
      )}
    </div>
  );

  if (!data) {
    return (
      <article className="poll-card feed-card props-card" aria-busy={!error}>
        <span className="chip props-chip">💜 About your friends</span>
        {error ? <p className="poll-error">{error}</p> : <div className="skeleton skeleton-title" />}
        {footer()}
      </article>
    );
  }

  if (!isOffer(data) && data.state === "locked") {
    const have = data.friends ?? 0;
    return (
      <article className="poll-card feed-card props-card" aria-labelledby="props-q">
        <span className="chip props-chip">💜 About your friends</span>
        <h1 id="props-q" className="poll-question">
          Unlock Props
        </h1>
        <p className="props-sub">
          Props asks fun questions about your friends, like &ldquo;Who has the best laugh?&rdquo;. It needs {PROPS_FRIENDS_NEEDED} friends to pick
          from{have ? `; you have ${have}` : ""}.
        </p>
        <div className="props-ghosts" aria-hidden="true">
          {Array.from({ length: PROPS_FRIENDS_NEEDED }, (_, i) => (
            <span key={i} className={i < have ? "props-ghost props-ghost-on" : "props-ghost"}>
              {i < have ? "✓" : "+"}
            </span>
          ))}
        </div>
        <Link href="/friends" className="post-btn press">
          Invite friends
        </Link>
        {footer()}
      </article>
    );
  }

  if (!isOffer(data)) {
    return (
      <article className="poll-card feed-card props-card" aria-labelledby="props-q">
        <span className="chip props-chip">💜 About your friends</span>
        <h1 id="props-q" className="poll-question">
          That&apos;s all your props for today
        </h1>
        <p className="props-sub">New questions about your friends tomorrow. {PROPS_PER_DAY} a day keeps it special.</p>
        <Link href="/profile" className="btn btn-white press props-link">
          See what friends say about you
        </Link>
        {footer()}
      </article>
    );
  }

  if (sent) {
    return (
      <article className="poll-card feed-card props-card props-sent" aria-live="polite">
        <span className="props-sent-heart" aria-hidden="true">
          💜
        </span>
        {HEARTS.map((h, n) => (
          <span key={n} className="props-heart" aria-hidden="true" style={{ "--dx": h.dx, "--dy": h.dy, animationDelay: `${h.delay}s` } as CSSProperties}>
            💜
          </span>
        ))}
        <h1 className="poll-question">Props sent!</h1>
        <p className="props-sub">
          @{sent.to} gets a ping that someone thinks so. <strong>Never who.</strong>
        </p>
        {sent.left > 0 ? (
          <button type="button" className="post-btn press" onClick={load}>
            Next question <ArrowIcon size={18} />
          </button>
        ) : (
          <p className="props-sub">That was today&apos;s last one. More tomorrow!</p>
        )}
        <p className="props-count">
          {PROPS_PER_DAY - sent.left} of {PROPS_PER_DAY} today
        </p>
        {footer()}
      </article>
    );
  }

  const o = data;
  return (
    <article className="poll-card feed-card props-card" aria-labelledby="props-q">
      <span className="chip props-chip">💜 About your friends</span>
      <h1 id="props-q" className="poll-question">
        {o.question}
      </h1>
      <p className="props-sub">Anonymous: they&apos;ll never know it was you.</p>
      <div className="answers">
        {o.options.map((p, i) => (
          <button
            key={p.username}
            type="button"
            className="answer press props-answer"
            style={{ animationDelay: `${i * 0.06}s` }}
            disabled={busy}
            onClick={() => act(() => giveProp(o.offer, p.username), (s) => setSent({ to: p.username, left: s.left ?? 0 }))}
          >
            <Avatar name={p.username} url={p.avatarUrl} size={30} />@{p.username}
          </button>
        ))}
      </div>
      {error && (
        <p className="poll-error" role="alert">
          {error}
        </p>
      )}
      {footer(
        <>
          <button
            type="button"
            className="ghost-action"
            disabled={busy || o.shufflesLeft === 0}
            onClick={() => act(() => shuffleProp(o.offer), setData)}
            aria-label={`Shuffle friends (${o.shufflesLeft} left)`}
          >
            🔀 Shuffle{o.shufflesLeft < 2 ? ` (${o.shufflesLeft})` : ""}
          </button>
          <button type="button" className="ghost-action props-skip" disabled={busy} onClick={() => act(() => skipProp(o.offer), () => load())}>
            Skip
          </button>
        </>,
      )}
    </article>
  );
}
