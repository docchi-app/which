"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { continueWithGoogle, saveReturnTo } from "@/lib/auth";
import { addFriend, announceCircleChange, circleErrorText, getCirclePicks, getFriendsVoted, type CirclePick, type FriendsVoted } from "@/lib/circle";
import type { Poll } from "@/lib/types";
import { recall, remember } from "@/lib/screen-cache";
import { Avatar } from "./Avatar";

/** What someone who isn't a friend (or not in the chosen lists) sees instead of the poll. */
export function LockedCircle({ poll, signedIn }: { poll: Poll; signedIn: boolean | null }) {
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    if (signedIn === false) {
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
      const status = await addFriend(poll.creator);
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
        This poll is for @{poll.creator}&apos;s friends
      </h1>
      <p className="poll-foot-note">Add @{poll.creator} as a friend. Once they accept, you&apos;ll see the question and can vote.</p>
      {state === "sent" ? (
        <span className="chip chip-white">Request sent</span>
      ) : (
        <button type="button" className="post-btn press" onClick={ask} disabled={state === "busy"}>
          {signedIn === false ? `Sign in to add @${poll.creator}` : `Add @${poll.creator} as a friend`}
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

/** "@priya and 2 more picked this too", plus who picked what. Friends-only polls only. */
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
        ? "No friend picked what you did. Bold."
        : `${others.length} ${others.length === 1 ? "friend" : "friends"} voted`;

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

/**
 * "@priya and 2 friends voted": who of your friends voted, never what they picked. Public and link polls.
 * top: the line under the creator's name before you vote; compact: in the card's footer line after.
 */
export function FriendsVotedRow({ poll, compact = false, top = false }: { poll: Poll; compact?: boolean; top?: boolean }) {
  // Remembered per poll, so the footer line is there the moment you vote.
  const [data, setData] = useState<FriendsVoted | null>(() => recall<FriendsVoted>(`fv:${poll.id}`, 5 * 60_000) ?? null);
  const voted = poll.myOptionId !== null;

  useEffect(() => {
    let stale = false;
    getFriendsVoted(poll.id)
      .then((d) => {
        remember(`fv:${poll.id}`, d);
        if (!stale) setData(d);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [poll.id, voted]);

  // The feed card is sized to fit the screen without scrolling. On a short screen where this line
  // would make it scroll, it stays hidden (it still shows in the footer after you vote).
  const fitRef = useRef<HTMLParagraphElement>(null);
  const shown = top && !!data && data.count > 0;
  useLayoutEffect(() => {
    const el = fitRef.current;
    const card = el?.closest<HTMLElement>(".poll-card");
    if (!shown || !el || !card) return;
    const check = () => {
      el.style.display = "";
      if (card.scrollHeight > card.clientHeight + 1) el.style.display = "none";
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(card);
    return () => ro.disconnect();
  }, [shown]);

  if (!data || data.count === 0) return null;
  const [first] = data.people;
  const rest = data.count - 1;
  if (top) {
    // Before you vote: "(faces) @priya +2 voted" under the creator's name.
    return (
      <p ref={fitRef} className="friends-voted-inline friends-voted-top">
        <span className="avatar-stack" aria-hidden="true">
          {data.people.slice(0, 3).map((p) => (
            <Avatar key={p.username} name={p.username} url={p.avatarUrl} size={20} />
          ))}
        </span>
        <span>
          <strong>@{first.username}</strong>
          {rest > 0 ? ` +${rest} voted` : " voted"}
        </span>
      </p>
    );
  }
  if (compact) {
    // In the card's footer line: "(faces) @priya +2 voted".
    return (
      <span className="friends-voted friends-voted-inline">
        <span className="avatar-stack" aria-hidden="true">
          {data.people.slice(0, 3).map((p) => (
            <Avatar key={p.username} name={p.username} url={p.avatarUrl} size={20} />
          ))}
        </span>
        <span>
          <strong>@{first.username}</strong>
          {rest > 0 ? ` +${rest} ${rest === 1 ? "friend" : "friends"} voted` : " voted"}
        </span>
      </span>
    );
  }
  return (
    <p className="friends-voted">
      <span className="avatar-stack" aria-hidden="true">
        {data.people.slice(0, 3).map((p) => (
          <Avatar key={p.username} name={p.username} url={p.avatarUrl} size={26} />
        ))}
      </span>
      <span>
        <strong>@{first.username}</strong>
        {rest > 0 ? ` and ${rest} ${rest === 1 ? "friend" : "friends"} voted` : " voted"}
      </span>
    </p>
  );
}
