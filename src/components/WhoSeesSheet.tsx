"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBackClose } from "@/lib/back";
import { setPollVisibility } from "@/lib/polls";
import type { Visibility } from "@/lib/types";

const CHOICES: { id: Visibility; label: string; hint: string }[] = [
  { id: "public", label: "Everyone", hint: "In the public feed, and anyone with the link" },
  { id: "circle", label: "Friends", hint: "Only your friends, in their feed" },
  { id: "link", label: "Link only", hint: "Only people you send it to" },
];

/**
 * "Who sees this snap / poll": your own post's audience, changed after posting (say it went to
 * Everyone by mistake). Votes so far stay. A snap can't go public later: snaps for Everyone get
 * a stricter photo check when they're sent (the database refuses it too).
 */
export function WhoSeesSheet({
  pollId,
  snap,
  visibility,
  onClose,
  onSaved,
}: {
  pollId: string;
  snap: boolean;
  visibility: Visibility;
  onClose: () => void;
  onSaved: (v: Visibility) => void;
}) {
  const close = useBackClose(true, onClose);
  const [pick, setPick] = useState<Visibility>(visibility);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const locked = (v: Visibility) => snap && v === "public" && visibility !== "public";

  async function save() {
    if (pick === visibility) return close();
    setBusy(true);
    setError(null);
    try {
      await setPollVisibility(pollId, pick);
      close();
      onSaved(pick);
    } catch {
      setError("Couldn't change it. Check your connection and try again.");
      setBusy(false);
    }
  }

  // On document.body: a poll card's swipe transform would trap a fixed layer.
  return createPortal(
    <div className="sheet-layer">
      <div className="sheet-backdrop" aria-hidden="true" onClick={close} />
      <section role="dialog" aria-modal="true" aria-labelledby="who-title" className="sheet">
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="who-title" className="sheet-title">
          Who sees this {snap ? "snap" : "poll"}
        </h2>
        <div className="who-list" role="radiogroup" aria-labelledby="who-title">
          {CHOICES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={pick === c.id}
              disabled={locked(c.id) || busy}
              className="who-choice press"
              onClick={() => setPick(c.id)}
            >
              <span className="who-dot" aria-hidden="true" />
              <span>
                <strong>{c.label}</strong>
                <small>{locked(c.id) ? "Snaps go public only when posted, after a stricter photo check" : c.hint}</small>
              </span>
            </button>
          ))}
        </div>
        <p className="sheet-text who-note">Votes so far stay, whoever cast them.</p>
        {error && (
          <p className="poll-error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="post-btn press" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </section>
    </div>,
    document.body,
  );
}
