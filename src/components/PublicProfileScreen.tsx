"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isSignedIn, continueWithGoogle, onUserChange, saveReturnTo } from "@/lib/auth";
import {
  announceCircleChange,
  blockUser,
  circleErrorText,
  getPublicProfile,
  leaveCircle,
  requestCircle,
  respondRequest,
  unblockUser,
  type PublicProfile,
} from "@/lib/circle";
import { fetchProfilePolls } from "@/lib/polls";
import { compactCount } from "@/lib/profile";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { Poll } from "@/lib/types";
import { Avatar } from "./Avatar";
import { BottomNav } from "./BottomNav";
import { ProfilePoll } from "./ProfileScreen";
import { ReportSheet } from "./ReportSheet";
import { ShareSheet } from "./ShareSheet";

/** /u/<name>: someone's public polls, and asking to join their circle. */
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
      .catch(() => setPerson(null));
  }, [username, router]);

  useEffect(() => {
    if (signedIn === null && isSupabaseConfigured) return; // wait to know who's looking
    load();
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
    }
  }

  async function signIn() {
    saveReturnTo(`/u/${username}`);
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
          <dt>In circle</dt>
          <dd>{person ? compactCount(person.circleSize) : "–"}</dd>
        </div>
      </dl>

      {person && (
        <section className="circle-cta">
          {person.myCircle === "pending" && (
            <div className="circle-incoming" role="status">
              <span>
                <strong>@{person.username}</strong> wants to join your circle.
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
              Sign in to join @{person.username}&apos;s circle
            </button>
          ) : person.theirCircle === "none" ? (
            <button type="button" className="post-btn press" disabled={busy} onClick={() => act(() => requestCircle(person.username))}>
              Ask to join @{person.username}&apos;s circle
            </button>
          ) : (
            <div className="circle-state">
              <span className={`chip ${person.theirCircle === "member" ? "chip-mint" : "chip-white"}`}>
                {person.theirCircle === "member" ? `In @${person.username}'s circle` : "Request sent"}
              </span>
              <button type="button" className="mini-btn" disabled={busy} onClick={() => act(() => leaveCircle(person.username))}>
                {person.theirCircle === "member" ? "Leave circle" : "Cancel request"}
              </button>
            </div>
          )}
          <p className="circle-hint">
            {person.theirCircle === "member"
              ? `You'll see the polls @${person.username} shares with their circle.`
              : `Once @${person.username} accepts, you'll see the polls they share with their circle.`}
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
              <span className="confirm-text">Block @{person.username}? They leave your circle, you leave theirs, and they can&apos;t ask again.</span>
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
