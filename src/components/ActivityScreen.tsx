"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { activityText, fetchActivity, markActivitySeen, type Activity } from "@/lib/activity";
import { continueWithGoogle, isSignedIn, onUserChange, saveReturnTo } from "@/lib/auth";
import { announceCircleChange, circleErrorText, getMyCircle, respondRequest, type MyCircle } from "@/lib/circle";
import { fetchRecentResults, type RecentResult } from "@/lib/streak";
import { recall, remember } from "@/lib/screen-cache";
import { isSupabaseConfigured } from "@/lib/supabase";
import { BottomNav } from "./BottomNav";
import { markRequestsSeen } from "./NavBadge";
import { PersonLink } from "./FriendsPanel";
import { SignInNote } from "./SignInSheet";

/** The bell: friend requests, then new votes and comments on your polls. */
export function ActivityScreen() {
  const [signedIn, setSignedIn] = useState<boolean | undefined>(isSupabaseConfigured ? undefined : false);
  const [activity, setActivity] = useState<Activity | null>(null);
  // Shown straight away from the last visit, then refreshed. (New votes are always fetched fresh.)
  const [circle, setCircle] = useState<MyCircle | null>(() => recall<MyCircle>("activity:circle") ?? null);
  const [results, setResults] = useState<RecentResult[]>(() => recall<RecentResult[]>("activity:results") ?? []);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    return onUserChange((user) => setSignedIn(isSignedIn(user)));
  }, []);

  const loadRequests = useCallback(() => {
    getMyCircle()
      .then((c) => {
        setCircle(c);
        remember("activity:circle", c);
        markRequestsSeen(c.requests.length);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    loadRequests();
    fetchRecentResults()
      .then((r) => {
        setResults(r);
        remember("activity:results", r);
      })
      .catch(() => {});
    fetchActivity()
      .then((a) => {
        // Shown as new for this visit; seen as soon as it's on screen.
        setActivity(a);
        if (a.votes + a.comments > 0) markActivitySeen();
      })
      .catch(() => {});
  }, [signedIn, loadRequests]);

  async function respond(name: string, accept: boolean) {
    setError(null);
    try {
      await respondRequest(name, accept);
      loadRequests();
      announceCircleChange();
    } catch (e) {
      setError(circleErrorText(e));
    }
  }

  async function signIn() {
    saveReturnTo("/activity");
    try {
      await continueWithGoogle();
    } catch {
      setError("Google sign-in isn't available right now. Try again in a bit.");
    }
  }

  const requests = circle?.requests ?? [];
  const loaded = activity !== null && circle !== null;
  const quiet = loaded && requests.length === 0 && activity.list.length === 0 && results.length === 0;

  return (
    <div className="screen activity-screen">
      <header className="page-head">
        <h1 className="leaders-title">Activity</h1>
      </header>

      {error && (
        <p className="poll-error profile-error" role="alert">
          {error}
        </p>
      )}

      {signedIn === false ? (
        <section className="poll-card soon profile-signin">
          <h2 className="poll-question">Nothing here yet</h2>
          <p className="poll-foot-note">Sign in to get friend requests and see when people vote on your polls.</p>
          {isSupabaseConfigured && (
            <>
              <button type="button" className="post-btn post-btn-dark press" onClick={signIn}>
                Sign in with Google
              </button>
              <SignInNote />
            </>
          )}
        </section>
      ) : (
        <div className="circle-panel">
          {requests.length > 0 && (
            <section className="circle-section">
              <h2 className="circle-title">
                Friend requests <span className="count-pill">{requests.length}</span>
              </h2>
              <ul className="people">
                {requests.map((r) => (
                  <li key={r.username} className="person">
                    <PersonLink person={r} />
                    <div className="person-actions">
                      <button type="button" className="mini-btn mini-btn-mint" onClick={() => respond(r.username, true)}>
                        Accept
                      </button>
                      <button type="button" className="mini-btn" onClick={() => respond(r.username, false)}>
                        Decline
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {activity && activity.list.length > 0 && (
            <section className="circle-section">
              <h2 className="circle-title">On your polls</h2>
              <ul className="activity-list">
                {activity.list.map((a) => (
                  <li key={a.pollId}>
                    <Link href={`/p/${a.pollId}`} className="activity-row press">
                      <span className="activity-q">{a.question ?? "Your poll"}</span>
                      <span className="activity-chip">{activityText(a)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {results.length > 0 && (
            <section className="circle-section">
              <h2 className="circle-title">Results are in</h2>
              <ul className="activity-list">
                {results.map((r) => {
                  const won = r.myPick !== null && r.myPick === r.winner;
                  return (
                    <li key={r.pollId}>
                      <Link href={`/p/${r.pollId}`} className="activity-row press">
                        <span className="activity-q">{r.question}</span>
                        <span className="result-line">
                          {r.voteCount === 0 ? (
                            "No votes this time"
                          ) : (
                            <>
                              <strong>{r.winner}</strong> won with {r.winnerPct}%
                            </>
                          )}
                        </span>
                        {r.myPick !== null && r.voteCount > 0 && (
                          <span className={`activity-chip${won ? " chip-won" : ""}`}>
                            {won ? "You called it 🎯" : `You picked ${r.myPick}`}
                          </span>
                        )}
                        {r.mine && r.myPick === null && <span className="activity-chip">Your poll · {r.voteCount} votes</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {quiet && (
            <section className="poll-card soon">
              <span className="chip chip-mint">All quiet</span>
              <h2 className="poll-question">No new activity.</h2>
              <p className="poll-foot-note">Post a poll and share it with friends. Votes and comments show up here.</p>
              <div className="empty-actions">
                <Link href="/create" className="btn btn-coral press">
                  Make a poll
                </Link>
                <Link href="/friends" className="btn btn-white press">
                  Add friends
                </Link>
              </div>
            </section>
          )}

          {signedIn && !loaded && <div className="skeleton profile-skeleton" />}
        </div>
      )}

      <BottomNav />
    </div>
  );
}
