"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isSignedIn, onUserChange } from "@/lib/auth";
import { checkUsername, type UsernameProblem } from "@/lib/create";
import { getMyProfile, getUsernameSuggestions, PROFILE_CHANGED, updateUsername } from "@/lib/profile";
import { isSupabaseConfigured } from "@/lib/supabase";

const PROBLEMS: Record<string, string> = {
  format: "3 to 20 letters, numbers or _",
  reserved: "That one's reserved. How about:",
  blocked: "Let's pick something friendlier. How about:",
  taken: "Taken! These are free:",
};

const cleanName = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);

/**
 * "Pick your @name": shown once to every signed-in person whose username
 * hasn't been confirmed (everyone starts with one made from their Google
 * name). Keeping the suggestion is one tap; it can't be skipped.
 */
export function UsernameGate() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [checked, setChecked] = useState<{ name: string; problem: UsernameProblem; suggestions: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    return onUserChange(async (user) => {
      if (!isSignedIn(user)) return setOpen(false);
      try {
        const profile = await getMyProfile();
        if (!profile || profile.usernameConfirmed) return setOpen(false);
        const first = profile.username ?? (await getUsernameSuggestions())[0] ?? "";
        setStarting(profile.username);
        setName(first);
        setOpen(true);
      } catch {
        // Try again on the next sign-in event or page load.
      }
    });
  }, []);

  // Check a new name with the server as they type (their starting name is already theirs).
  useEffect(() => {
    if (!open || name.length < 3 || name === starting || checked?.name === name) return;
    const timer = window.setTimeout(async () => {
      try {
        setChecked({ name, ...(await checkUsername(name)) });
      } catch {
        // The server checks again on Continue.
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [open, name, starting, checked]);

  // Don't interrupt the sign-in hand-off itself.
  if (!open || pathname?.startsWith("/auth/")) return null;

  const status =
    name === starting && name
      ? { problem: "ok" as const, suggestions: [] }
      : name.length < 3
        ? { problem: "format" as const, suggestions: [] }
        : checked?.name === name
          ? checked
          : null;

  async function save() {
    if (saving || status?.problem !== "ok") return;
    setSaving(true);
    setError(null);
    try {
      await updateUsername(name);
      setOpen(false);
      window.dispatchEvent(new Event(PROFILE_CHANGED));
    } catch (e) {
      const code = (e as Error).message;
      if (code === "taken" || code === "reserved" || code === "blocked") {
        const r = await checkUsername(name).catch(() => null);
        if (r) setChecked({ name, ...r });
      } else {
        setError("Couldn't save that. Try again?");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sheet-layer">
      <div className="sheet-backdrop" aria-hidden="true" />
      <section role="dialog" aria-modal="true" aria-labelledby="pick-name-title" className="sheet">
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="pick-name-title" className="sheet-title">
          Pick your @name
        </h2>
        <p className="sheet-text">
          This is how you show up on polls, in circles and on the leaderboard. Keep this one or make it yours.
        </p>
        <form
          className="pick-name"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="name-input-wrap name-input-big">
            <span aria-hidden="true">@</span>
            <input
              className="name-input"
              aria-label="Username"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={name}
              onChange={(e) => {
                setError(null);
                setName(cleanName(e.target.value));
              }}
            />
          </div>
          <div className="name-status" aria-live="polite">
            {!status && <span className="muted">Checking…</span>}
            {status?.problem === "ok" && <span className="name-ok">@{name} is yours.</span>}
            {status && status.problem !== "ok" && (
              <>
                <span className="name-bad">{PROBLEMS[status.problem]}</span>
                {status.suggestions.length > 0 && (
                  <span className="name-chips">
                    {status.suggestions.map((s) => (
                      <button key={s} type="button" className="name-chip press" onClick={() => setName(s)}>
                        @{s}
                      </button>
                    ))}
                  </span>
                )}
              </>
            )}
            {error && <span className="name-bad">{error}</span>}
          </div>
          <button type="submit" className="sheet-btn sheet-btn-google press" disabled={saving || status?.problem !== "ok"}>
            {saving ? "Saving…" : "Continue"}
          </button>
        </form>
      </section>
    </div>
  );
}
