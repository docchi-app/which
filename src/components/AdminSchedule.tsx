"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchSchedule, schedulePoll, unschedule, type PollKind, type ScheduleDay, type ScheduleInput } from "@/lib/admin";
import { useBackClose } from "@/lib/back";
import { failureText } from "@/lib/failure";

const ERRORS: Record<string, string> = {
  day_taken: "That day already has a Poll of the Day.",
  past_day: "Pick today or a later day.",
  question_length: "The question needs 3 to 140 characters.",
  answer_length: "Answers can be up to 60 characters.",
  answer_count: "Add 2 to 4 answers.",
  duplicate_answers: "Two answers are the same.",
  teaser_length: "A mystery poll needs a teaser (3 to 60 characters), like “Pick a colour”.",
  bad_days: "Keep it open for 1 to 7 days.",
  already_live: "That one's already live, so it can't be changed.",
  not_admin: "Only admins can do this.",
};

const KINDS: { id: PollKind; label: string }[] = [
  { id: "classic", label: "Classic" },
  { id: "hot_take", label: "Hot take" },
  { id: "mystery", label: "Mystery" },
];

/** India-time "today", as YYYY-MM-DD. */
function todayIST() {
  return new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
}

function dayLabel(day: string) {
  const d = day.slice(0, 10);
  const today = todayIST();
  const tomorrow = new Date(Date.parse(today) + 864e5).toISOString().slice(0, 10);
  const yesterday = new Date(Date.parse(today) - 864e5).toISOString().slice(0, 10);
  if (d === today) return "Today";
  if (d === tomorrow) return "Tomorrow";
  if (d === yesterday) return "Yesterday";
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** Admin → Schedule: Poll of the Day for each day, gaps highlighted, add / edit / remove. */
export function Schedule() {
  const [days, setDays] = useState<ScheduleDay[] | null>(null);
  const [editing, setEditing] = useState<ScheduleInput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchSchedule(21)
      .then(setDays)
      .catch(() => setError("Couldn't load the schedule."));
  }, []);
  useEffect(load, [load]);

  if (error && !days) return <p className="poll-error">{error}</p>;
  if (!days) return <p className="admin-empty" aria-busy="true">Loading…</p>;

  const today = todayIST();
  const upcoming = days.filter((d) => d.day.slice(0, 10) >= today);
  const gapsThisWeek = upcoming.slice(0, 7).filter((d) => !d.pollId).length;

  return (
    <section className="admin-schedule">
      <p className={`schedule-summary ${gapsThisWeek ? "schedule-summary-warn" : ""}`}>
        {gapsThisWeek
          ? `${gapsThisWeek} of the next 7 days ${gapsThisWeek === 1 ? "has" : "have"} no Poll of the Day.`
          : "The next 7 days are all set ✓"}{" "}
        Each one goes live at midnight India time.
      </p>
      <ul className="admin-list">
        {days.map((d) => {
          const date = d.day.slice(0, 10);
          const past = date < today;
          return (
            <li key={date} className={`admin-card schedule-day ${!d.pollId && !past ? "schedule-gap" : ""}`}>
              <div className="admin-card-top">
                <strong className="schedule-date">{dayLabel(d.day)}</strong>
                {d.pollId && (
                  <span className="chip chip-small chip-white">
                    {KINDS.find((k) => k.id === d.kind)?.label ?? d.kind}
                  </span>
                )}
                {d.live && <span className="chip chip-small chip-mint">Live · {d.voteCount} votes</span>}
                {d.pollId && !d.live && <span className="admin-count">open {d.openDays} days</span>}
              </div>
              {d.pollId ? (
                <>
                  <p className="admin-q">{d.question}</p>
                  {d.teaser && <p className="admin-meta">Teaser: {d.teaser}</p>}
                  <p className="admin-meta">{d.options.join(" · ")}</p>
                  {!d.live && (
                    <div className="admin-actions">
                      <button
                        type="button"
                        className="mini-btn"
                        onClick={() =>
                          setEditing({
                            day: date,
                            question: d.question ?? "",
                            answers: d.kind === "hot_take" ? ["", ""] : d.options,
                            kind: d.kind ?? "classic",
                            teaser: d.teaser ?? "",
                            openDays: d.openDays ?? 3,
                            pollId: d.pollId!,
                          })
                        }
                      >
                        Edit
                      </button>
                      <RemoveButton pollId={d.pollId} onDone={load} />
                    </div>
                  )}
                </>
              ) : past ? (
                <p className="admin-meta">No Poll of the Day.</p>
              ) : (
                <button
                  type="button"
                  className="mini-btn mini-btn-coral schedule-add"
                  onClick={() => setEditing({ day: date, question: "", answers: ["", ""], kind: "classic", teaser: "", openDays: 3 })}
                >
                  + Add a Poll of the Day
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {editing && (
        <ScheduleForm
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </section>
  );
}

function RemoveButton({ pollId, onDone }: { pollId: string; onDone: () => void }) {
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!sure) {
    return (
      <button type="button" className="mini-btn mini-btn-danger-text" onClick={() => setSure(true)}>
        Remove
      </button>
    );
  }
  return (
    <>
      <span className="confirm-text">Remove this day&apos;s poll?</span>
      <button
        type="button"
        className="mini-btn mini-btn-danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await unschedule(pollId);
          } finally {
            onDone();
          }
        }}
      >
        Remove
      </button>
      <button type="button" className="mini-btn" onClick={() => setSure(false)}>
        Cancel
      </button>
    </>
  );
}

function ScheduleForm({ initial, onClose, onSaved }: { initial: ScheduleInput; onClose: () => void; onSaved: () => void }) {
  // Back closes it too (and the phone's back button doesn't leave the screen).
  const close = useBackClose(true, onClose);
  const [f, setF] = useState<ScheduleInput>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<ScheduleInput>) => setF((x) => ({ ...x, ...patch }));
  const needsAnswers = f.kind !== "hot_take";

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await schedulePoll({ ...f, answers: f.answers.map((a) => a.trim()).filter(Boolean) });
      onSaved();
      close();
    } catch (e) {
      setError(failureText(e, ERRORS));
      setBusy(false);
    }
  }

  return (
    <div className="sheet-layer">
      <div className="sheet-backdrop" aria-hidden="true" onClick={close} />
      <section role="dialog" aria-modal="true" aria-labelledby="sched-title" className="sheet schedule-sheet">
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="sched-title" className="sheet-title">
          {f.pollId ? "Edit Poll of the Day" : "New Poll of the Day"}
        </h2>

        <label className="field">
          <span className="field-label">Day</span>
          <input type="date" className="field-input" min={todayIST()} value={f.day} onChange={(e) => set({ day: e.target.value })} />
        </label>

        <div className="field">
          <span className="field-label">Format</span>
          <div className="schedule-kinds" role="radiogroup" aria-label="Format">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                role="radio"
                aria-checked={f.kind === k.id}
                className="mini-btn"
                onClick={() => set({ kind: k.id })}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field-label">{f.kind === "hot_take" ? "The take" : "Question"}</span>
          <textarea
            className="field-input"
            rows={2}
            maxLength={140}
            value={f.question}
            placeholder={f.kind === "hot_take" ? "Cold coffee is better than hot coffee." : "Tea or coffee to start the day?"}
            onChange={(e) => set({ question: e.target.value })}
          />
        </label>

        {f.kind === "mystery" && (
          <label className="field">
            <span className="field-label">Teaser (what people see before voting)</span>
            <input className="field-input" maxLength={60} value={f.teaser} placeholder="Pick a colour" onChange={(e) => set({ teaser: e.target.value })} />
          </label>
        )}

        {needsAnswers ? (
          <div className="field">
            <span className="field-label">Answers</span>
            {f.answers.map((a, i) => (
              <div key={i} className="schedule-answer">
                <input
                  className="field-input"
                  maxLength={60}
                  value={a}
                  placeholder={`Answer ${i + 1}`}
                  aria-label={`Answer ${i + 1}`}
                  onChange={(e) => set({ answers: f.answers.map((x, j) => (j === i ? e.target.value : x)) })}
                />
                {f.answers.length > 2 && (
                  <button type="button" className="notif-prompt-x" aria-label={`Remove answer ${i + 1}`} onClick={() => set({ answers: f.answers.filter((_, j) => j !== i) })}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            {f.answers.length < 4 && (
              <button type="button" className="mini-btn" onClick={() => set({ answers: [...f.answers, ""] })}>
                + Add an answer
              </button>
            )}
          </div>
        ) : (
          <p className="admin-meta">Answers are always Agree / Disagree.</p>
        )}

        <label className="field">
          <span className="field-label">Open for</span>
          <select className="field-input" value={f.openDays} onChange={(e) => set({ openDays: Number(e.target.value) })}>
            {[1, 2, 3, 5, 7].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "day" : "days"}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <p className="poll-error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="post-btn press" onClick={save} disabled={busy}>
          {busy ? "Saving…" : f.pollId ? "Save changes" : "Schedule it"}
        </button>
        <button type="button" className="sheet-later" onClick={close}>
          Cancel
        </button>
      </section>
    </div>
  );
}
