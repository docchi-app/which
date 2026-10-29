"use client";

import { useEffect, useState } from "react";
import { adminLimits, type Limits } from "@/lib/admin";

const RANGE = { polls: [1, 50], snaps: [1, 20] } as const;
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** A number with − and + buttons, kept inside its range. */
function Stepper({ id, label, value, min, max, onChange }: { id: string; label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  const set = (n: number) => onChange(Math.min(max, Math.max(min, Math.round(n))));
  return (
    <span className="lim-step">
      <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => set(value - 1)}>
        −
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(e) => e.target.value !== "" && set(Number(e.target.value))}
      />
      <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => set(value + 1)}>
        +
      </button>
    </span>
  );
}

/** Admin → Run → Limits: polls a day and snaps a day, per person. */
export function AdminLimits() {
  const [saved, setSaved] = useState<Limits | null>(null);
  const [polls, setPolls] = useState(10);
  const [snaps, setSnaps] = useState(3);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    adminLimits()
      .then((l) => {
        if (!live) return;
        setSaved(l);
        setPolls(l.polls);
        setSnaps(l.snaps);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (failed) return <p className="poll-error ppl-pad">Couldn&apos;t load the limits. Has 20261208000000_limits.sql been run?</p>;
  if (!saved)
    return (
      <p className="admin-empty ppl-pad" aria-busy="true">
        Loading…
      </p>
    );
  const changed = polls !== saved.polls || snaps !== saved.snaps;

  async function save() {
    setState("saving");
    try {
      const l = await adminLimits({ polls, snaps });
      setSaved(l);
      setPolls(l.polls);
      setSnaps(l.snaps);
      setState("saved");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="ppl">
      <section className="ppl-card lim" aria-label="Limits">
        <div className="lim-row">
          <label htmlFor="lim-polls">
            <b>Polls a day, per person</b>
            <span>Typed polls, hot takes and mystery polls together.</span>
          </label>
          <Stepper id="lim-polls" label="Polls a day" value={polls} min={RANGE.polls[0]} max={RANGE.polls[1]} onChange={(n) => (setPolls(n), setState("idle"))} />
        </div>
        <div className="lim-row">
          <label htmlFor="lim-snaps">
            <b>Snaps a day, per person</b>
            <span>Photo polls.</span>
          </label>
          <Stepper id="lim-snaps" label="Snaps a day" value={snaps} min={RANGE.snaps[0]} max={RANGE.snaps[1]} onChange={(n) => (setSnaps(n), setState("idle"))} />
        </div>
        <div className="lim-row">
          <span>
            <b>Hot takes and mystery polls</b>
            <span>Inside the polls limit. Stays fixed.</span>
          </span>
          <span className="lim-fixed">1 a day</span>
        </div>
        <div className="lim-foot">
          <span className="ppl-note">Resets at midnight India time. You aren&apos;t limited. Polls 1–50, snaps 1–20.</span>
          <span className="lim-save">
            <span role="status" className={state === "failed" ? "lim-bad" : "lim-ok"}>
              {state === "saved" ? "✓ Saved · in the Admin log" : state === "failed" ? "Couldn't save. Try again." : changed ? "Not saved yet" : ""}
            </span>
            <button type="button" className="btn btn-ink press" disabled={!changed || state === "saving"} onClick={save}>
              {state === "saving" ? "Saving…" : "Save"}
            </button>
          </span>
        </div>
      </section>
      <section className="ppl-card" aria-labelledby="lim-changes">
        <h2 id="lim-changes" className="err-label ppl-pad gr-h">
          Changes
        </h2>
        {saved.changes.length ? (
          <ul className="lim-log">
            {saved.changes.map((c) => (
              <li key={c.at + c.detail}>
                <time dateTime={c.at}>{when(c.at)}</time>
                <span>{c.detail}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-empty ppl-pad">No changes yet. Polls started at 10 a day, snaps at 3.</p>
        )}
      </section>
    </div>
  );
}
