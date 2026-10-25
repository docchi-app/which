"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { continueWithGoogle, isSignedIn, onUserChange, saveReturnTo } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase";
import { BottomNav } from "./BottomNav";
import { PropsCard } from "./PropsCard";
import { SignInNote } from "./SignInSheet";

/** /props: today's questions about your friends, one after another. */
export function PropsScreen() {
  const [signedIn, setSignedIn] = useState<boolean | undefined>(isSupabaseConfigured ? undefined : false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    return onUserChange((user) => setSignedIn(isSignedIn(user)));
  }, []);

  async function signIn() {
    saveReturnTo("/props");
    await continueWithGoogle().catch(() => {});
  }

  return (
    <div className="screen props-screen">
      <header className="page-head">
        <h1 className="leaders-title">Props 💜</h1>
        <p className="leaders-sub">Fun questions about your friends. Anonymous, always kind, 10 a day.</p>
      </header>
      <div className="props-page">
        {signedIn === false ? (
          <section className="poll-card soon profile-signin">
            <h2 className="poll-question">Give your friends props</h2>
            <p className="poll-foot-note">Sign in to answer questions about your friends and see what they say about you.</p>
            {isSupabaseConfigured && (
              <>
                <button type="button" className="post-btn post-btn-dark press" onClick={signIn}>
                  Sign in with Google
                </button>
                <SignInNote />
              </>
            )}
          </section>
        ) : signedIn ? (
          <>
            <PropsCard />
            <Link href="/profile" className="props-mine-link">
              💜 What friends say about you →
            </Link>
          </>
        ) : null}
      </div>
      <BottomNav current="friends" />
    </div>
  );
}
