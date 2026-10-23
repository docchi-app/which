"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { canVote, continueWithGoogle, currentUser, signOut } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase";

/** Who's signed in, with sign-in / sign-out. The full profile screen comes later. */
export function AccountCard() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    currentUser().then(setUser);
  }, []);

  if (!isSupabaseConfigured || user === undefined) return null;

  if (!canVote(user)) {
    return (
      <button type="button" className="btn btn-white press" onClick={() => continueWithGoogle()}>
        Sign in with Google
      </button>
    );
  }

  const name = (user!.user_metadata.full_name as string | undefined) ?? user!.email ?? "you";
  return (
    <div className="account">
      <p className="poll-foot-note">
        Signed in as <strong>{name}</strong>
      </p>
      <button
        type="button"
        className="btn btn-white press"
        onClick={async () => {
          await signOut();
          setUser(null);
        }}
      >
        Sign out
      </button>
    </div>
  );
}
