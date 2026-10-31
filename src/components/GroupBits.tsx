"use client";

import { useEffect, useState } from "react";
import { forgetGuestPick } from "@/lib/auth";
import { undoVote, verdictText, type Verdict } from "@/lib/groups";
import type { Poll } from "@/lib/types";

const COLORS = ["var(--coral)", "var(--sky)", "var(--sun)", "var(--mint)"];

/**
 * "This chat's verdict": the votes made through this group link. Before you vote, only how many
 * from the chat voted; after, the split and a button to send it back to the chat.
 */
export function ChatVerdict({ poll, verdict, code }: { poll: Poll; verdict: Verdict; code: string }) {
  if (!verdict.options) {
    if (verdict.total === 0) return null;
    return (
      <p className="chat-verdict chat-verdict-wait">
        💬 {verdict.total} from this chat voted. Pick to see their side.
      </p>
    );
  }
  const counts = poll.options.map((o, i) => ({ id: o.id, text: o.text, color: COLORS[i], n: verdict.options?.find((x) => x.id === o.id)?.votes ?? 0 }));
  const max = Math.max(1, ...counts.map((c) => c.n));
  const send = () => window.open(`https://wa.me/?text=${encodeURIComponent(verdictText(poll, verdict, code))}`, "_blank", "noopener,noreferrer");
  return (
    <section className="chat-verdict" aria-label="This chat's verdict">
      <b className="chat-verdict-title">This chat&apos;s verdict</b>
      <ul>
        {counts.map((c) => (
          <li key={c.id} className={c.id === poll.myOptionId ? "chat-verdict-mine" : undefined}>
            <span className="chat-verdict-text">{c.text}</span>
            <span className="chat-verdict-track" aria-hidden="true">
              <span style={{ width: `${(c.n / max) * 100}%`, background: c.color }} />
            </span>
            <span className="chat-verdict-n">{c.n}</span>
          </li>
        ))}
      </ul>
      <p className="chat-verdict-foot">
        {verdict.total} {verdict.total === 1 ? "person" : "people"} voted from this chat{verdict.mine ? " (your link)" : verdict.asker ? ` · @${verdict.asker} asked` : ""}
      </p>
      <button type="button" className="btn btn-white press chat-verdict-share" onClick={send}>
        Share result to the chat
      </button>
    </section>
  );
}

/** A quick vote link voted for you: "✓ You picked Manali · Change (8s)". */
export function QuickPickLine({ poll, optionId, canChange, onUndone }: { poll: Poll; optionId: string; canChange: boolean; onUndone: () => void }) {
  const [left, setLeft] = useState(canChange ? 10 : 0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (left <= 0) return;
    const t = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left]);
  const text = poll.options.find((o) => o.id === optionId)?.text ?? "";

  async function change() {
    setBusy(true);
    try {
      await undoVote(poll.id);
      forgetGuestPick(poll.id);
      onUndone();
    } catch {
      setFailed(true);
      setLeft(0);
    } finally {
      setBusy(false);
    }
  }

  return (
    <p className="quick-pick" role="status">
      <span>✓ You picked {text}</span>
      {left > 0 && (
        <button type="button" className="quick-pick-change" onClick={change} disabled={busy}>
          {busy ? "Changing…" : `Change (${left}s)`}
        </button>
      )}
      {failed && <span className="quick-pick-note">It&apos;s locked in now.</span>}
    </p>
  );
}
