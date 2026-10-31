"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { SignInRequired } from "@/lib/auth";
import { audienceLabel } from "@/lib/circle";
import { castVote } from "@/lib/polls";
import { asksForTag } from "@/lib/comments";
import { brainLine, brainReveal, brainWhyTitle, flagBrain, type BrainReveal } from "@/lib/brain";
import { useCountUp, useLiveCard, useNearScreen } from "@/lib/live";
import { formatCount, percentages, timeLeft } from "@/lib/format";
import type { Poll, Visibility, VoteResult } from "@/lib/types";
import { recordView, useCountView } from "@/lib/views";
import { CommentIcon, ShareIcon } from "./icons";
import { CirclePicks, FriendsVotedRow, LockedCircle } from "./CircleBits";
import { SnapPoll } from "./SnapCard";
import { NotificationPrompt } from "./Notifications";
import { useFitActions, ViewsAction } from "./ViewsAction";
import { useBackClose } from "@/lib/back";

// Sheets load only when they open: a feed of cards shouldn't carry them all up front.
const CommentsSheet = dynamic(() => import("./CommentsSheet").then((m) => m.CommentsSheet), { ssr: false });
// What changed after "Who sees it" (votes so far stay either way).
const whoSeesText = (v: Visibility) =>
  v === "public" ? "Now everyone can see it." : v === "circle" ? "Now friends only. It's left the public feed." : "Now link only. It's left the feeds.";
const WhoSeesSheet = dynamic(() => import("./WhoSeesSheet").then((m) => m.WhoSeesSheet), { ssr: false });
const ReportSheet = dynamic(() => import("./ReportSheet").then((m) => m.ReportSheet), { ssr: false });
const DeleteSnapSheet = dynamic(() => import("./DeleteSnapSheet").then((m) => m.DeleteSnapSheet), { ssr: false });

// Busy enough to say so: "🔥 41 in the last hour".
const HOT_VOTES = 5;
// Below this many votes, an unvoted card invites you to be early instead of showing the count.
const FEW_VOTES = 10;

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
  /** Signed in with Google: false for guests (their votes count once they sign in); null while unknown. */
  signedIn: boolean | null;
  /** Play the vote celebration on mount (returning from sign-in). */
  celebrate?: boolean;
  /** The viewer just posted this poll: nudge them to share it. */
  justCreated?: boolean;
  onVoted: (pollId: string, result: VoteResult) => void;
  /** The poll changed here (a new comment count). */
  onRefresh: (poll: Poll) => void;
  onNeedSignIn: (pollId: string, optionId: string) => void;
  /** A guest tapped "Sign in" to make their votes count. */
  onSaveVotes?: () => void;
  onShare: () => void;
  /** The viewer reported this poll. */
  onReported?: (pollId: string) => void;
  /** The viewer deleted their own snap. */
  onDeleted?: (pollId: string) => void;
  /** Open the comments straight away (a "new comments" notification). */
  openComments?: boolean;
};

/** Eithr's own polls carry a tick. */
export function VerifiedTick() {
  return (
    <span className="verified" role="img" aria-label="Verified">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </span>
  );
}

/** The poll with the viewer's own (not yet counted) vote added in. */
function withOwnVote(poll: Poll): Poll {
  return {
    ...poll,
    voteCount: poll.voteCount + 1,
    options: poll.options.map((o) => (o.id === poll.myOptionId && o.votes !== null ? { ...o, votes: o.votes + 1 } : o)),
  };
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
  signedIn,
  celebrate = false,
  justCreated = false,
  onVoted,
  onRefresh,
  onNeedSignIn,
  onSaveVotes,
  onShare,
  onReported,
  onDeleted,
  openComments = false,
}: Props) {
  // The pick being saved. The card switches to results the moment you tap;
  // the bars fill in when the server answers.
  const [lockingId, setLockingId] = useState<string | null>(null);
  const [justVoted, setJustVoted] = useState(celebrate);
  // The confetti, only while it bursts: spent pieces would otherwise stretch the card.
  const [burst, setBurst] = useState(celebrate);
  useEffect(() => {
    if (!burst) return;
    const t = window.setTimeout(() => setBurst(false), 1200);
    return () => window.clearTimeout(t);
  }, [burst]);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [commenting, setCommenting] = useState(openComments);
  // Comments opened from the "Who is it?" nudge start with "@" (the friend picker).
  const [commentStart, setCommentStart] = useState("");
  // Just voted an answer that asks to tag someone: "Who is it? 👀".
  const [tagNudge, setTagNudge] = useState(false);
  const [snapMenu, setSnapMenu] = useState(false);
  // My own post: who sees it (changed after posting), and the line that confirms it.
  const [choosingWho, setChoosingWho] = useState(false);
  const [whoNote, setWhoNote] = useState<string | null>(null);
  useEffect(() => {
    if (!whoNote) return;
    const t = setTimeout(() => setWhoNote(null), 4000);
    return () => clearTimeout(t);
  }, [whoNote]);
  // Back closes the ••• menu.
  const closeSnapMenu = useBackClose(snapMenu, () => setSnapMenu(false));
  const [deleting, setDeleting] = useState(false);
  // Read the clock once per card; closing mid-view is handled by cast_vote.
  const [now] = useState(() => Date.now());

  const voted = poll.myOptionId !== null;
  const closed = new Date(poll.closesAt).getTime() <= now;
  const showResults = voted || closed;
  const isTake = poll.kind === "hot_take";
  const isMystery = poll.kind === "mystery";
  const isSnap = poll.kind === "snap";
  const isBrain = poll.kind === "brain";
  const colors = isTake ? TAKE_COLORS : ANSWER_COLORS;

  // Views: this person counts once the card has been half on screen for a second (or
  // when they vote). Their own view shows at once, until the server's count moves.
  const cardRef = useRef<HTMLElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [selfView, setSelfView] = useState<number | null>(null);
  const countSelf = () => setSelfView(poll.viewCount ?? 0);
  useCountView(cardRef, poll.id, poll.isMine || poll.locked, countSelf);
  const serverViews = poll.viewCount ?? 0;
  const views = useCountUp(Math.max(serverViews + (selfView !== null && serverViews === selfView ? 1 : 0), poll.voteCount));
  // Live numbers while the card is on screen (the feed asks for all of them in one request).
  useLiveCard(cardRef, poll.id, !closed && !poll.locked);
  // Friends who voted and a snap's photo load once the card is about a screen away.
  const near = useNearScreen(cardRef);

  // A Brain break's right answer and why, once you've answered (a guest sends the pick they made).
  const [reveal, setReveal] = useState<BrainReveal | null>(null);
  const [flagged, setFlagged] = useState<"no" | "sending" | "yes">("no");
  useEffect(() => {
    if (!isBrain || !showResults) return;
    let live = true;
    brainReveal(poll.id, signedIn === false ? poll.myOptionId : null).then((r) => {
      if (!live) return;
      setReveal(r);
      if (r?.flagged) setFlagged("yes");
    });
    return () => {
      live = false;
    };
  }, [isBrain, showResults, poll.id, poll.myOptionId, signedIn]);

  // Other people's votes landing: "+3" pops on the card for a moment.
  const [landed, setLanded] = useState(0);
  const lastCount = useRef(poll.voteCount);
  const ownVoteAt = useRef(0);
  useEffect(() => {
    const more = poll.voteCount - lastCount.current;
    lastCount.current = poll.voteCount;
    if (more <= 0 || Date.now() - ownVoteAt.current < 3000) return;
    setLanded(more); // a live update arrived: show it, briefly
    const t = window.setTimeout(() => setLanded(0), 1600);
    return () => window.clearTimeout(t);
  }, [poll.voteCount]);

  async function vote(optionId: string) {
    if (lockingId || voted) return;
    if (!poll.isMine && recordView(poll.id)) countSelf();
    setLockingId(optionId);
    setError(null);
    ownVoteAt.current = Date.now();
    try {
      const result = await castVote(poll.id, optionId);
      ownVoteAt.current = Date.now();
      // A tiny buzz when the vote locks in (Android; iPhone browsers don't vibrate).
      try {
        navigator.vibrate?.(10);
      } catch {}
      setJustVoted(true);
      setBurst(true);
      onVoted(poll.id, result);
      const answer = poll.options.find((o) => o.id === optionId)?.text ?? "";
      if (signedIn && asksForTag(answer)) setTagNudge(true);
    } catch (e) {
      if (e instanceof SignInRequired) onNeedSignIn(poll.id, optionId);
      else {
        console.error(e);
        setError(
          /slow_down/.test((e as Error)?.message ?? "")
            ? "Whoa, speedy! Take a short break and try again in a few minutes."
            : "That vote didn't go through. Try again?",
        );
      }
    } finally {
      setLockingId(null);
    }
  }

  // A guest's vote stays out of the totals until they sign in, but they should
  // still see themselves in the results.
  const guestVote = signedIn === false && voted;
  const shown = guestVote ? withOwnVote(poll) : poll;
  const pcts = percentages(shown.options.map((o) => o.votes ?? 0));
  const mineId = poll.myOptionId ?? lockingId;
  const mineIndex = poll.options.findIndex((o) => o.id === mineId);
  const shownVotes = useCountUp(shown.voteCount);
  const votesLabel = `${formatCount(shownVotes)} ${shownVotes === 1 ? "vote" : "votes"}`;
  const recent = !closed ? (poll.recentVotes ?? 0) : 0;
  const hotLabel = recent >= HOT_VOTES ? ` · 🔥 ${formatCount(recent)} in the last hour` : "";
  // A handful of votes reads as "nobody's here"; before voting, say it as an invitation.
  const beforeVoteLabel =
    poll.voteCount === 0 ? "Be the first to vote" : poll.voteCount < FEW_VOTES ? "Be one of the first to vote" : votesLabel;
  const spice = isTake && showResults ? spiciness(pcts) : null;
  const isCircle = poll.visibility === "circle";
  // The action row never grows or spills: it makes room only when it has to.
  useFitActions(actionsRef, [showResults, lockingId, views, poll.commentCount, poll.isMine, poll.isSystem]);

  if (poll.locked) {
    return (
      <article ref={cardRef} className="poll-card poll-locked" aria-labelledby={`q-${poll.id}`} data-poll={poll.id}>
        <div className="poll-meta">
          <span className="chip chip-small chip-circle">Friends</span>
          <span className="poll-by">
            by{" "}
            <Link href={`/u/${poll.creator}`} className="creator-link">
              @{poll.creator}
            </Link>
          </span>
        </div>
        <LockedCircle poll={poll} signedIn={signedIn} />
      </article>
    );
  }

  const brainRight = isBrain && reveal ? reveal.right ?? mineId === reveal.optionId : null;
  // The answer most people fell for, for "Send to someone who'll say …".
  const trap = isBrain && reveal ? poll.options.map((o, i) => ({ o, p: pcts[i] })).filter((x) => x.o.id !== reveal.optionId).sort((a, b) => b.p - a.p)[0]?.o.text : undefined;
  const withYou = !showResults
    ? "Locking in your pick…"
    : isBrain
      ? reveal && brainRight !== null
        ? brainLine(brainRight, reveal.rightPct)
        : "Checking the answer…"
    : shown.voteCount === 1
      ? "First vote. You set the trend!"
      : isTake
        ? `You're with the ${pcts[mineIndex]}% who ${mineIndex === 0 ? "agree" : "disagree"}!`
        : `You're with the ${pcts[mineIndex]}%!`;

  return (
    <article ref={cardRef} className={`poll-card feed-card poll-${poll.kind}`} aria-labelledby={`q-${poll.id}`} data-poll={poll.id}>
      {landed > 0 && (
        <span className="votes-landed" aria-hidden="true">
          +{landed}
        </span>
      )}
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
      {justCreated && (
        <NotificationPrompt
          pitch={
            <>
              <strong>Get a ping</strong> when votes come in.
            </>
          }
        />
      )}
      {/* A snap shows who posted it on its photo. */}
      {!isSnap && (
        <div className="poll-meta">
          <span className={`chip ${isBrain ? "chip-brain" : poll.kind === "classic" || poll.featuredToday ? "chip-sun" : "chip-white"}`}>
            {isBrain ? (
              <span aria-hidden="true">🧠</span>
            ) : isTake ? (
              <ChiliIcon />
            ) : isMystery ? (
              <span aria-hidden="true">?</span>
            ) : (
              <span className="live-dot" aria-hidden="true" />
            )}
            {tag}
          </span>
          <span className="poll-by">
            {poll.visibility === "link" && <span className="chip chip-small chip-link">Link only</span>}
            {isCircle && !(tag.includes("Friend") && !poll.isMine) && (
              <span className="chip chip-small chip-circle" title={poll.audience ?? undefined}>
                {poll.isMine ? audienceLabel(poll.audience) : "Friends"}
              </span>
            )}{" "}
            by{" "}
            {poll.isSystem ? (
              <strong>@{poll.creator}</strong>
            ) : (
              <Link href={`/u/${poll.creator}`} className="creator-link">
                @{poll.creator}
              </Link>
            )}
            {poll.isSystem && <VerifiedTick />} · {timeLeft(poll.closesAt, now)}
          </span>
        </div>
      )}
      {/* Friends who voted, before you do (never what they picked). After voting it moves to the footer line. */}
      {!isSnap && !isCircle && signedIn && !voted && !poll.isMine && !closed && near && <FriendsVotedRow poll={poll} top />}

      {isSnap ? (
        <SnapPoll
          poll={poll}
          sub={`${isCircle ? (poll.isMine ? audienceLabel(poll.audience) : "Friends") : poll.visibility === "link" ? "Link only" : "Everyone"} · ${timeLeft(poll.closesAt, now)}`}
          closed={closed}
          near={near}
          showResults={showResults}
          pcts={pcts}
          mineId={mineId}
          onVote={vote}
          onMore={poll.isMine ? () => (snapMenu ? closeSnapMenu() : setSnapMenu(true)) : undefined}
          menu={
            snapMenu && (
              <>
                <div className="snap-menu-backdrop" aria-hidden="true" onClick={closeSnapMenu} />
                <div className="snap-menu" role="menu" aria-label="Snap options">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closeSnapMenu();
                      onShare();
                    }}
                  >
                    <ShareIcon size={18} /> Share snap
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closeSnapMenu();
                      setChoosingWho(true);
                    }}
                  >
                    👁 Who sees it
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="snap-menu-danger"
                    onClick={() => {
                      closeSnapMenu();
                      setDeleting(true);
                    }}
                  >
                    🗑️ Delete snap
                  </button>
                </div>
              </>
            )
          }
        />
      ) : isMystery && !poll.question ? (
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
        <>
          {isBrain && !showResults && !lockingId && <p className="brain-hook">Dimaag lagao 👀 · 1 sec, socho mat</p>}
          <h1 id={`q-${poll.id}`} className="poll-question">
            {poll.question}
          </h1>
        </>
      )}

      {!showResults && !lockingId ? (
        <>
          {/* A snap's answers are on its photo. */}
          {!isSnap && (
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
          )}
          <p className="poll-foot-note">
            {beforeVoteLabel}
            {hotLabel} · {isTake ? "vote to see how spicy it is" : isBrain ? "the answer shows after you vote" : "vote to see the results"}
          </p>
          {isCircle && !poll.isMine && (
            <p className="circle-note">@{poll.creator}&apos;s friends can see your pick.</p>
          )}
        </>
      ) : (
        <>
          {spice && (
            <div className="spice-meter">
              <strong>Spice meter</strong>
              <span className="spice-track" aria-hidden="true">
                <span className="spice-fill" style={{ width: `${spice.split}%` }} />
              </span>
              <strong>{spice.label}</strong>
            </div>
          )}
          {!isSnap && (
            <ul className="results" aria-label="Results">
              {poll.options.map((o, i) => {
                const mine = o.id === mineId;
                const right = isBrain && reveal?.optionId === o.id;
                return (
                  <li key={o.id} className={`result${mine ? " result-mine" : ""}${right ? " result-right" : ""}${isBrain && reveal && mine && !right ? " result-wrong" : ""}`}>
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
                        {!isBrain && mine && showResults && <span className="result-check" aria-hidden="true">✓</span>}
                        {right && (
                          <span className="result-check result-check-right" aria-label="Right answer">
                            ✓
                          </span>
                        )}
                        {o.text}
                        {mine && <span className="chip chip-small">{guestVote && !closed ? "Your pick · not counted yet" : "Your pick"}</span>}
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
          )}
          {(voted || lockingId) && (
            <div className={`with-you${justVoted ? " pop" : ""}${showResults ? "" : " locking"}`} role="status">
              {showResults && !isBrain && <span aria-hidden="true">🎉 </span>}
              {withYou}
              {burst &&
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
          {isBrain && reveal && (
            <div className="brain-why">
              <b>{brainWhyTitle(reveal.sort)}</b>
              <p>{reveal.why}</p>
              {voted && brainRight !== null && (
                <button type="button" className="btn btn-white press brain-share" onClick={onShare}>
                  <ShareIcon size={18} />
                  {brainRight && trap ? `Send to someone who'll say ${trap} 😏` : "Trap a friend with this 🪤"}
                </button>
              )}
              {signedIn && voted && (
                <button
                  type="button"
                  className="brain-flag"
                  disabled={flagged !== "no"}
                  onClick={async () => {
                    setFlagged("sending");
                    try {
                      await flagBrain(poll.id);
                      setFlagged("yes");
                    } catch {
                      setFlagged("no");
                    }
                  }}
                >
                  {flagged === "yes" ? "Thanks, we'll double-check it ✓" : "Wrong answer? Tell us"}
                </button>
              )}
            </div>
          )}
          {spice && spice.split >= 70 && voted && (
            <button type="button" className="btn btn-white press settle-btn" onClick={onShare}>
              <ShareIcon size={18} />
              Too close to call. Settle this
            </button>
          )}
          {isCircle && showResults && (voted || poll.isMine) && <CirclePicks poll={poll} />}
          <div className="result-foot">
            {!isCircle && signedIn && (voted || poll.isMine || closed) && near && <FriendsVotedRow poll={poll} compact />}
            <p className="poll-foot-note">
              {!closed && showResults && <span className="live-dot live-dot-small" aria-hidden="true" />}
              {guestVote && !closed
                ? poll.voteCount === 0
                  ? "Only you so far · not counted yet"
                  : `${formatCount(poll.voteCount)} ${poll.voteCount === 1 ? "vote" : "votes"} · live (yours isn't in yet)`
                : `${votesLabel} · ${closed ? "final results" : showResults ? "live" : "counting…"}${hotLabel}`}
            </p>
          </div>
          {guestVote && !closed && (
            <div className="count-strip">
              <p>Your vote isn&apos;t in the total yet. One tap with Google and it counts.</p>
              {onSaveVotes && (
                <button type="button" className="count-strip-btn press" onClick={onSaveVotes}>
                  Count my vote
                </button>
              )}
            </div>
          )}
        </>
      )}

      {error && (
        <p className="poll-error" role="alert">
          {error}
        </p>
      )}

      {tagNudge && (
        <div className="tag-nudge" role="status">
          <b>Who is it? 👀</b>
          <span>Tag them in a comment, they&apos;ll see it.</span>
          <span className="tag-nudge-go">
            <button type="button" className="ppl-mini press" onClick={() => setTagNudge(false)}>
              Not now
            </button>
            <button
              type="button"
              className="ppl-mini tag-nudge-tag press"
              onClick={() => {
                setTagNudge(false);
                setCommentStart("@");
                setCommenting(true);
              }}
            >
              @ Tag a friend
            </button>
          </span>
        </div>
      )}

      <div ref={actionsRef} className="poll-actions">
        <button
          type="button"
          className="ghost-action"
          aria-label={poll.commentCount ? `${poll.commentCount} ${poll.commentCount === 1 ? "comment" : "comments"}` : "Comments"}
          data-tip="comments"
          onClick={() => {
            setCommentStart("");
            setCommenting(true);
          }}
        >
          <CommentIcon />
          {poll.commentCount > 0 && poll.commentCount}
        </button>
        <button type="button" className="ghost-action" aria-label="Share" onClick={onShare}>
          <ShareIcon />
          <span className="share-label">Share</span>
        </button>
        <ViewsAction count={views} mine={poll.isMine} />
        {!poll.isMine && !poll.isSystem && (
          <button type="button" className="more-btn" onClick={() => setReporting(true)} aria-label="Report this poll" title="Report">
            <MoreIcon />
          </button>
        )}
        {poll.isMine && !isSnap && !closed && (
          <button type="button" className="more-btn" onClick={() => setChoosingWho(true)} aria-label="Who sees this poll" title="Who sees it">
            <MoreIcon />
          </button>
        )}
      </div>
      {commenting && (
        <CommentsSheet
          pollId={poll.id}
          colors={colors}
          signedIn={signedIn}
          startWith={commentStart}
          onClose={() => setCommenting(false)}
          onCount={(n) => n !== poll.commentCount && onRefresh({ ...poll, commentCount: n })}
        />
      )}
      {whoNote && (
        <p className="who-toast" role="status">
          {whoNote}
        </p>
      )}
      {choosingWho && (
        <WhoSeesSheet
          pollId={poll.id}
          snap={isSnap}
          visibility={poll.visibility}
          onClose={() => setChoosingWho(false)}
          onSaved={(v) => {
            onRefresh({ ...poll, visibility: v, audience: v === "circle" ? "Whole circle" : null });
            setWhoNote(whoSeesText(v));
          }}
        />
      )}
      {deleting && <DeleteSnapSheet pollId={poll.id} onClose={() => setDeleting(false)} onDeleted={() => onDeleted?.(poll.id)} />}
      {reporting && (
        <ReportSheet
          target={{ kind: "poll", pollId: poll.id }}
          canReport={signedIn}
          onClose={() => setReporting(false)}
          onReported={() => onReported?.(poll.id)}
        />
      )}
    </article>
  );
}

function MoreIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2.2" />
      <circle cx="12" cy="12" r="2.2" />
      <circle cx="19" cy="12" r="2.2" />
    </svg>
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
