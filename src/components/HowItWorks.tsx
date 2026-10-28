"use client";

import { useEffect, useState } from "react";
import { onUserChange } from "@/lib/auth";
import { MOVED_KEY } from "@/lib/move";
import { HOW_IT_WORKS_KEY } from "@/lib/tips";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useBackClose } from "@/lib/back";

// Accounts older than this already know how Eithr works (say, signing in on a new phone).
const NEW_ACCOUNT_MS = 864e5;

const STEPS = [
  ["Tap the side you’re on", "No sign-up needed."],
  ["See where everyone lands", "Results show the moment you vote."],
  ["Scroll for more", "New polls every day."],
] as const;

function seen() {
  try {
    return !!localStorage.getItem(HOW_IT_WORKS_KEY) || !!localStorage.getItem(MOVED_KEY);
  } catch {
    return true; // storage blocked: skip it rather than show it every visit
  }
}

/**
 * First visit on this device: a sheet that shows, on a small looping feed, the three moves
 * (tap a side, see the results, scroll on). Waits for any other sheet to close first.
 */
export function HowItWorks() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (seen()) return;
    let timer = 0;
    let decided = false;
    const showWhenFree = (tries = 0) => {
      if (seen() || tries > 50) return;
      if (document.querySelector(".sheet-layer")) {
        timer = window.setTimeout(() => showWhenFree(tries + 1), 400);
        return;
      }
      setOpen(true);
    };
    const decide = (createdAt: string | null) => {
      if (decided) return;
      decided = true;
      if (createdAt && Date.now() - Date.parse(createdAt) > NEW_ACCOUNT_MS) return;
      showWhenFree();
    };
    if (!isSupabaseConfigured) decide(null);
    const stop = onUserChange((user) => decide(user?.created_at ?? null));
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, []);

  function close() {
    try {
      localStorage.setItem(HOW_IT_WORKS_KEY, "1");
    } catch {
      // Storage blocked: it may show again next visit.
    }
    setOpen(false);
  }

  // The back button counts as "Got it".
  const dismiss = useBackClose(open, close);

  if (!open) return null;
  return (
    <div className="sheet-layer">
      <div className="sheet-backdrop" aria-hidden="true" onClick={dismiss} />
      <section role="dialog" aria-modal="true" aria-labelledby="howto-title" className="sheet howto-sheet">
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="howto-title" className="sheet-title">
          How Eithr works
        </h2>
        <div className="howto-demo" aria-hidden="true">
          <div className="howto-stack">
            <div className="howto-card">
              <p className="howto-q">Chai or coffee?</p>
              <div className="howto-opt howto-mine">
                <span className="howto-bar" />
                <span className="howto-text">Chai ☕</span>
                <em>62%</em>
              </div>
              <div className="howto-opt">
                <span className="howto-bar" />
                <span className="howto-text">Coffee</span>
                <em>38%</em>
              </div>
            </div>
            <div className="howto-card howto-next">
              <p className="howto-q">Beach or mountains?</p>
              <div className="howto-opt">
                <span className="howto-text">Beach 🏖️</span>
              </div>
              <div className="howto-opt">
                <span className="howto-text">Mountains ⛰️</span>
              </div>
            </div>
          </div>
          <span className="howto-tap" />
          <span className="howto-swipe" />
        </div>
        {/* The captions change with the demo; the list says the same for screen readers and reduced motion. */}
        <div className="howto-caps" aria-hidden="true">
          {STEPS.map(([title, text], i) => (
            <p key={title}>
              <strong>
                {i + 1}. {title}
              </strong>
              {text}
            </p>
          ))}
        </div>
        <ol className="howto-steps">
          {STEPS.map(([title, text]) => (
            <li key={title}>
              <strong>{title}.</strong> {text}
            </li>
          ))}
        </ol>
        <div className="howto-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <button type="button" className="btn btn-coral press howto-go" onClick={dismiss}>
          Got it, let me vote
        </button>
      </section>
    </div>
  );
}
