"use client";

import { useEffect, useState } from "react";
import { continueWithGoogle, saveReturnTo } from "@/lib/auth";
import { announceCircleChange, circleErrorText, getCirclePicks, requestCircle, type CirclePick } from "@/lib/circle";
import type { Poll } from "@/lib/types";
import { Avatar } from "./Avatar";

/** What someone outside the circle sees instead of the poll. */
export function LockedCircle({ poll, canVote }: { poll: Poll; canVote: boolean | null }) {
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    if (canVote === false) {
      saveReturnTo(window.location.pathname + window.location.search);
      try {
        await continueWithGoogle();
      } catch {
        setError("Google sign-in isn't available right now.");
      }
      return;
    }
    setState("busy");
    setError(null);
    try {
      const status = await requestCircle(poll.creator);
      setState(status === "member" ? "idle" : "sent");
      announceCircleChange();
    } catch (e) {
      setState("idle");
      setError(circleErrorText(e));
    }
  }

  return (
    <div className="locked-circle">
      <span className="locked-icon" aria-hidden="true">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      </span>
      <h1 className="poll-question" id={`q-${poll.id}`}>
        This poll is for @{poll.creator}&apos;s circle
      </h1>
      <p className="poll-foot-note">Ask to join. Once @{poll.creator} accepts, you&apos;ll see the question and can vote.</p>
      {state === "sent" ? (
        <span className="chip chip-white">Request sent</span>
      ) : (
        <button type="button" className="post-btn press" onClick={ask} disabled={state === "busy"}>
          {canVote === false ? `Sign in to ask @${poll.creator}` : `Ask to join @${poll.creator}'s circle`}
        </button>
      )}
      {error && (
        <p className="poll-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** "@priya and 2 more picked this too", plus who picked what. Circle polls only. */
export function CirclePicks({ poll }: { poll: Poll }) {
  const [picks, setPicks] = useState<CirclePick[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let stale = false;
    getCirclePicks(poll.id)
      .then((p) => !stale && setPicks(p))
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [poll.id, poll.voteCount]);

  if (!picks || picks.length === 0) return null;
  const others = picks.filter((p) => !p.isMe);
  const sameAsMe = others.filter((p) => p.optionId === poll.myOptionId);
  const lead = sameAsMe[0] ?? others[0];
  if (!lead) return null;

  const summary =
    sameAsMe.length > 0
      ? `@${sameAsMe[0].username}${sameAsMe.length > 1 ? ` and ${sameAsMe.length - 1} more` : ""} picked this too`
      : poll.myOptionId
        ? "Nobody in the circle picked what you did. Bold."
        : `${others.length} of the circle voted`;

  return (
    <div className="circle-picks">
      <button type="button" className="circle-picks-summary" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="avatar-stack" aria-hidden="true">
          {(sameAsMe.length ? sameAsMe : others).slice(0, 3).map((p) => (
            <Avatar key={p.username} name={p.username} url={p.avatarUrl} size={26} />
          ))}
        </span>
        <span>{summary}</span>
        <span className="circle-picks-toggle">{open ? "Hide" : "Who picked what"}</span>
      </button>
      {open && (
        <ul className="circle-picks-list">
          {poll.options.map((o) => {
            const names = picks.filter((p) => p.optionId === o.id);
            return (
              <li key={o.id}>
                <strong>{o.text}</strong>
                <span>{names.length ? names.map((p) => (p.isMe ? "you" : `@${p.username}`)).join(", ") : "nobody yet"}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
