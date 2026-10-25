"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isSignedIn, continueWithGoogle, onUserChange, saveReturnTo } from "@/lib/auth";
import {
  acceptInvite,
  addFriend,
  announceCircleChange,
  blockUser,
  circleErrorText,
  friendStatus,
  getPublicProfile,
  respondRequest,
  unblockUser,
  unfriend,
  type PublicProfile,
} from "@/lib/circle";
import { fetchProfilePolls } from "@/lib/polls";
import { compactCount } from "@/lib/profile";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { Poll } from "@/lib/types";
import { Avatar } from "./Avatar";
import { BestRankBadge } from "./BestRankBadge";
import { BottomNav } from "./BottomNav";
import { ProfilePoll } from "./ProfileScreen";
import { ReportSheet } from "./ReportSheet";
import { ShareSheet } from "./ShareSheet";
import { SignInNote } from "./SignInSheet";

/** /u/<name>: someone's public polls, and adding them as a friend. ?invite=<code> makes you friends. */
export function PublicProfileScreen({ username }: { username: string }) {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(isSupabaseConfigured ? null : false);
  // undefined: loading · null: no such person
  const [person, setPerson] = useState<PublicProfile | null | undefined>(undefined);
  const [polls, setPolls] = useState<Poll[] | null>(null);
  const [sharing, setSharing] = useState<Poll | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [confirmUnfriend, setConfirmUnfriend] = useState(false);
  // Just became friends through their invite link.
  const [welcomed, setWelcomed] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    return onUserChange((user) => setSignedIn(isSignedIn(user)));
  }, []);

  const load = useCallback(() => {
    getPublicProfile(username)
      .then((p) => {
        if (p?.isMe) router.replace("/profile");
        else setPerson(p);
      })
      // Offline isn't "no such person": keep waiting (the offline bar says why).
      .catch(() => navigator.onLine && setPerson(null));
  }, [username, router]);

  useEffect(() => {
    if (signedIn === null && isSupabaseConfigured) return; // wait to know who's looking
    const url = new URL(window.location.href);
    const invite = url.searchParams.get("invite");
    if (signedIn && invite) {
      // Opened their invite link: friends straight away, then forget the code.
      url.searchParams.delete("invite");
      window.history.replaceState(window.history.state, "", url);
      acceptInvite(username, invite)
        .then((r) => {
          if (r === "member") {
            setWelcomed(true);
            announceCircleChange();
          }
        })
        .catch((e) => setError(circleErrorText(e)))
        .finally(load);
    } else load();
    fetchProfilePolls(username)
      .then(setPolls)
      .catch(() => setPolls([]));
  }, [signedIn, username, load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
      announceCircleChange();
    } catch (e) {
      setError(circleErrorText(e));
    } finally {
      setBusy(false);
      setConfirmBlock(false);
      setConfirmUnfriend(false);
    }
  }

  async function signIn() {
    // Keep ?invite=… so the friendship happens on the way back.
    saveReturnTo(window.location.pathname + window.location.search);
    try {
      await continueWithGoogle();
    } catch {
      setError("Google sign-in isn't available right now. Try again in a bit.");
    }
  }

  if (person === null) {
    return (
      <div className="screen">
        <section className="poll-card soon">
          <h1 className="poll-question">No one here</h1>
          <p className="poll-foot-note">There&apos;s no @{username} on Docchi, or they&apos;re not available.</p>
          <Link href="/" className="btn btn-coral press">
            Back to the feed
          </Link>
        </section>
        <BottomNav />
      </div>
    );
  }

  const status = person ? friendStatus(person.theirCircle, person.myCircle) : "none";
  const invited = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("invite");
  const joined = person ? new Date(person.joined).toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : "";

  return (
    <div className="screen profile-screen">
      <div className="profile-banner" aria-hidden="true">
        <span className="banner-sun" />
        <span className="banner-tile" />
      </div>

      <section className="profile-head">
        {person ? (
          <Avatar name={person.username} url={person.avatarUrl} size={88} />
        ) : (
          <span className="avatar avatar-initial skeleton" aria-hidden="true" />
        )}
        <div className="profile-name">
          <span className="profile-handle">@{username}</span>
          <span className="muted">{joined && `Joined ${joined}`}</span>
          {person && <BestRankBadge name={person.username} />}
        </div>
      </section>

      <dl className="stat-tiles">
        <div className="stat" style={{ background: "var(--sky)" }}>
          <dt>Public polls</dt>
          <dd>{person ? compactCount(person.publicPolls) : "–"}</dd>
        </div>
        <div className="stat" style={{ background: "var(--mint)" }}>
          <dt>Votes got</dt>
          <dd>{person ? compactCount(person.votesReceived) : "–"}</dd>
        </div>
        <div className="stat" style={{ background: "var(--sun)" }}>
          <dt>Friends</dt>
          <dd>{person ? compactCount(person.circleSize) : "–"}</dd>
        </div>
      </dl>

      {person && (
        <section className="circle-cta">
          {welcomed && (
            <p className="circle-welcome" role="status">
              You and @{person.username} are friends now 🎉
            </p>
          )}

          {status === "incoming" && !person.blockedByMe && (
            <div className="circle-incoming" role="status">
              <span>
                <strong>@{person.username}</strong> wants to be friends.
              </span>
              <div className="person-actions">
                <button type="button" className="mini-btn mini-btn-mint" disabled={busy} onClick={() => act(() => respondRequest(person.username, true))}>
                  Accept
                </button>
                <button type="button" className="mini-btn" disabled={busy} onClick={() => act(() => respondRequest(person.username, false))}>
                  Decline
                </button>
              </div>
            </div>
          )}

          {person.blockedByMe ? (
            <button type="button" className="post-btn post-btn-light press" disabled={busy} onClick={() => act(() => unblockUser(person.username))}>
              Unblock @{person.username}
            </button>
          ) : !signedIn ? (
            <button type="button" className="post-btn post-btn-dark press" onClick={signIn} disabled={!isSupabaseConfigured}>
              {invited ? `Sign in to be friends with @${person.username}` : `Sign in to add @${person.username}`}
            </button>
          ) : status === "none" ? (
            <button type="button" className="post-btn press" disabled={busy} onClick={() => act(() => addFriend(person.username))}>
              Add friend
            </button>
          ) : status === "incoming" ? null : (
            <div className="circle-state">
              <span className={`chip ${status === "friends" ? "chip-mint" : "chip-white"}`}>
                {status === "friends" ? "✓ Friends" : "Request sent"}
              </span>
              {status === "requested" ? (
                <button type="button" className="mini-btn" disabled={busy} onClick={() => act(() => unfriend(person.username))}>
                  Cancel request
                </button>
              ) : confirmUnfriend ? (
                <span className="person-actions">
                  <button type="button" className="mini-btn mini-btn-danger" disabled={busy} onClick={() => act(() => unfriend(person.username))}>
                    Unfriend
                  </button>
                  <button type="button" className="mini-btn" onClick={() => setConfirmUnfriend(false)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" className="mini-btn" onClick={() => setConfirmUnfriend(true)}>
                  Unfriend
                </button>
              )}
            </div>
          )}
          {!signedIn && !person.blockedByMe && <SignInNote />}
          <p className="circle-hint">
            {status === "friends"
              ? `You see each other's friends-only polls and show up in each other's "friends voted".`
              : `Friends see each other's friends-only polls${status === "requested" ? ` once @${person.username} accepts` : ""}.`}
          </p>
          {error && (
            <p className="poll-error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}

      <h2 className="circle-title profile-section-title">Public polls</h2>
      <ul className="profile-list">
        {!polls ? (
          [0, 1].map((n) => <li key={n} className="skeleton profile-skeleton" />)
        ) : polls.length === 0 ? (
          <li className="profile-empty">No public polls yet.</li>
        ) : (
          polls.map((p, i) => <ProfilePoll key={p.id} poll={p} index={i} onShare={() => setSharing(p)} onChange={() => {}} />)
        )}
      </ul>

      {person && !person.blockedByMe && (
        <div className="block-row">
          {confirmBlock && signedIn ? (
            <>
              <span className="confirm-text">Block @{person.username}? You stop being friends and they can&apos;t add you again.</span>
              <button type="button" className="mini-btn mini-btn-danger" onClick={() => act(() => blockUser(person.username))}>
                Block
              </button>
              <button type="button" className="mini-btn" onClick={() => setConfirmBlock(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button type="button" className="mini-btn mini-btn-danger-text" onClick={() => setReporting(true)}>
                Report
              </button>
              {signedIn && (
                <button type="button" className="mini-btn mini-btn-danger-text block-btn" onClick={() => setConfirmBlock(true)}>
                  Block @{person.username}
                </button>
              )}
            </>
          )}
        </div>
      )}
      {reporting && person && (
        <ReportSheet target={{ kind: "user", username: person.username }} canReport={signedIn} onClose={() => setReporting(false)} />
      )}

      <BottomNav />
      {sharing && <ShareSheet poll={sharing} onClose={() => setSharing(null)} />}
    </div>
  );
}
