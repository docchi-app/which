"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { cleanUpSnapPhotos, snapPhotoUrl } from "@/lib/snap";

type Pending = {
  pollId: string;
  path: string;
  question: string;
  visibility: string;
  creator: string;
  createdAt: string;
  status: string;
  scores: Record<string, number> | null;
};

const LABELS: [string, string][] = [
  ["sexual", "Sexual"],
  ["sexual/minors", "Minors"],
  ["violence", "Violence"],
  ["violence/graphic", "Gore"],
  ["self-harm", "Self-harm"],
  ["hate", "Hate"],
];

/** Admin → Snaps: photos the check wasn't sure about. Reviewed within 12 hours or they're turned down. */
export function AdminSnaps() {
  const [items, setItems] = useState<Pending[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = (await getSupabase()?.rpc("admin_snaps")) ?? {};
    if (error) return setItems([]);
    setItems(
      ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        pollId: r.poll_id as string,
        path: r.photo_path as string,
        question: r.question as string,
        visibility: r.visibility as string,
        creator: r.creator as string,
        createdAt: r.created_at as string,
        status: r.photo_status as string,
        scores: (r.photo_scores as Record<string, number> | null) ?? null,
      })),
    );
  }, []);

  useEffect(() => {
    // Fetching on mount is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function decide(pollId: string, approve: boolean) {
    await getSupabase()?.rpc("admin_decide_snap", { poll: pollId, approve });
    load();
  }

  async function sweep() {
    setNote("Cleaning up…");
    const n = await cleanUpSnapPhotos(true);
    setNote(n ? `Deleted ${n} expired ${n === 1 ? "photo" : "photos"}.` : "Nothing to clean up.");
  }

  return (
    <div className="admin-snaps">
      <div className="admin-snaps-head">
        <p className="leaders-sub">Waiting for you · turned down after 12 hours</p>
        <button type="button" className="mini-btn" onClick={sweep}>
          🧹 Clean up expired photos
        </button>
      </div>
      {note && <p className="admin-empty">{note}</p>}
      {!items ? (
        <p className="admin-empty" aria-busy="true">Loading…</p>
      ) : items.length === 0 ? (
        <p className="admin-empty">No snaps waiting. 🎉</p>
      ) : (
        items.map((s) => <SnapReview key={s.pollId} item={s} onDecide={decide} />)
      )}
    </div>
  );
}

function SnapReview({ item, onDecide }: { item: Pending; onDecide: (id: string, approve: boolean) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    snapPhotoUrl(item.path).then(setSrc, () => {});
  }, [item.path]);

  return (
    <section className="review-card">
      <div className="review-row">
        <button type="button" className={`review-photo${shown ? " review-shown" : ""}`} onClick={() => setShown((s) => !s)} aria-label={shown ? "Blur photo" : "Show photo"}>
          {/* A signed link to a private photo. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {src && <img src={src} alt="" />}
        </button>
        <div className="review-info">
          <strong>&ldquo;{item.question}&rdquo;</strong>
          <span className="poll-foot-note">
            @{item.creator} · {item.visibility === "public" ? "🌍 Everyone" : "👥 Friends"}
            {item.status === "pending" && " · check didn't run"}
          </span>
          {item.scores && (
            <dl className="review-scores">
              {LABELS.map(([k, label]) =>
                item.scores?.[k] !== undefined ? (
                  <div key={k}>
                    <dt>{label}</dt>
                    <dd className={item.scores[k] > 0.3 ? "score-high" : ""}>{item.scores[k].toFixed(2)}</dd>
                  </div>
                ) : null,
              )}
              {item.scores.unchecked && <div><dt>Not checked (no OpenAI key)</dt><dd>–</dd></div>}
            </dl>
          )}
        </div>
      </div>
      <div className="review-actions">
        <button type="button" className="mini-btn mini-btn-mint" onClick={() => onDecide(item.pollId, true)}>
          Approve
        </button>
        <button type="button" className="mini-btn mini-btn-danger" onClick={() => onDecide(item.pollId, false)}>
          Reject
        </button>
      </div>
    </section>
  );
}
