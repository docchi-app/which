"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { continueWithGoogle, guestPicks, onUserChange, saveReturnTo, isSignedIn } from "@/lib/auth";
import { checkUsername, type UsernameProblem } from "@/lib/create";
import { formatCount, percentages, timeLeft } from "@/lib/format";
import { deletePoll, fetchMyPolls, setPollVisibility } from "@/lib/polls";
import { activityText, fetchActivity, markActivitySeen, type Activity } from "@/lib/activity";
import { compactCount, getMyProfile, PROFILE_CHANGED, updateUsername, type Profile } from "@/lib/profile";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { Poll, Visibility } from "@/lib/types";
import { BottomNav } from "./BottomNav";
import { NotificationPrompt } from "./Notifications";
import { ANSWER_COLORS, VerifiedTick } from "./PollCard";
import { ShareSheet } from "./ShareSheet";
import { audienceLabel, getMyCircle } from "@/lib/circle";
import { fetchStreak, type Streak } from "@/lib/streak";

type Tab = "mine" | "voted";

const NAME_PROBLEMS: Record<string, string> = {
  format: "3 to 20 letters, numbers or _",
  reserved: "That one's reserved.",
  blocked: "Let's pick something friendlier.",
  taken: "Taken! These are free:",
  too_soon: "You can change your username once a week.",
};

const cleanName = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);

export function ProfileScreen() {
  // undefined: still checking; null: signed out.
  const [signedIn, setSignedIn] = useState<boolean | undefined>(isSupabaseConfigured ? undefined : false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [friends, setFriends] = useState<number | null>(null);
  const [streak, setStreak] = useState<Streak | null>(null);
  // Polls voted on as a guest (not counted until they sign in).
  const [guestVotes, setGuestVotes] = useState(0);
  const [tab, setTab] = useState<Tab>("mine");
  const [polls, setPolls] = useState<Poll[] | null>(null);
  const [sharing, setSharing] = useState<Poll | null>(null);
  const [error, setError] = useState<string | null>(null);
  // New votes / comments since the last visit; shown for this visit, then marked seen.
  const [activity, setActivity] = useState<Activity | null>(null);

  useEffect(() => {
    // Links like /profile?tab=voted open that tab; the old Circle tab is now /friends.
    const wanted = new URLSearchParams(window.location.search).get("tab");
    if (wanted === "circle") window.location.replace("/friends");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    else if (wanted === "voted") setTab(wanted);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    return onUserChange((user) => {
      setSignedIn(isSignedIn(user));
      setGuestVotes(user?.is_anonymous ? guestPicks().length : 0);
    });
  }, []);

  const loadProfile = useCallback(() => {
    getMyProfile()
      .then(setProfile)
      .catch((e) => {
        console.error(e);
        setError("Couldn't load your profile. Check your connection.");
      });
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    loadProfile();
    getMyCircle()
      .then((c) => setFriends(c.members.length))
      .catch(() => {});
    fetchStreak()
      .then(setStreak)
      .catch(() => {});
    let timer = 0;
    fetchActivity().then((a) => {
      setActivity(a);
      // Give it a moment on screen before it counts as seen.
      if (a.votes + a.comments > 0) timer = window.setTimeout(markActivitySeen, 2500);
    });
    return () => window.clearTimeout(timer);
  }, [signedIn, loadProfile]);

  // The "Pick your @name" sheet can change the name while this screen is open.
  useEffect(() => {
    window.addEventListener(PROFILE_CHANGED, loadProfile);
    return () => window.removeEventListener(PROFILE_CHANGED, loadProfile);
  }, [loadProfile]);

  useEffect(() => {
    if (!signedIn) return;
    let stale = false;
    fetchMyPolls(tab)
      .then((list) => !stale && setPolls(list))
      .catch((e) => {
        console.error(e);
        if (!stale) setPolls([]);
      });
    return () => {
      stale = true;
    };
  }, [signedIn, tab]);

  function pickTab(next: Tab) {
    if (next === tab) return;
    setPolls(null);
    setTab(next);
  }

  async function signIn() {
    saveReturnTo("/profile");
    try {
      await continueWithGoogle();
    } catch {
      setError("Google sign-in isn't available right now. Try again in a bit.");
    }
  }

  const updatePoll = (id: string, patch: Partial<Poll> | null) =>
    setPolls((list) => list?.flatMap((p) => (p.id !== id ? [p] : patch ? [{ ...p, ...patch }] : [])) ?? null);

  return (
    <div className="screen profile-screen">
      <div className="profile-banner" aria-hidden="true">
        <span className="banner-sun" />
        <span className="banner-tile" />
      </div>
      <Link href="/settings" className="icon-btn icon-btn-white press settings-btn" aria-label="Settings">
        <GearIcon />
      </Link>

      {signedIn === false ? (
        <section className="poll-card soon profile-signin">
          <h1 className="poll-question">Your polls live here</h1>
          <p className="poll-foot-note">
            {isSupabaseConfigured
              ? guestVotes > 0
                ? `You've voted on ${guestVotes} ${guestVotes === 1 ? "poll" : "polls"} as a guest. Sign in so your votes count, and to post polls and see how many votes you got.`
                : "Sign in to see the polls you made, the ones you voted on, and how many votes you got."
              : "Profiles need Supabase. Add the keys to try this screen."}
          </p>
          {isSupabaseConfigured && (
            <button type="button" className="post-btn post-btn-dark press" onClick={signIn}>
              Sign in with Google
            </button>
          )}
        </section>
      ) : (
        <>
          <ProfileHead profile={profile} onRenamed={loadProfile} />

          <dl className="stat-tiles stat-tiles-4">
            <div className="stat" style={{ background: "var(--sky)" }}>
              <dt>Polls</dt>
              <dd>{profile ? compactCount(profile.pollsMade) : "–"}</dd>
            </div>
            <div className="stat" style={{ background: "var(--mint)" }}>
              <dt>Votes got</dt>
              <dd>{profile ? compactCount(profile.votesReceived) : "–"}</dd>
            </div>
            <div className="stat stat-link" style={{ background: "var(--sun)" }}>
              <dt>
                <Link href="/friends" className="stat-cover">
                  Friends
                </Link>
              </dt>
              <dd>{friends === null ? "–" : compactCount(friends)}</dd>
            </div>
            <div className="stat" style={{ background: "var(--coral)" }} title={streak ? `Best: ${streak.best} days` : undefined}>
              <dt>Streak</dt>
              <dd>{streak ? `🔥${streak.current}` : "–"}</dd>
            </div>
          </dl>

          {signedIn && <NotificationPrompt />}

          <div role="tablist" aria-label="Profile lists" className="tabs profile-tabs">
            {(
              [
                ["mine", "My polls"],
                ["voted", "Voted"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={tab === id}
                className="tab press"
                onClick={() => pickTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {error && (
            <p className="poll-error profile-error" role="alert">
              {error}
            </p>
          )}

          {tab === "mine" && activity && activity.votes + activity.comments > 0 && (
            <p className="activity-summary" role="status">
              <span aria-hidden="true">✨</span> Since your last visit: {activityText(activity)}
            </p>
          )}

          <ul className="profile-list">
            {!polls ? (
              [0, 1, 2].map((n) => <li key={n} className="skeleton profile-skeleton" />)
            ) : polls.length === 0 ? (
              <li className="profile-empty">
                {tab === "mine" ? (
                  <>
                    <strong>No polls yet.</strong> Ask something people can&apos;t resist.
                    <Link href="/create" className="btn btn-coral press">
                      Make a poll
                    </Link>
                  </>
                ) : (
                  <>
                    <strong>Nothing voted yet.</strong> Your picks will show up here.
                    <Link href="/" className="btn btn-white press">
                      Go vote
                    </Link>
                  </>
                )}
              </li>
            ) : (
              polls.map((p, i) => (
                <ProfilePoll
                  key={p.id}
                  poll={p}
                  index={i}
                  news={tab === "mine" ? activity?.polls[p.id] : undefined}
                  onShare={() => setSharing(p)}
                  onChange={(patch) => {
                    updatePoll(p.id, patch);
                    if (!patch) loadProfile();
                  }}
                />
              ))
            )}
          </ul>
        </>
      )}

      <BottomNav current="profile" />
      {sharing && <ShareSheet poll={sharing} onClose={() => setSharing(null)} />}
    </div>
  );
}

/** Avatar, @username (editable), joined date. */
function ProfileHead({ profile, onRenamed }: { profile: Profile | null; onRenamed: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [checked, setChecked] = useState<{ name: string; problem: UsernameProblem; suggestions: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const current = profile?.username ?? null;
  const initial = (current ?? "?").charAt(0).toUpperCase();
  const joined = profile ? new Date(profile.joined).toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : "";

  useEffect(() => {
    if (!editing || name.length < 3 || name === current || checked?.name === name) return;
    const timer = window.setTimeout(async () => {
      try {
        setChecked({ name, ...(await checkUsername(name)) });
      } catch {
        // The server checks again on Save.
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [editing, name, current, checked]);

  const status = !editing
    ? null
    : name === current
      ? null
      : name.length < 3
        ? { problem: "format", suggestions: [] as string[] }
        : checked?.name === name
          ? checked
          : undefined;

  async function save() {
    if (saving || status?.problem !== "ok") return;
    setSaving(true);
    setProblem(null);
    try {
      await updateUsername(name);
      setEditing(false);
      onRenamed();
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="profile-head">
        {profile?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="avatar" src={profile.avatarUrl} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="avatar avatar-initial" aria-hidden="true">
            {initial}
          </span>
        )}
        <div className="profile-name">
          <span className="profile-handle">{current ? `@${current}` : profile ? "Pick a username" : " "}</span>
          <span className="muted">{joined && `Joined ${joined}`}</span>
        </div>
        {profile && !editing && (
          <button
            type="button"
            className="btn btn-white press profile-edit-btn"
            onClick={() => {
              setName(current ?? "");
              setChecked(null);
              setProblem(null);
              setEditing(true);
            }}
          >
            Edit
          </button>
        )}
      </section>
      {editing && (
        <div className="profile-edit">
          <div className="name-input-wrap">
            <span aria-hidden="true">@</span>
            <input
              className="name-input"
              aria-label="Username"
              autoFocus
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={name}
              onChange={(e) => {
                setProblem(null);
                setName(cleanName(e.target.value));
              }}
            />
          </div>
          <div className="name-status" aria-live="polite">
            {problem && <span className="name-bad">{NAME_PROBLEMS[problem] ?? "Couldn't save. Try again?"}</span>}
            {!problem && status === undefined && <span className="muted">Checking…</span>}
            {!problem && status?.problem === "ok" && <span className="name-ok">@{name} is free.</span>}
            {!problem && status && status.problem !== "ok" && (
              <>
                <span className="name-bad">{NAME_PROBLEMS[status.problem]}</span>
                {status.suggestions.length > 0 && (
                  <span className="name-chips">
                    {status.suggestions.map((s) => (
                      <button key={s} type="button" className="name-chip press" onClick={() => setName(s)}>
                        @{s}
                      </button>
                    ))}
                  </span>
                )}
              </>
            )}
          </div>
          <div className="profile-edit-actions">
            <button type="button" className="btn btn-coral press" onClick={save} disabled={saving || status?.problem !== "ok"}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn btn-white press" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** One row in My polls / Voted, with share, visibility and delete for your own. */
export function ProfilePoll({
  poll,
  index,
  onShare,
  onChange,
  news,
}: {
  poll: Poll;
  index: number;
  /** New votes / comments on this poll since the last visit (My polls only). */
  news?: { votes: number; comments: number };
  onShare: () => void;
  /** New fields, or null when the poll was deleted. */
  onChange: (patch: Partial<Poll> | null) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  const closed = new Date(poll.closesAt).getTime() <= now;
  const counts = poll.options.map((o) => o.votes ?? 0);
  const hasCounts = poll.options.every((o) => o.votes !== null) && poll.voteCount > 0;
  const pcts = percentages(counts);
  const colors = poll.kind === "hot_take" ? ["var(--sun)", "var(--sky)"] : ANSWER_COLORS;
  const mine = poll.options.find((o) => o.id === poll.myOptionId);
  const votes = `${formatCount(poll.voteCount)} ${poll.voteCount === 1 ? "vote" : "votes"}`;
  const meta = poll.isMine
    ? [votes, poll.shareCount ? `${formatCount(poll.shareCount)} shares` : null, closed ? "closed" : timeLeft(poll.closesAt, now)]
    : [mine ? `You picked ${mine.text}` : null, votes];

  async function run(action: () => Promise<void>, patch: Partial<Poll> | null) {
    setBusy(true);
    setFailed(null);
    try {
      await action();
      onChange(patch);
    } catch (e) {
      console.error(e);
      setFailed("That didn't work. Try again?");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }


  return (
    <li className="profile-poll" data-news={news || undefined} style={{ animationDelay: `${0.05 + index * 0.06}s` }}>
      <Link href={`/p/${poll.id}`} className="profile-poll-link">
        <span className="profile-poll-top">
          <span className="profile-poll-q">{poll.question ?? poll.teaser}</span>
          <span className={`chip chip-small ${closed ? "chip-closed" : "chip-mint"}`}>{closed ? "Closed" : "Live"}</span>
        </span>
        <span className="profile-poll-tags">
          {poll.kind === "hot_take" && <span className="chip chip-small">Hot take</span>}
          {poll.kind === "mystery" && <span className="chip chip-small">Mystery</span>}
          {poll.visibility === "link" && <span className="chip chip-small chip-link">Link only</span>}
          {poll.visibility === "circle" && (
            <span className="chip chip-small chip-circle">{poll.isMine ? audienceLabel(poll.audience) : "Friends"}</span>
          )}
          {!poll.isMine && (
            <span className="profile-poll-by">
              by @{poll.creator}
              {poll.isSystem && <VerifiedTick />}
            </span>
          )}
        </span>
        {hasCounts && (
          <span className="segments" aria-hidden="true">
            {pcts.map((w, i) => (w > 0 ? <span key={i} style={{ width: `${w}%`, background: colors[i] }} /> : null))}
          </span>
        )}
        <span className="profile-poll-meta">
          {news && <span className="activity-chip">{activityText(news)}</span>} {meta.filter(Boolean).join(" · ")}
        </span>
      </Link>

      {poll.isMine && (
        <div className="profile-poll-actions">
          {confirming ? (
            <>
              <span className="confirm-text">Delete this poll for everyone?</span>
              <button type="button" className="mini-btn mini-btn-danger" disabled={busy} onClick={() => run(() => deletePoll(poll.id), null)}>
                Delete
              </button>
              <button type="button" className="mini-btn" onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </>
          ) : (
            <>
              <button type="button" className="mini-btn" onClick={onShare}>
                Share
              </button>
              <label className="mini-select">
                <span className="sr-only">Who can see it</span>
                <select
                  value={poll.visibility}
                  disabled={busy}
                  onChange={(e) => {
                    const v = e.target.value as Visibility;
                    run(() => setPollVisibility(poll.id, v), { visibility: v, audience: v === "circle" ? "Whole circle" : null });
                  }}
                >
                  <option value="public">Everyone</option>
                  <option value="circle">Friends</option>
                  <option value="link">Only with link</option>
                </select>
              </label>
              <button type="button" className="mini-btn mini-btn-danger-text" onClick={() => setConfirming(true)}>
                Delete
              </button>
            </>
          )}
        </div>
      )}
      {failed && (
        <p className="poll-error" role="alert">
          {failed}
        </p>
      )}
    </li>
  );
}

function GearIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  );
}
