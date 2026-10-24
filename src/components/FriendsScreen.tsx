"use client";

import { useEffect, useState } from "react";
import { continueWithGoogle, isSignedIn, onUserChange, saveReturnTo } from "@/lib/auth";
import { getMyProfile } from "@/lib/profile";
import { isSupabaseConfigured } from "@/lib/supabase";
import { BottomNav } from "./BottomNav";
import { FriendsPanel } from "./FriendsPanel";
import { SignInNote } from "./SignInSheet";

/** /friends: invite, find people, requests and your friends. */
export function FriendsScreen() {
  const [signedIn, setSignedIn] = useState<boolean | undefined>(isSupabaseConfigured ? undefined : false);
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    return onUserChange((user) => setSignedIn(isSignedIn(user)));
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    getMyProfile()
      .then((p) => setUsername(p?.username ?? null))
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
      ) : signedIn ? (
        <FriendsPanel username={username} />
      ) : null}

      <BottomNav current="friends" />
    </div>
  );
}
