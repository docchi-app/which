"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { continueWithGoogle, guestPicks } from "@/lib/auth";

export type SheetPick = { text: string; color: string };

type Props = {
  /** The pick waiting on sign-in (when guest voting is off). Without one, a guest is asked to make their votes count. */
  pick?: SheetPick;
  onClose: () => void;
};

/** Slides up when a vote needs Google, or after a guest's first few votes. */
export function SignInSheet({ pick, onClose }: Props) {
  const [votes] = useState(() => guestPicks().length);
  const googleRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    googleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function google() {
    setBusy(true);
    setError(null);
    try {
      await continueWithGoogle(); // navigates away on success
    } catch (e) {
      console.error(e);
      setError("Google sign-in isn't available right now. Try again in a bit.");
      setBusy(false);
    }
  }

  return (
    <div className="sheet-layer">
      <div className="sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <section role="dialog" aria-modal="true" aria-labelledby="signin-title" className="sheet">
        <div className="sheet-handle" aria-hidden="true" />

        <div className="sheet-tiles" aria-hidden="true">
          <span className="sheet-tile" style={{ background: "var(--coral)", "--r": "-8deg", left: 0, top: 14 } as CSSProperties}>
            A
          </span>
          <span className="sheet-tile sheet-tile-big" style={{ background: "var(--sky)", "--r": "4deg", left: 68, top: 0 } as CSSProperties}>
            B
          </span>
          <span className="sheet-tile sheet-tile-small" style={{ background: "var(--mint)", "--r": "10deg", left: 138, top: 22 } as CSSProperties}>
            C
          </span>
        </div>

        {pick ? (
          <>
            <h2 id="signin-title" className="sheet-title">
              Lock in your pick
            </h2>
            <p className="sheet-text">
              You picked{" "}
              <strong className="sheet-pick" style={{ background: pick.color }}>
                {pick.text}
              </strong>
              . One vote per person keeps Eithr fair. One tap and you&apos;re in.
            </p>
          </>
        ) : (
          <>
            <h2 id="signin-title" className="sheet-title">
              {votes > 1 ? `Make your ${votes} votes count` : "Make your vote count"}
            </h2>
            <p className="sheet-text">
              {votes > 1 ? "They're" : "It's"} saved on this phone but not in the results yet. Sign in and{" "}
              {votes > 1 ? "they count" : "it counts"}, plus you can comment and post polls.
            </p>
          </>
        )}

        <button ref={googleRef} type="button" className="sheet-btn sheet-btn-google press" onClick={google} disabled={busy}>
          <GoogleG />
          {busy ? "Opening Google…" : "Continue with Google"}
        </button>

        <GoogleTrust />

        <p className="sheet-legal">
          By continuing you agree to the <Link href="/terms">Terms</Link> and{" "}
          <Link href="/guidelines">Community guidelines</Link>, and our <Link href="/privacy">Privacy policy</Link>.
        </p>

        {error && (
          <p className="poll-error" role="alert">
            {error}
          </p>
        )}

        <button type="button" className="sheet-later" onClick={onClose}>
          Not now, keep browsing
        </button>
      </section>
    </div>
  );
}

function GoogleG() {
  return (
    <span className="google-g" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 48 48">
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.9 6.2C12.4 13.7 17.7 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
        <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.8l7.9-6.2z" />
        <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.2-8.5 2.2-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z" />
      </svg>
    </span>
  );
}

/** Exactly what Eithr gets from Google, and what it never does. */
export function GoogleTrust() {
  return (
    <div className="trust">
      <h3>What Eithr gets from Google</h3>
      <ul>
        <li>
          <span aria-hidden="true">👤</span>
          <span>
            Your <strong>name</strong>, to suggest a @username
          </span>
        </li>
        <li>
          <span aria-hidden="true">🖼️</span>
          <span>
            Your <strong>profile photo</strong>
          </span>
        </li>
        <li>
          <span aria-hidden="true">✉️</span>
          <span>
            Your <strong>email</strong>, kept private, never shown
          </span>
        </li>
      </ul>
      <hr />
      <ul className="trust-no">
        <li>
          <span aria-hidden="true">✕</span>
          <span>Never posts anything for you</span>
        </li>
        <li>
          <span aria-hidden="true">✕</span>
          <span>No contacts, Gmail, Drive or anything else</span>
        </li>
        <li>
          <span aria-hidden="true">✕</span>
          <span>Your data is never sold</span>
        </li>
      </ul>
    </div>
  );
}

/** The one-line version, under other "Sign in with Google" buttons. */
export function SignInNote() {
  return <p className="signin-note">We only get your name, email (kept private) and photo from Google.</p>;
}
