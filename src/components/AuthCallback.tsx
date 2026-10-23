"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signInWithGoogle, takePendingVote, takeReturnTo } from "@/lib/auth";
import { castVote } from "@/lib/polls";
import { getSupabase } from "@/lib/supabase";
import { LogoMark } from "./Logo";

/**
 * Where Google sends the viewer back. The Supabase client swaps the ?code for
 * a session on load; then the pick made before sign-in is cast.
 */
export function AuthCallback() {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return; // dev Strict Mode runs effects twice
    started.current = true;

    (async () => {
      const supabase = getSupabase();
      if (!supabase) return router.replace("/");

      const query = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const errorCode = query.get("error_code") ?? hash.get("error_code");

      // This Google account already has a Docchi account: sign in to that one.
      // The guest account is left behind, so the pick is cast as the real account.
      if (errorCode === "identity_already_exists") {
        try {
          await signInWithGoogle();
        } catch {
          setError("Couldn't reach Google. Try again from the feed.");
        }
        return;
      }

      if (errorCode || query.get("error") || hash.get("error")) {
        console.error("Sign-in error", errorCode, query.get("error_description") ?? hash.get("error_description"));
        takePendingVote();
        setError("Sign-in didn't finish.");
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        takePendingVote();
        setError("Sign-in didn't finish.");
        return;
      }

      const pending = takePendingVote();
      if (!pending) return router.replace(takeReturnTo() ?? "/");
      try {
        await castVote(pending.pollId, pending.optionId);
        router.replace(`/?poll=${pending.pollId}&voted=1`);
      } catch (e) {
        console.error(e);
        router.replace(`/?poll=${pending.pollId}`);
      }
    })();
  }, [router]);

  return (
    <main className="callback">
      <LogoMark size={64} />
      {error ? (
        <>
          <h1 className="poll-question">{error}</h1>
          <Link href="/" className="btn btn-coral press">
            Back to the feed
          </Link>
        </>
      ) : (
        <h1 className="poll-question" aria-live="polite">
          Locking in your pick…
        </h1>
      )}
    </main>
  );
}
