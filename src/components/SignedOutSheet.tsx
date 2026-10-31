"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { continueWithGoogle, currentUser, isSignedIn, lastAccount, markSignedOutTold, onUserChange, rememberAccount, saveReturnTo, type LastAccount } from "@/lib/auth";
import { useBackClose } from "@/lib/back";
import { GoogleG } from "./SignInSheet";

/**
 * "You've been signed out": once, on the next open after a Google sign-in ran out on its own
 * (a long break, cleared storage, signed out on another device). Never for new visitors, and
 * never after "Sign out" in Settings, which forgets the account (see lastAccount in auth.ts).
 */
export function SignedOutSheet() {
  const path = usePathname();
  const [shown, setShown] = useState<LastAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const close = useBackClose(Boolean(shown), () => setShown(null));

  useEffect(() => {
    if (path?.startsWith("/auth") || path?.startsWith("/admin")) return;
    let timer = 0;
    const off = onUserChange((user) => {
      window.clearTimeout(timer);
      if (isSignedIn(user)) {
        rememberAccount();
        setShown(null);
        return;
      }
      // Give a sign-in that's being renewed a moment to come back before saying anything.
      timer = window.setTimeout(async () => {
        const now = await currentUser().catch(() => null);
        const was = lastAccount();
        if (isSignedIn(now) || !was || was.told) return;
        markSignedOutTold();
        setShown(was);
      }, 2500);
    });
    return () => {
      window.clearTimeout(timer);
      off();
    };
  }, [path]);

  if (!shown) return null;
  const keep = [
    shown.streak ? `🔥 ${shown.streak}-day streak` : null,
    shown.friends ? `${shown.friends} ${shown.friends === 1 ? "friend" : "friends"}` : null,
    shown.polls ? `${shown.polls} ${shown.polls === 1 ? "poll" : "polls"}` : null,
  ].filter(Boolean) as string[];

  async function google() {
    setBusy(true);
    try {
      saveReturnTo(window.location.pathname + window.location.search);
      await continueWithGoogle(); // navigates away
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-layer">
      <div className="sheet-backdrop" aria-hidden="true" onClick={close} />
      <section role="dialog" aria-modal="true" aria-labelledby="signedout-title" className="sheet signedout-sheet">
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="signedout-title" className="sheet-title">
          You&apos;ve been signed out
        </h2>
        <p className="sheet-text">
          It&apos;s been a while, so we signed you out to keep your account safe. Sign in again to pick up where you left off
          {keep.length ? ":" : "."}
        </p>
        {keep.length > 0 && (
          <div className="signedout-keep">
            {keep.map((k) => (
              <span key={k}>{k}</span>
            ))}
          </div>
        )}
        <button type="button" className="sheet-btn sheet-btn-google press" onClick={google} disabled={busy}>
          <GoogleG />
          {busy ? "Opening Google…" : "Continue with Google"}
        </button>
        <button type="button" className="sheet-later" onClick={close}>
          Not now, just browse
        </button>
      </section>
    </div>
  );
}
