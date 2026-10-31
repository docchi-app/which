"use client";

import { useEffect, useState } from "react";
import { continueWithGoogle, isSignedIn, onUserChange, saveReturnTo } from "@/lib/auth";
import { getMyProfile } from "@/lib/profile";
import { propsState, type PropsState } from "@/lib/props";
import { recall } from "@/lib/screen-cache";
import { isSupabaseConfigured } from "@/lib/supabase";
import Link from "next/link";
import { BottomNav } from "./BottomNav";
import { FriendsPanel } from "./FriendsPanel";
import { MatchesList } from "./FriendPicks";
import { SignInNote } from "./SignInSheet";

/** /friends: invite, find people, requests and your friends. */
export function FriendsScreen() {
  const [signedIn, setSignedIn] = useState<boolean | undefined>(isSupabaseConfigured ? undefined : false);
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [props, setProps] = useState<PropsState | null>(null);
  // Seen this visit already: show it while sign-in is still being checked.
  const [remembered] = useState(() => !!recall("friends:circle"));

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    return onUserChange((user) => setSignedIn(isSignedIn(user)));
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    getMyProfile()
      .then((p) => setUsername(p?.username ?? null))
      .catch(() => {});
    propsState()
      .then(setProps)
      .catch(() => {});
  }, [signedIn]);

  async function signIn() {
    saveReturnTo("/friends");
    try {
      await continueWithGoogle();
    } catch {
      setError("Google sign-in isn't available right now. Try again in a bit.");
    }
  }

  return (
    <div className="screen friends-screen">
      <header className="page-head">
        <h1 className="leaders-title">Friends</h1>
        <p className="leaders-sub">See each other&apos;s friends-only polls, and who voted.</p>
      </header>

      {signedIn === false ? (
        <section className="poll-card soon profile-signin">
          <h2 className="poll-question">Bring your people</h2>
          <p className="poll-foot-note">
            Sign in to add friends, share polls just with them, and see which friends voted.
          </p>
          {isSupabaseConfigured && (
            <>
              <button type="button" className="post-btn post-btn-dark press" onClick={signIn}>
                Sign in with Google
              </button>
              <SignInNote />
            </>
          )}
          {error && (
            <p className="poll-error" role="alert">
              {error}
            </p>
          )}
        </section>
      ) : signedIn || remembered ? (
        <>
          {props && props.state !== "sign_in" && (
            <Link href="/props" className="props-entry press">
              <span className="props-entry-icon" aria-hidden="true">
                💜
              </span>
              <span className="props-entry-text">
                <strong>Props</strong>
                <span>
                  {props.state === "ready"
                    ? `${props.left} questions about your friends today`
                    : props.state === "locked"
                      ? `Add ${Math.max(1, 4 - (props.friends ?? 0))} more ${4 - (props.friends ?? 0) === 1 ? "friend" : "friends"} to unlock`
                      : "All done for today. See what friends say about you"}
                </span>
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          )}
          <MatchesList />
          <FriendsPanel username={username} />
        </>
      ) : null}

      <BottomNav current="friends" />
    </div>
  );
}
