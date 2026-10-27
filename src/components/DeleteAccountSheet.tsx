"use client";

import { useEffect, useState } from "react";
import { DELETE_ERRORS, DeleteAccountError, deleteMyAccount } from "@/lib/profile";

/** Settings → Delete account: say what goes, type DELETE, gone for good. */
export function DeleteAccountSheet({ username, onClose }: { username: string | null; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (done) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, done, onClose]);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteMyAccount(typed);
      setDone(true);
    } catch (e) {
      console.error(e);
      setError((e instanceof DeleteAccountError && DELETE_ERRORS[e.code]) || "Couldn't delete your account. Try again?");
      setBusy(false);
    }
  }

  const ready = typed.trim().toUpperCase() === "DELETE";

  return (
    <div className="sheet-layer">
      <div className="sheet-backdrop" aria-hidden="true" onClick={busy || done ? undefined : onClose} />
      <section role="alertdialog" aria-modal="true" aria-labelledby="delete-title" className="sheet">
        <div className="sheet-handle" aria-hidden="true" />
        {done ? (
          <>
            <h2 id="delete-title" className="sheet-title">
              Your account is deleted
            </h2>
            <p className="sheet-text">Everything&apos;s gone. Thanks for trying Eithr. You&apos;re always welcome back.</p>
            {/* A full reload, so nothing of the old account stays in memory. */}
            <button type="button" className="post-btn press" onClick={() => window.location.assign("/")}>
              Back to the feed
            </button>
          </>
        ) : (
          <>
            <h2 id="delete-title" className="sheet-title">
              Delete your account?
            </h2>
            <p className="sheet-text">
              {username ? <strong>@{username}</strong> : "Your account"} and everything in it is deleted for good, right away:
            </p>
            <ul className="delete-list">
              <li>your polls and snaps, with their votes and comments</li>
              <li>your votes and comments on other polls</li>
              <li>your friends, lists, streak and notifications</li>
            </ul>
            <p className="sheet-text">This can&apos;t be undone. Signing in with Google again later starts a brand-new account.</p>
            <label htmlFor="delete-confirm" className="field-label">
              Type DELETE to confirm
            </label>
            <input
              id="delete-confirm"
              className="answer-input"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={busy}
            />
            {error && (
              <p className="poll-error" role="alert">
                {error}
              </p>
            )}
            <button type="button" className="post-btn post-btn-danger press" onClick={remove} disabled={!ready || busy}>
              {busy ? "Deleting…" : "Delete my account"}
            </button>
            <button type="button" className="sheet-later" onClick={onClose} disabled={busy}>
              Keep my account
            </button>
          </>
        )}
      </section>
    </div>
  );
}
