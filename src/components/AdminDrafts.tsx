"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  addCalendarDay,
  approveDrafts,
  draftFromTrend,
  fetchDrafts,
  fetchTrends,
  removeCalendarDay,
  requestAgentRun,
  saveAgentSettings,
  saveDraft,
  skipDrafts,
  unscheduleDraft,
  type AgentSettings,
  type Draft,
  type DraftInput,
  type DraftsData,
  type RunSlot,
  type TrendsData,
} from "@/lib/admin";
import { Loading } from "./AdminGrowth";
import { FEEL_LABEL, LANG_LABEL, TOPIC_LABEL, Tags } from "./AdminLikes";

// Admin → Content → Drafts and Trending now: the content agent's morning drafts (approve, change
// or skip them; nothing posts without Approve), what it read, and the days coming up.

const SLOT_LABEL: Record<Draft["slot"], string> = {
  timely: "Timely",
  emotional: "Emotional or relatable",
  best: "Best combo",
  experiment: "Experiment",
  trend: "From a headline",
  manual: "Draft",
};
const PROBLEM: Record<string, string> = {
  day_full: "that day already has its most posts (change the time, or raise the limit below)",
  day_taken: "that day already has a Poll of the Day",
  blocked_words: "it has a blocked word",
  no_username: "your account has no username yet",
  past_day: "that day has passed",
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const RUN_LABEL: Record<RunSlot, string> = { morning: "Morning set", "13": "1 pm refresh", "18": "6 pm refresh", manual: "Written" };
const bySarvam = (model: string | null) => Boolean(model?.toLowerCase().startsWith("sarvam"));
/** "40m ago", "3h ago", "2d ago". */
export function age(iso: string, now = Date.now()) {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${Math.max(1, m)}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

// Times are shown and entered in India time.
const IST = 330 * 60000;
const istDate = (iso: string) => new Date(new Date(iso).getTime() + IST).toISOString().slice(0, 10);
export function when(iso: string, now = new Date()) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).replace(":00", "");
  const day = istDate(iso);
  const today = istDate(now.toISOString());
  const tomorrow = istDate(new Date(now.getTime() + 864e5).toISOString());
  if (day === today) return `Today ${time}`;
  if (day === tomorrow) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}
const toInput = (iso: string) => new Date(new Date(iso).getTime() + IST).toISOString().slice(0, 16);
const fromInput = (v: string) => new Date(new Date(`${v}:00Z`).getTime() - IST).toISOString();

function useData<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(() => {
    load()
      .then((v) => {
        setData(v);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [load]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, failed, reload };
}

const Failed = () => <p className="poll-error ppl-pad">Couldn&apos;t load this. Has 20261211000000_content_agent.sql been run?</p>;

function As({ d }: { d: Pick<Draft, "postAs"> }) {
  return d.postAs === "you" ? <span className="dr-as">You</span> : <span className="dr-as dr-as-e">Eithr</span>;
}

function DraftEditor({ draft, adminUsername, onDone }: { draft: Draft; adminUsername: string | null; onDone: (saved: boolean) => void }) {
  const [d, setD] = useState<DraftInput>({
    question: draft.question,
    answers: draft.answers.length >= 2 ? [...draft.answers] : [...draft.answers, "", ""].slice(0, 2),
    topic: draft.topic ?? "daily",
    feel: draft.feel ?? "debate",
    timely: draft.timely ?? false,
    lang: draft.lang ?? "en",
    postAs: draft.postAs,
    publishAt: draft.publishAt,
    openDays: draft.openDays,
    pollOfDay: draft.pollOfDay,
    notify: draft.notify,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `dr-${draft.id.slice(0, 8)}`;
  const eithr = d.postAs === "eithr";
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveDraft(draft.id, { ...d, answers: d.answers.map((a) => a.trim()).filter(Boolean), pollOfDay: eithr && d.pollOfDay, notify: eithr && d.notify });
      onDone(true);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setError(
        {
          question_length: "The question needs 3 to 140 characters.",
          answers: "Give 2 to 4 different answers, each up to 40 characters.",
          blocked_words: "That has a blocked word in it.",
          when: "Pick a time within the next 14 days.",
          day_full: "That day already has its most posts.",
        }[code] ?? "Couldn't save. Try again.",
      );
      setBusy(false);
    }
  };
  return (
    <div className="dr-edit">
      <label htmlFor={`${id}-q`}>
        Question
        <textarea id={`${id}-q`} className="field-input" rows={2} maxLength={140} value={d.question} onChange={(e) => setD({ ...d, question: e.target.value })} />
      </label>
      <div className="dr-answers">
        {d.answers.map((a, i) => (
          <label key={i} htmlFor={`${id}-a${i}`}>
            Answer {i + 1}
            <span className="dr-answer">
              <input
                id={`${id}-a${i}`}
                className="field-input"
                maxLength={40}
                value={a}
                onChange={(e) => setD({ ...d, answers: d.answers.map((x, j) => (j === i ? e.target.value : x)) })}
              />
              {d.answers.length > 2 && (
                <button type="button" className="ppl-mini press" aria-label={`Remove answer ${i + 1}`} onClick={() => setD({ ...d, answers: d.answers.filter((_, j) => j !== i) })}>
                  ×
                </button>
              )}
            </span>
          </label>
        ))}
        {d.answers.length < 4 && (
          <button type="button" className="ppl-mini press dr-add" onClick={() => setD({ ...d, answers: [...d.answers, ""] })}>
            + Answer
          </button>
        )}
      </div>
      <fieldset className="dr-seg">
        <legend>Post as</legend>
        <div className="dr-seg-opts">
          <button type="button" className="press" aria-pressed={eithr} onClick={() => setD({ ...d, postAs: "eithr" })}>
            <b>Eithr</b>
            <small>Badge, not on your profile</small>
          </button>
          <button type="button" className="press" aria-pressed={!eithr} disabled={!adminUsername} onClick={() => setD({ ...d, postAs: "you" })}>
            <b>{adminUsername ? `You (@${adminUsername})` : "You"}</b>
            <small>{adminUsername ? "Your name and profile" : "Pick a username first"}</small>
          </button>
        </div>
      </fieldset>
      <div className="dr-row">
        <label htmlFor={`${id}-at`}>
          When (India time)
          <input id={`${id}-at`} type="datetime-local" className="field-input" value={toInput(d.publishAt)} onChange={(e) => e.target.value && setD({ ...d, publishAt: fromInput(e.target.value) })} />
        </label>
        <label htmlFor={`${id}-days`}>
          Open for
          <select id={`${id}-days`} className="field-input" value={d.openDays} onChange={(e) => setD({ ...d, openDays: Number(e.target.value) as 1 | 3 | 7 })}>
            <option value={1}>1 day</option>
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
          </select>
        </label>
      </div>
      <div className="dr-row dr-row-4">
        <label htmlFor={`${id}-topic`}>
          Topic
          <select id={`${id}-topic`} className="field-input" value={d.topic ?? ""} onChange={(e) => setD({ ...d, topic: e.target.value })}>
            {Object.entries(TOPIC_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-feel`}>
          Feel
          <select id={`${id}-feel`} className="field-input" value={d.feel ?? ""} onChange={(e) => setD({ ...d, feel: e.target.value })}>
            {Object.entries(FEEL_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-lang`}>
          Language
          <select id={`${id}-lang`} className="field-input" value={d.lang ?? "en"} onChange={(e) => setD({ ...d, lang: e.target.value })}>
            {Object.entries(LANG_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="dr-check" htmlFor={`${id}-timely`}>
          <input id={`${id}-timely`} type="checkbox" checked={Boolean(d.timely)} onChange={(e) => setD({ ...d, timely: e.target.checked })} />
          Timely
        </label>
      </div>
      {eithr && (
        <div className="dr-switches">
          {draft.status === "new" && (
            <label className="dr-check" htmlFor={`${id}-potd`}>
              <input id={`${id}-potd`} type="checkbox" checked={d.pollOfDay} onChange={(e) => setD({ ...d, pollOfDay: e.target.checked })} />
              <span>
                Poll of the Day
                <small>Pinned for everyone on that day, with the 9 am push</small>
              </span>
            </label>
          )}
          <label className="dr-check" htmlFor={`${id}-notify`}>
            <input id={`${id}-notify`} type="checkbox" checked={d.notify} onChange={(e) => setD({ ...d, notify: e.target.checked })} />
            <span>
              Send a push to everyone
              <small>&ldquo;New on Eithr&rdquo; when it goes live. Off: it just appears in the feed</small>
            </span>
          </label>
        </div>
      )}
      <div className="dr-go">
        <button type="button" className="ppl-mini press" onClick={() => onDone(false)} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="ppl-mini dr-save press" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save draft"}
        </button>
      </div>
      {error && <p className="poll-error dr-err">{error}</p>}
    </div>
  );
}

function DraftCard({
  d,
  adminUsername,
  editing,
  onEdit,
  onDone,
  children,
}: {
  d: Draft;
  adminUsername: string | null;
  editing: boolean;
  onEdit: () => void;
  onDone: (saved: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <li className={`dr-card${editing ? " dr-open" : ""}`}>
      <div className="dr-body">
        <b className="dr-q">{d.question}</b>
        <span className="dr-opts">
          {d.answers.map((a) => (
            <span key={a}>{a}</span>
          ))}
        </span>
        <Tags t={d} />
        <small className="dr-meta">
          <As d={d} /> · {d.status === "posted" && d.postedAt ? `Posted ${when(d.postedAt)}` : when(d.publishAt)} · {SLOT_LABEL[d.slot]}
          {d.pollOfDay ? " · Poll of the Day" : ""}
          {d.postAs === "eithr" && d.notify ? " · push to everyone" : ""}
          {d.openDays > 1 ? ` · ${d.openDays} days` : ""}
        </small>
        {d.why && <small className="dr-why">{d.why}</small>}
        {(d.source || (d.expiresAt && d.status === "new") || bySarvam(d.runModel)) && (
          <span className="dr-srcline">
            {d.source && <small className="dr-src">{d.source}</small>}
            {d.sourceAt && <span className="dr-age">{age(d.sourceAt)}</span>}
            {d.expiresAt && d.status === "new" && <span className="dr-exp">Expires {when(d.expiresAt)}</span>}
            {bySarvam(d.runModel) && <span className="dr-age dr-model">Written by Sarvam</span>}
          </span>
        )}
      </div>
      {editing ? <DraftEditor draft={d} adminUsername={adminUsername} onDone={onDone} /> : <div className="dr-acts">{children}</div>}
      {!editing && d.status !== "posted" && d.status !== "failed" && (
        <button type="button" className="ppl-mini press dr-edit-btn" onClick={onEdit} aria-label={`Change: ${d.question}`}>
          Change
        </button>
      )}
    </li>
  );
}

/** A heading where a new group of drafts starts: "Fresh · 6 pm", "Fresh · 1 pm", "Earlier". */
function DraftGroup({ d, prev, grouped, children }: { d: Draft; prev: Draft | null; grouped: boolean; children: React.ReactNode }) {
  const group = (x: Draft) => (x.runSlot === "18" ? "Fresh · 6 pm" : x.runSlot === "13" ? "Fresh · 1 pm" : "Earlier");
  const heading = grouped && (!prev || group(prev) !== group(d)) ? group(d) : null;
  // Only worth a heading when there's a fresh group at all.
  if (!heading || (heading === "Earlier" && !prev)) return <>{children}</>;
  return (
    <>
      <li className="dr-group" aria-hidden="true">
        {heading}
      </li>
      {children}
    </>
  );
}

function Settings({ s, onSaved }: { s: AgentSettings; onSaved: (s: AgentSettings) => void }) {
  const [v, setV] = useState(s);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const changed = JSON.stringify(v) !== JSON.stringify(s);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const next = await saveAgentSettings(v);
      onSaved(next);
      setV(next);
      setMsg("Saved.");
    } catch {
      setMsg("Couldn't save. Try again.");
    }
    setBusy(false);
  };
  return (
    <section className="ppl-card ppl-pad ppl-stack" aria-labelledby="dr-settings">
      <h2 id="dr-settings" className="err-label gr-h">
        What the agent writes
      </h2>
      <label className="dr-check" htmlFor="dr-paused">
        <input id="dr-paused" type="checkbox" checked={v.paused} onChange={(e) => setV({ ...v, paused: e.target.checked })} />
        <span>
          Pause the agent
          <small>No morning drafts until you turn it back on (Write drafts now still works)</small>
        </span>
      </label>
      <div className="dr-row dr-row-4">
        <label htmlFor="dr-n">
          Drafts a day
          <select id="dr-n" className="field-input" value={v.draftsPerDay} onChange={(e) => setV({ ...v, draftsPerDay: Number(e.target.value) })}>
            {[4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label htmlFor="dr-max">
          Most posts a day
          <select id="dr-max" className="field-input" value={v.postsPerDay} onChange={(e) => setV({ ...v, postsPerDay: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label htmlFor="dr-as">
          Usually post as
          <select id="dr-as" className="field-input" value={v.postAs} onChange={(e) => setV({ ...v, postAs: e.target.value === "you" ? "you" : "eithr" })}>
            <option value="eithr">Eithr</option>
            <option value="you">You</option>
          </select>
        </label>
        <label htmlFor="dr-hi">
          Hinglish
          <select id="dr-hi" className="field-input" value={v.hinglish} onChange={(e) => setV({ ...v, hinglish: Number(e.target.value) })}>
            {[0, 20, 30, 40, 50, 60, 70, 80, 100].map((n) => (
              <option key={n} value={n}>
                {n}%
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="dr-row dr-row-4">
        <label className="dr-check" htmlFor="dr-r13">
          <input id="dr-r13" type="checkbox" checked={v.refresh1pm} onChange={(e) => setV({ ...v, refresh1pm: e.target.checked })} />
          Refresh at 1 pm
        </label>
        <label className="dr-check" htmlFor="dr-r18">
          <input id="dr-r18" type="checkbox" checked={v.refresh6pm} onChange={(e) => setV({ ...v, refresh6pm: e.target.checked })} />
          Refresh at 6 pm
        </label>
        <label htmlFor="dr-rn">
          Drafts a refresh
          <select id="dr-rn" className="field-input" value={v.refreshDrafts} onChange={(e) => setV({ ...v, refreshDrafts: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label htmlFor="dr-th">
          Timely drafts last
          <select id="dr-th" className="field-input" value={v.timelyHours} onChange={(e) => setV({ ...v, timelyHours: Number(e.target.value) })}>
            {[4, 6, 8, 12, 24, 48].map((n) => (
              <option key={n} value={n}>
                {n} hours
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="ppl-note">Refreshes write only about headlines that are new since earlier that day; nothing new, no drafts and no push. A timely draft not approved in time expires.</p>
      <fieldset className="dr-topics">
        <legend>Topics it won&apos;t write (politics, religion, deaths, accidents and crime are always off)</legend>
        {Object.entries(TOPIC_LABEL).map(([k, label]) => {
          const off = v.topicsOff.includes(k);
          return (
            <button
              key={k}
              type="button"
              className={`lk-tag press ${off ? "lk-none" : "lk-t"}`}
              aria-pressed={off}
              onClick={() => setV({ ...v, topicsOff: off ? v.topicsOff.filter((t) => t !== k) : [...v.topicsOff, k] })}
            >
              {off ? `${label} · off` : label}
            </button>
          );
        })}
      </fieldset>
      <div className="dr-go">
        {msg && (
          <span className="ppl-note" role="status">
            {msg}
          </span>
        )}
        <button type="button" className="ppl-mini dr-save press" onClick={save} disabled={!changed || busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}

type View = "new" | "scheduled" | "posted";

export function AdminDrafts() {
  const { data, failed, reload } = useData<DraftsData>(fetchDrafts);
  const [view, setView] = useState<View>("new");
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState<string | null>(null);
  // Approved here: they stay in New, marked approved (with Undo), until the screen is opened again.
  const [approvedNow, setApprovedNow] = useState<string[]>([]);
  // Why a draft wasn't approved, shown on its own card.
  const [notApproved, setNotApproved] = useState<Record<string, string>>({});

  if (failed) return <Failed />;
  if (!data) return <Loading />;
  // New drafts: the latest refresh first (6 pm, then 1 pm), then the rest, each by time.
  const rank = (d: Draft) => (d.runSlot === "18" ? 0 : d.runSlot === "13" ? 1 : 2);
  const justApproved = [...data.scheduled, ...data.posted].filter((d) => approvedNow.includes(d.id));
  const fresh = [...data.fresh, ...justApproved].sort((a, b) => rank(a) - rank(b) || a.publishAt.localeCompare(b.publishAt));
  const list = view === "new" ? fresh : view === "scheduled" ? data.scheduled : data.posted;
  const approve = async (ids: string[]) => {
    setBusy(true);
    setNote(null);
    try {
      const r = await approveDrafts(ids);
      const refused = new Set(r.problems.map((p) => p.id));
      setApprovedNow((a) => [...a, ...ids.filter((id) => !refused.has(id))]);
      setNotApproved((m) => {
        const next = { ...m };
        for (const id of ids) delete next[id];
        for (const p of r.problems) next[p.id] = PROBLEM[p.error] ?? p.error;
        return next;
      });
      setNote({
        text: [r.approved ? `${plural(r.approved, "draft")} approved.` : "", r.problems.length ? `${plural(r.problems.length, "draft")} not approved: see why on the card.` : ""]
          .filter(Boolean)
          .join(" "),
        bad: r.problems.length > 0,
      });
    } catch {
      setNote({ text: "Couldn't approve. Try again.", bad: true });
    }
    setBusy(false);
    reload();
  };
  const skip = async (ids: string[]) => {
    setBusy(true);
    await skipDrafts(ids).catch(() => setNote({ text: "Couldn't skip. Try again.", bad: true }));
    setBusy(false);
    reload();
  };
  const back = async (id: string) => {
    await unscheduleDraft(id).catch(() => setNote({ text: "Couldn't move it back. Try again.", bad: true }));
    reload();
  };
  const run = data.lastRun;
  const requested = asked ?? (data.requestedAt && (!run || data.requestedAt > run.startedAt) ? data.requestedAt : null);
  return (
    <div className="ppl gr dr">
      <section className="ppl-card ppl-pad dr-status" aria-label="The agent">
        <div>
          <b>
            {data.settings.paused
              ? "Paused: no morning drafts"
              : !run
                ? "The agent writes at 6:30 am India time"
                : run.status === "running"
                  ? "Writing drafts now…"
                  : run.status === "failed"
                    ? `Last run didn't finish (${when(run.startedAt)})`
                    : `${run.slot ? RUN_LABEL[run.slot] : "Last written"} ${when(run.startedAt)} · ${run.slot === "13" || run.slot === "18" ? plural(run.drafts, "fresh draft") : plural(run.drafts, "draft")}`}
          </b>
          <small>
            {run?.status === "done" && bySarvam(run.model) ? "Written by Sarvam because OpenAI failed (check Admin → Errors). " : ""}
            {run?.status === "failed" && run.error ? `${run.error}. ` : ""}
            {requested ? `Asked at ${when(requested)}: new drafts within a few minutes.` : `Today ${data.todayPosts}/${data.settings.postsPerDay} posts planned · tomorrow ${data.tomorrowPosts}.`}
          </small>
        </div>
        <button
          type="button"
          className="ppl-mini press"
          disabled={Boolean(requested) || run?.status === "running"}
          onClick={async () => {
            try {
              setAsked(await requestAgentRun());
            } catch {
              setNote({ text: "Couldn't ask. Try again.", bad: true });
            }
          }}
        >
          Write drafts now
        </button>
      </section>

      <div className="err-range" role="group" aria-label="Show">
        {(
          [
            ["new", `New ${data.fresh.length}`],
            ["scheduled", `Scheduled ${data.scheduled.length}`],
            ["posted", "Posted"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" className="err-pill press" aria-pressed={view === k} onClick={() => setView(k)}>
            {label}
          </button>
        ))}
      </div>

      {note && (
        <p className={`lk-note${note.bad ? " lk-warn" : " lk-ok"}`} role="status">
          {note.text}
        </p>
      )}

      {view === "new" && data.expiredToday.length > 0 && (
        <p className="dr-gone">
          {plural(data.expiredToday.length, "timely draft")} expired today, not approved in time: &ldquo;{data.expiredToday[0].question}&rdquo;
          {data.expiredToday.length > 1 ? ` and ${data.expiredToday.length - 1} more` : ""}.
        </p>
      )}

      {view === "new" && data.fresh.length > 1 && (
        <button type="button" className="btn btn-coral dr-all press" disabled={busy} onClick={() => approve(data.fresh.map((d) => d.id))}>
          Approve all {data.fresh.length} as suggested
        </button>
      )}

      {list.length ? (
        <ul className="dr-list">
          {list.map((d, i) => (
            <DraftGroup key={d.id} d={d} prev={i > 0 ? list[i - 1] : null} grouped={view === "new"}>
            <DraftCard
              key={d.id}
              d={d}
              adminUsername={data.adminUsername}
              editing={editing === d.id}
              onEdit={() => {
                setEditing(d.id);
                setNote(null);
              }}
              onDone={(saved) => {
                setEditing(null);
                if (saved) {
                  setNote({ text: "Draft saved." });
                  reload();
                }
              }}
            >
              {d.status === "new" && notApproved[d.id] && (
                <span className="dr-failed" role="status">
                  Not approved: {notApproved[d.id]}.
                </span>
              )}
              {d.status === "new" && (
                <>
                  <button type="button" className="ppl-mini press" disabled={busy} onClick={() => skip([d.id])} aria-label={`Skip: ${d.question}`}>
                    Skip
                  </button>
                  <button type="button" className="ppl-mini dr-save press" disabled={busy} onClick={() => approve([d.id])} aria-label={`Approve: ${d.question}`}>
                    Approve
                  </button>
                </>
              )}
              {view === "new" && approvedNow.includes(d.id) && d.status !== "new" && (
                <>
                  <span className="dr-ok" role="status">
                    ✓ Approved · {d.status === "posted" ? "Poll of the Day made" : `goes out ${when(d.publishAt)}`}
                  </span>
                  {d.status === "scheduled" && (
                    <button
                      type="button"
                      className="ppl-mini press"
                      onClick={async () => {
                        await back(d.id);
                        setApprovedNow((a) => a.filter((x) => x !== d.id));
                      }}
                      aria-label={`Undo: ${d.question}`}
                    >
                      Undo
                    </button>
                  )}
                </>
              )}
              {view !== "new" && d.status === "scheduled" && (
                <button type="button" className="ppl-mini press" onClick={() => back(d.id)} aria-label={`Back to drafts: ${d.question}`}>
                  Back to drafts
                </button>
              )}
              {view === "posted" && d.status === "posted" && d.pollId && (
                <span className="dr-result">
                  {d.votes !== null && <span>{plural(d.votes, "vote")}</span>}
                  {d.spark !== null && <span>Spark {d.spark}</span>}
                  <Link href={`/p/${d.pollId}`} className="ppl-mini">
                    Open
                  </Link>
                </span>
              )}
              {d.status === "failed" && <span className="dr-failed">Didn&apos;t post: {PROBLEM[d.error ?? ""] ?? d.error}</span>}
            </DraftCard>
            </DraftGroup>
          ))}
        </ul>
      ) : (
        <p className="admin-empty ppl-pad">
          {view === "new"
            ? "No drafts waiting. The next ones come at 6:30 am, or tap Write drafts now."
            : view === "scheduled"
              ? "Nothing scheduled. Approve a draft to schedule it."
              : "Nothing posted from drafts yet."}
        </p>
      )}

      <Settings s={data.settings} onSaved={() => reload()} />
    </div>
  );
}

export function AdminTrends() {
  const { data, failed, reload } = useData<TrendsData>(fetchTrends);
  const [note, setNote] = useState<string | null>(null);
  const [day, setDay] = useState("");
  const [label, setLabel] = useState("");
  if (failed) return <Failed />;
  if (!data) return <Loading />;
  const today = istDate(new Date().toISOString());
  const ideas = data.items.filter((t) => !t.skipReason);
  const skipped = data.items.filter((t) => t.skipReason);
  return (
    <div className="ppl gr dr">
      <p className="ppl-note">
        {data.readAt
          ? `Last read ${when(data.readAt)} from Google Trends India and news, cricket, sports, entertainment and tech headlines. Read again at 1 pm and 6 pm: new ones are marked.`
          : "Nothing read yet: the agent reads the trends when it writes drafts (6:30 am, 1 pm, 6 pm, or Write drafts now in Drafts)."}
      </p>
      {note && (
        <p className="lk-note lk-ok" role="status">
          {note}
        </p>
      )}
      <div className="ppl-two">
        <section className="ppl-card ppl-stack" aria-labelledby="tr-now">
          <h2 id="tr-now" className="err-label ppl-pad gr-h">
            Trending now
          </h2>
          {ideas.length ? (
            <ul className="dr-list dr-flat">
              {ideas.map((t) => (
                <li key={t.id} className="dr-card">
                  <div className="dr-body">
                    <span className="dr-srcline">
                      <small className="dr-src">
                        {t.source}
                        {t.region ? ` · ${t.region}` : ""}
                      </small>
                      {(t.runSlot === "13" || t.runSlot === "18") && <span className="dr-new">New · {t.runSlot === "13" ? "1 pm" : "6 pm"}</span>}
                      {t.publishedAt && <span className="dr-age">{age(t.publishedAt)}</span>}
                    </span>
                    {t.url ? (
                      <a className="dr-title" href={t.url} target="_blank" rel="noopener noreferrer">
                        {t.title}
                      </a>
                    ) : (
                      <span className="dr-title">{t.title}</span>
                    )}
                    {t.gloss && <small className="dr-gloss">{t.gloss}</small>}
                    {t.ideaQuestion ? (
                      <>
                        <span className="dr-idea">
                          <b>Idea:</b> {t.ideaQuestion} <span className="dr-opts">{t.ideaAnswers.map((a) => <span key={a}>{a}</span>)}</span>
                        </span>
                        <Tags t={t} />
                      </>
                    ) : (
                      <small className="dr-why">No poll idea for this one.</small>
                    )}
                  </div>
                  <div className="dr-acts">
                    {t.drafted ? (
                      <span className="ppl-chip ppl-on">Drafted</span>
                    ) : t.ideaQuestion ? (
                      <button
                        type="button"
                        className="ppl-mini dr-save press"
                        aria-label={`Draft it: ${t.title}`}
                        onClick={async () => {
                          try {
                            await draftFromTrend(t.id);
                            setNote("Added to Drafts.");
                          } catch {
                            setNote("Couldn't add it. Try again.");
                          }
                          reload();
                        }}
                      >
                        Draft it
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-empty ppl-pad">No trends yet.</p>
          )}
          {skipped.length > 0 && (
            <>
              <h3 className="err-label ppl-pad gr-h">Left out</h3>
              <ul className="dr-list dr-flat">
                {skipped.map((t) => (
                  <li key={t.id} className="dr-card dr-skipped">
                    <div className="dr-body">
                      <small className="dr-src">{t.source}</small>
                      <span className="dr-title">{t.title}</span>
                      <small className="dr-why">{t.skipReason}</small>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section className="ppl-card ppl-pad ppl-stack" aria-labelledby="tr-cal">
          <h2 id="tr-cal" className="err-label gr-h">
            Coming up
          </h2>
          <p className="ppl-note">The agent plans timely polls around these. Add festivals, matches, releases and exam days.</p>
          {data.calendar.length ? (
            <ul className="dr-cal">
              {data.calendar.map((c) => (
                <li key={c.id}>
                  <time>{new Date(`${c.day}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</time>
                  <span>{c.label}</span>
                  <button
                    type="button"
                    className="ppl-mini press"
                    aria-label={`Remove ${c.label}`}
                    onClick={async () => {
                      await removeCalendarDay(c.id).catch(() => setNote("Couldn't remove it."));
                      reload();
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-empty">Nothing in the next 60 days.</p>
          )}
          <form
            className="dr-row dr-cal-add"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!day || label.trim().length < 2) return;
              try {
                await addCalendarDay(day, label.trim());
                setDay("");
                setLabel("");
                setNote("Added.");
              } catch {
                setNote("Couldn't add it: pick a day from today on and a name of 2–60 characters.");
              }
              reload();
            }}
          >
            <label htmlFor="cal-day">
              Day
              <input id="cal-day" type="date" className="field-input" min={today} value={day} onChange={(e) => setDay(e.target.value)} />
            </label>
            <label htmlFor="cal-label">
              What
              <input id="cal-label" className="field-input" maxLength={60} placeholder="Bhai Dooj, IPL final…" value={label} onChange={(e) => setLabel(e.target.value)} />
            </label>
            <button type="submit" className="ppl-mini dr-save press" disabled={!day || label.trim().length < 2}>
              Add
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
