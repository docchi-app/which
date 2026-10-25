"use client";

import { useEffect, useState } from "react";
import { deleteSnap, snapErrorText } from "@/lib/snap";

/** "Delete this snap?": one confirm, then it's gone for everyone. */
export function DeleteSnapSheet({ pollId, onClose, onDeleted }: { pollId: string; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteSnap(pollId);
      onClose();
      onDeleted();
    } catch (e) {
      setError(snapErrorText(e));
      setBusy(false);
    }
  }

  return (
    <div className="sheet-layer">
      <div className="sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <section role="alertdialog" aria-modal="true" aria-labelledby="del-title" className="sheet">
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="del-title" className="sheet-title">
          Delete this snap?
        </h2>
        <p className="sheet-text">The photo, its votes and comments are gone for everyone, right away. You can&apos;t undo this.</p>
        {error && (
          <p className="poll-error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="post-btn post-btn-danger press" onClick={remove} disabled={busy}>
          {busy ? "Deleting…" : "🗑️ Delete snap"}
        </button>
        <button type="button" className="sheet-later" onClick={onClose}>
          Keep it
        </button>
      </section>
    </div>
  );
}
