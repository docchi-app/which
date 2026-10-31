"use client";

import { useCallback, useState } from "react";
import { fetchLikes, setPollTags, type LikeCell, type LikeRow, type Likes, type PollTags, type TaggedPoll } from "@/lib/admin";
import { HBar, Loading, Range, Tile, useLoad } from "./AdminGrowth";
import { ago } from "./AdminUsers";

// Admin → Content → What people like: every poll's tags (topic, feel, timely, language, set by
// the AI in the 2-minute job or by you) and its Spark score, added up by tag.

export const TOPIC_LABEL: Record<string, string> = {
  cricket: "Cricket",
  sports: "Other sports",
  movies: "Movies & OTT",
  music: "Music",
  tv: "TV & reality",
  celebs: "Celebs",
  food: "Food",
  festivals: "Festivals",
  travel: "Travel",
  fashion: "Fashion",
  college: "College & exams",
  work: "Work & money",
  tech: "Tech",
  science: "Science & space",
  relationships: "Relationships",
  family: "Friends & family",
  daily: "Daily life",
  news: "News",
  fun: "Fun & what-if",
};
export const FEEL_LABEL: Record<string, string> = {
  debate: "Debate",
  relatable: "Relatable",
  emotional: "Emotional",
  nostalgia: "Nostalgia",
  would_you: "Would you rather",
  predict: "Predict",
  quiz: "Quiz",
  funny: "Funny",
};
export const LANG_LABEL: Record<string, string> = { en: "English", hinglish: "Hinglish", hi: "Hindi", other: "Other" };
const TIME_LABEL: Record<string, string> = {
  morning: "Morning, 6–12",
  afternoon: "Afternoon, 12–5",
  evening: "Evening, 5–9",
  night: "Night, 9–12",
  late: "Late night, 12–6",
};
const WHO_LABEL: Record<string, string> = { eithr: "Eithr", you: "You", people: "People" };
const TIMING_LABEL: Record<string, string> = { timely: "Timely", evergreen: "Evergreen" };

// Five polls or more and we're fairly sure; fewer is an early sign.
const CLEAR = 5;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const heat = (s: number) => (s >= 80 ? "lk-h4" : s >= 65 ? "lk-h3" : s >= 45 ? "lk-h2" : "lk-h1");

function Sure({ n }: { n: number }) {
  return n >= CLEAR ? <span className="lk-sure lk-clear">Clear</span> : <span className="lk-sure lk-early">Early</span>;
}

function Change({ now, before, beforeN }: { now: number; before: number | null; beforeN: number }) {
  if (before === null || !beforeN) return <small>new</small>;
  const d = now - before;
  if (!d) return <small>same as before</small>;
  return <small className={d > 0 ? "gr-good" : "gr-bad"}>{d > 0 ? `▲ ${d}` : `▼ ${-d}`} vs before</small>;
}

function SparkList({ rows, labels, empty }: { rows: LikeRow[]; labels: Record<string, string>; empty: string }) {
  if (!rows.length) return <p className="admin-empty">{empty}</p>;
  return (
    <div className="ppl-hist">
      {rows.map((r) => (
        <HBar
          key={r.key}
          label={
            <span className="lk-name">
              <b>{labels[r.key] ?? r.key}</b> <Sure n={r.n} />
              <small>
                {plural(r.n, "poll")} · <Change now={r.spark} before={r.prev} beforeN={r.prevN} />
              </small>
            </span>
          }
          share={r.spark}
          value={r.spark}
        />
      ))}
    </div>
  );
}

function Grid({ cells, topics }: { cells: LikeCell[]; topics: LikeRow[] }) {
  if (!cells.length) return <p className="admin-empty">Nothing tagged and seen by 5 people yet.</p>;
  const at = new Map(cells.map((c) => [`${c.topic}|${c.feel}`, c]));
  const rows = topics.map((t) => t.key).filter((k) => cells.some((c) => c.topic === k));
  const feels = Object.keys(FEEL_LABEL);
  return (
    <div className="gr-scroll">
      <table className="lk-grid">
        <thead>
          <tr>
            <th />
            {feels.map((f) => (
              <th key={f} scope="col">
                {FEEL_LABEL[f]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t}>
              <th scope="row">{TOPIC_LABEL[t] ?? t}</th>
              {feels.map((f) => {
                const c = at.get(`${t}|${f}`);
                return c ? (
                  <td key={f} className={heat(c.spark)} title={`${TOPIC_LABEL[t]} · ${FEEL_LABEL[f]}: Spark ${c.spark} from ${plural(c.n, "poll")}`}>
                    {c.spark}
                    <small>{c.n}</small>
                  </td>
                ) : (
                  <td key={f} className="lk-h0" title="Not tried yet">
                    –
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Compare({ title, rows, labels }: { title: string; rows: LikeRow[]; labels: Record<string, string> }) {
  if (!rows.length) return null;
  return (
    <table className="gr-table lk-cmp">
      <thead>
        <tr>
          <th scope="col">{title}</th>
          <th scope="col">Polls</th>
          <th scope="col">Votes each</th>
          <th scope="col">Spark</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <th scope="row">{labels[r.key] ?? r.key}</th>
            <td>{r.n}</td>
            <td>{r.votes ?? "–"}</td>
            <td>
              <b>{r.spark}</b>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Tags({ t }: { t: PollTags }) {
  if (!t.topic) return <span className="lk-tag lk-none">Not tagged yet</span>;
  return (
    <span className="lk-tags">
      <span className="lk-tag lk-t">{TOPIC_LABEL[t.topic] ?? t.topic}</span>
      {t.feel && <span className="lk-tag lk-f">{FEEL_LABEL[t.feel] ?? t.feel}</span>}
      {t.timely && <span className="lk-tag lk-w">Timely</span>}
      {t.lang && t.lang !== "en" && <span className="lk-tag lk-l">{LANG_LABEL[t.lang] ?? t.lang}</span>}
    </span>
  );
}

function TagEditor({ poll, onDone }: { poll: TaggedPoll; onDone: (saved: boolean) => void }) {
  const [t, setT] = useState<PollTags>({
    topic: poll.topic ?? "daily",
    feel: poll.feel ?? "debate",
    timely: poll.timely ?? false,
    lang: poll.lang ?? "en",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(false);
    try {
      await setPollTags(poll.id, t);
      onDone(true);
    } catch {
      setError(true);
      setBusy(false);
    }
  };
  const id = `lk-${poll.id.slice(0, 8)}`;
  return (
    <div className="lk-edit">
      <label htmlFor={`${id}-topic`}>
        Topic
        <select id={`${id}-topic`} className="field-input" value={t.topic ?? ""} onChange={(e) => setT({ ...t, topic: e.target.value })}>
          {Object.entries(TOPIC_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${id}-feel`}>
        Feel
        <select id={`${id}-feel`} className="field-input" value={t.feel ?? ""} onChange={(e) => setT({ ...t, feel: e.target.value })}>
          {Object.entries(FEEL_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${id}-lang`}>
        Language
        <select id={`${id}-lang`} className="field-input" value={t.lang ?? "en"} onChange={(e) => setT({ ...t, lang: e.target.value })}>
          {Object.entries(LANG_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="lk-check" htmlFor={`${id}-timely`}>
        <input id={`${id}-timely`} type="checkbox" checked={Boolean(t.timely)} onChange={(e) => setT({ ...t, timely: e.target.checked })} />
        Timely
      </label>
      <div className="lk-edit-go">
        <button type="button" className="ppl-mini press" onClick={() => onDone(false)} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="ppl-mini lk-save press" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save tags"}
        </button>
      </div>
      {error && <p className="poll-error lk-err">Couldn&apos;t save. Try again.</p>}
    </div>
  );
}

type Panel = "topics" | "feels" | "combos";

export function AdminLikes() {
  const [days, setDays] = useState(14);
  const [version, setVersion] = useState(0);
  // A new function after a tag change, so the numbers load again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback((d: number) => fetchLikes(d), [version]);
  const { data: l, failed } = useLoad<Likes>(load, days);
  const [panel, setPanel] = useState<Panel>("topics");
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  if (failed) return <p className="poll-error ppl-pad">Couldn&apos;t load this. Has 20261210000000_likes.sql been run?</p>;
  const combos = l ? l.grid.slice(0, 6) : [];
  return (
    <div className="ppl gr lk" data-panel={panel}>
      <Range days={days} onChange={setDays} options={[7, 14, 30]} />
      {!l ? (
        <Loading />
      ) : (
        <>
          {l.lastTagged === null && l.untaggedAll > 0 ? (
            <p className="lk-note lk-warn">
              Tagging hasn&apos;t started. It runs every 2 minutes once <b>OPENAI_API_KEY</b> is set in Vercel and the likes migration has run.
            </p>
          ) : l.untaggedAll > 0 ? (
            <p className="lk-note">
              Tagging older polls: {plural(l.untaggedAll, "poll")} to go (about 600 an hour). Last tagged {ago(l.lastTagged!)}.
            </p>
          ) : null}
          {l.scored < 50 && (
            <p className="lk-note">
              <b>Early days:</b> {plural(l.scored, "poll")} seen by 5 or more people in {days} days. <span className="lk-sure lk-early">Early</span> means fewer
              than {CLEAR} polls, <span className="lk-sure lk-clear">Clear</span> means {CLEAR} or more.
            </p>
          )}
          <div className="ppl-tiles">
            <Tile label="Polls scored" value={l.scored} sub={`${l.polls} posted · ${plural(l.voters, "voter")}`} />
            <Tile
              label="Top topic"
              value={l.topics[0] ? (TOPIC_LABEL[l.topics[0].key] ?? l.topics[0].key) : "–"}
              sub={l.topics[0] ? `Spark ${l.topics[0].spark} · ${plural(l.topics[0].n, "poll")}` : "nothing tagged yet"}
              tint="mint"
            />
            <Tile
              label="Top feel"
              value={l.feels[0] ? (FEEL_LABEL[l.feels[0].key] ?? l.feels[0].key) : "–"}
              sub={l.feels[0] ? `Spark ${l.feels[0].spark} · ${plural(l.feels[0].n, "poll")}` : "nothing tagged yet"}
              tint="sky"
            />
            <Tile label="Tagged" value={`${l.tagged}/${l.polls}`} sub="polls in this time" />
          </div>
          <p className="ppl-note">
            <b>Spark</b>, out of 100: how many who saw a poll voted (40), shares (25), comments (20) and how close the result was (15). A poll needs 5 people
            to have seen it.
          </p>

          <div className="err-range lk-tabs" role="group" aria-label="Show">
            {(
              [
                ["topics", "Topics"],
                ["feels", "Feels"],
                ["combos", "Best combos"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" className="err-pill press" aria-pressed={panel === k} onClick={() => setPanel(k)}>
                {label}
              </button>
            ))}
          </div>

          <div className="ppl-two lk-panels">
            <section className="ppl-card ppl-pad ppl-stack lk-panel lk-p-topics" aria-labelledby="lk-topics">
              <h2 id="lk-topics" className="err-label gr-h">
                Topics
              </h2>
              <SparkList rows={l.topics} labels={TOPIC_LABEL} empty="No tagged polls seen by 5 people yet." />
            </section>
            <section className="ppl-card ppl-pad ppl-stack lk-panel lk-p-feels" aria-labelledby="lk-feels">
              <h2 id="lk-feels" className="err-label gr-h">
                Feels
              </h2>
              <SparkList rows={l.feels} labels={FEEL_LABEL} empty="No tagged polls seen by 5 people yet." />
            </section>
          </div>

          <section className="ppl-card ppl-pad ppl-stack lk-panel lk-p-combos" aria-labelledby="lk-combos">
            <div className="gr-head">
              <h2 id="lk-combos" className="err-label gr-h">
                Topic + feel
              </h2>
              <span className="gr-legend">
                <span>
                  <i className="lk-h1" /> under 45
                </span>
                <span>
                  <i className="lk-h2" /> 45–64
                </span>
                <span>
                  <i className="lk-h3" /> 65–79
                </span>
                <span>
                  <i className="lk-h4" /> 80+
                </span>
                <span>small number: polls</span>
              </span>
            </div>
            {combos.length > 0 && (
              <div className="ppl-hist lk-combos">
                {combos.map((c) => (
                  <HBar
                    key={`${c.topic}|${c.feel}`}
                    label={
                      <span className="lk-name">
                        <span className="lk-tags">
                          <span className="lk-tag lk-t">{TOPIC_LABEL[c.topic] ?? c.topic}</span>
                          <span className="lk-tag lk-f">{FEEL_LABEL[c.feel] ?? c.feel}</span>
                        </span>
                        <small>
                          {plural(c.n, "poll")} <Sure n={c.n} />
                        </small>
                      </span>
                    }
                    share={c.spark}
                    value={c.spark}
                  />
                ))}
              </div>
            )}
            <Grid cells={l.grid} topics={l.topics} />
            <p className="ppl-note">A dash means not tried yet: good places for something new.</p>
          </section>

          <section className="ppl-card ppl-stack" aria-labelledby="lk-more">
            <h2 id="lk-more" className="err-label ppl-pad gr-h">
              Other things we noticed
            </h2>
            <div className="gr-scroll lk-more">
              <Compare title="Posted by" rows={l.who} labels={WHO_LABEL} />
              <Compare title="Language" rows={l.langs} labels={LANG_LABEL} />
              <Compare title="Timing" rows={l.timing} labels={TIMING_LABEL} />
              <Compare title="Posted at" rows={l.times} labels={TIME_LABEL} />
            </div>
          </section>

          <div className="ppl-two">
            <section className="ppl-card ppl-stack" aria-labelledby="lk-best">
              <h2 id="lk-best" className="err-label ppl-pad gr-h">
                Best polls in {days} days
              </h2>
              {l.best.length ? (
                <ul className="ppl-polls gr-flat lk-list">
                  {l.best.map((p) => (
                    <li key={p.id}>
                      <span>
                        {p.question}
                        <Tags t={p} />
                        <small>
                          {p.who === "eithr" ? "Eithr" : p.author ? `@${p.author}` : p.who === "you" ? "You" : "a friends-only or link poll"} ·{" "}
                          {plural(p.votes, "vote")}
                          {p.split ? ` (${p.split})` : ""} · {plural(p.shares, "share")} · {plural(p.comments, "comment")}
                        </small>
                      </span>
                      <b className="lk-spark">{p.spark}</b>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="admin-empty ppl-pad">No poll seen by 5 people in this time.</p>
              )}
            </section>
            <section className="ppl-card ppl-stack" aria-labelledby="lk-check">
              <h2 id="lk-check" className="err-label ppl-pad gr-h">
                Check the tags
              </h2>
              <p className="ppl-note ppl-pad lk-sub">The newest polls. If the AI got one wrong, change it; it won&apos;t change it back.</p>
              {saved && (
                <p className="lk-note lk-ok ppl-pad" role="status">
                  Tags saved.
                </p>
              )}
              {l.recent.length ? (
                <ul className="ppl-polls gr-flat lk-list">
                  {l.recent.map((p) => (
                    <li key={p.id} className={editing === p.id ? "lk-open" : undefined}>
                      <span>
                        {p.question}
                        <Tags t={p} />
                        <small>{p.source === "admin" ? "Tagged by you" : p.source === "ai" ? "Tagged by the AI" : "Waiting for the AI"}</small>
                      </span>
                      {editing !== p.id && (
                        <button
                          type="button"
                          className="ppl-mini press"
                          onClick={() => {
                            setEditing(p.id);
                            setSaved(null);
                          }}
                          aria-label={`Change tags: ${p.question}`}
                        >
                          Change
                        </button>
                      )}
                      {editing === p.id && (
                        <TagEditor
                          poll={p}
                          onDone={(ok) => {
                            setEditing(null);
                            if (ok) {
                              setSaved(p.id);
                              setVersion((v) => v + 1);
                            }
                          }}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="admin-empty ppl-pad">No polls in this time.</p>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
