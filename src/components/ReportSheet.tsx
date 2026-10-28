"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { continueWithGoogle, saveReturnTo } from "@/lib/auth";
import { REPORT_REASONS, sendReport, type ReportReason, type ReportTarget } from "@/lib/safety";
import { useBackClose } from "@/lib/back";

type Props = {
  target: ReportTarget;
  /** null while we don't know yet; false shows "sign in to report". */
  canReport: boolean | null;
  onClose: () => void;
  /** After a report goes through (so the poll can leave the feed). */
  onReported?: () => void;
};

/** "Report this poll / @name": pick a reason, send. */
export function ReportSheet({ target, canReport, onClose, onReported }: Props) {
  // Back closes it too (and the phone's back button doesn't leave the screen).
  const close = useBackClose(true, onClose);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const what = target.kind === "poll" ? "this poll" : target.kind === "comment" ? "this comment" : `@${target.username}`;

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  async function send() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await sendReport(target, reason);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that. Try again?");
    } finally {
      setBusy(false);
    }
  }

  async function signIn() {
    saveReturnTo(window.location.pathname + window.location.search);
    try {
      await continueWithGoogle();
    } catch {
      setError("Google sign-in isn't available right now.");
    }
  }

  function done() {
    close();
    onReported?.();
  }

  // On document.body: a poll card's swipe transform would trap a fixed layer.
  return createPortal(
    <div className="sheet-layer">
      <div className="sheet-backdrop" aria-hidden="true" onClick={sent ? done : close} />
      <section role="dialog" aria-modal="true" aria-labelledby="report-title" className="sheet report-sheet">
        <div className="sheet-handle" aria-hidden="true" />
        {sent ? (
          <>
            <h2 id="report-title" ref={titleRef} tabIndex={-1} className="sheet-title">
              Thanks for telling us
            </h2>
            <p className="sheet-text">
              We&apos;ll take a look. Reports are anonymous: nobody sees who sent them.
              {target.kind === "poll" ? " We won't show you this poll again." : ""}
            </p>
            <button type="button" className="post-btn press" onClick={done}>
              Done
            </button>
          </>
        ) : (
          <>
            <h2 id="report-title" ref={titleRef} tabIndex={-1} className="sheet-title">
              Report {what}
            </h2>
            <p className="sheet-text">
              What&apos;s wrong with it? See the <Link href="/guidelines">Community guidelines</Link>.
            </p>
            {canReport === false ? (
              <button type="button" className="sheet-btn sheet-btn-google press" onClick={signIn}>
                Sign in with Google to report
              </button>
            ) : (
              <>
                <fieldset className="report-reasons">
                  <legend className="sr-only">Reason</legend>
                  {REPORT_REASONS.map((r) => (
                    <label key={r.id} className="report-reason" data-on={reason === r.id || undefined}>
                      <input type="radio" name="reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} />
                      {r.label}
                    </label>
                  ))}
                </fieldset>
                <button type="button" className="post-btn press" onClick={send} disabled={!reason || busy || canReport === null}>
                  {busy ? "Sending…" : "Send report"}
                </button>
              </>
            )}
            {error && (
              <p className="poll-error" role="alert">
                {error}
              </p>
            )}
            <button type="button" className="sheet-later" onClick={close}>
              Cancel
            </button>
          </>
        )}
      </section>
    </div>,
    document.body,
  );
}
