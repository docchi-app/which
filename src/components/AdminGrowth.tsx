"use client";

import { useEffect, useState } from "react";
import {
  fetchContent,
  fetchFunnel,
  fetchNotifStats,
  fetchOverview,
  fetchSources,
  type ContentStats,
  type DaySnapshot,
  type Funnel,
  type NotifStats,
  type Overview,
  type Sources,
} from "@/lib/admin";
import { ago, day, minutesSince } from "./AdminUsers";

export type GoTo = "errors" | "reports" | "guests" | "metrics";

// The launch goals, fixed (changing them is a code change): the marker on each goal bar.
const GOALS = { voteRate: 60, backRate: 30, sharesPerPoll: 2, pushOn: 50 };

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** How many 2-minute runs there should have been since midnight, India time. */
const runsExpected = () => {
  const now = new Date(Date.now() + 330 * 60000);
  return Math.max(1, Math.floor((now.getUTCHours() * 60 + now.getUTCMinutes()) / 2) + 1);
};

/** Loads one admin screen's numbers for the chosen range (null while loading). */
export function useLoad<T>(load: (days: number) => Promise<T>, days: number) {
  const [data, setData] = useState<{ days: number; value: T } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    load(days)
      .then((value) => {
        if (!live) return;
        setData({ days, value });
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [load, days]);
  return { data: data?.days === days ? data.value : null, failed };
}

export function Range({ days, onChange, options = [1, 7, 30] }: { days: number; onChange: (d: number) => void; options?: number[] }) {
  return (
    <div className="err-range" role="group" aria-label="Time range">
      {options.map((d) => (
        <button key={d} type="button" className="err-pill press" aria-pressed={days === d} onClick={() => onChange(d)}>
          {d === 1 ? "Today" : `${d} days`}
        </button>
      ))}
    </div>
  );
}

const Failed = () => <p className="poll-error ppl-pad">Couldn&apos;t load this. Has 20261207000000_growth.sql been run?</p>;
export const Loading = () => (
  <p className="admin-empty ppl-pad" aria-busy="true">
    Loading…
  </p>
);

export function Tile({ label, value, sub, tint }: { label: string; value: string | number; sub?: React.ReactNode; tint?: "mint" | "sky" | "sun" }) {
  return (
    <div className={`ppl-tile${tint ? ` ppl-tile-${tint}` : ""}`}>
      <span>{label}</span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

/** A labelled bar: label, track filled to `share`%, the number. */
export function HBar({ label, share, value, tint }: { label: React.ReactNode; share: number; value: React.ReactNode; tint?: "sky" | "coral" | "lilac" }) {
  return (
    <div className="ppl-hist-row gr-hrow">
      <span>{label}</span>
      <span className="ppl-track">
        <i className={tint ? `gr-${tint}` : undefined} style={{ width: `${Math.min(100, Math.max(0, share))}%` }} />
      </span>
      <b>{value}</b>
    </div>
  );
}

// ─── Overview ──────────────────────────────────────────────────────────────

/** Admin home: what needs you now, today against yesterday, the goals, the last 14 days. */
export function AdminOverview({ onGo }: { onGo: (to: GoTo) => void }) {
  const [o, setO] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  const [at, setAt] = useState<string | null>(null);
  const load = () =>
    fetchOverview()
      .then((x) => {
        setO(x);
        setAt(new Date().toISOString());
        setFailed(false);
      })
      .catch(() => setFailed(true));
  useEffect(() => {
    let live = true;
    fetchOverview()
      .then((x) => {
        if (!live) return;
        setO(x);
        setAt(new Date().toISOString());
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (failed && !o) return <Failed />;
  if (!o) return <Loading />;
  return (
    <div className="ppl gr">
      <div className="gr-updated">
        <span>Updated {at ? ago(at) : "now"} · India time</span>
        <button type="button" className="ppl-mini" onClick={load}>
          Refresh
        </button>
      </div>
      <Alerts o={o} onGo={onGo} />
      <section className="ppl-card" aria-labelledby="gr-today">
        <h2 id="gr-today" className="err-label ppl-pad gr-h">
          Today so far
        </h2>
        <Compare o={o} />
      </section>
      <Goals o={o} />
      <Series o={o} />
    </div>
  );
}

function Alerts({ o, onGo }: { o: Overview; onGo: (to: GoTo) => void }) {
  const items: { tone: "hot" | "warn" | "ok"; icon: string; title: string; sub: string; go?: [string, GoTo] }[] = [];
  const e = o.errorsNewest;
  if (e && o.errorsNew > 0)
    items.push({
      tone: "hot",
      icon: "!",
      title: `New error${e.people > 1 ? `, ${e.people} people` : ""}: “${e.message.slice(0, 80)}”${e.place ? ` on ${e.place}` : ""}`,
      sub: `Since ${ago(e.since)}${o.errorsNew > 1 ? ` · ${o.errorsNew} new in all` : ""}`,
      go: ["Open Errors →", "errors"],
    });
  if (o.reportsWaiting > 0)
    items.push({
      tone: "warn",
      icon: String(o.reportsWaiting),
      title: `${plural(o.reportsWaiting, "report")} waiting`,
      sub: o.reportsOldest ? `Oldest is ${ago(o.reportsOldest).replace(" ago", "")} old` : "",
      go: ["Review →", "reports"],
    });
  if (o.signups24h === 0 && o.signupsWeekAvg >= 1)
    items.push({
      tone: "warn",
      icon: "0",
      title: "No sign-ups in the last 24 hours",
      sub: `Usually ${o.signupsWeekAvg} a day. ${plural(o.visitors24h, "visitor")} came in that time.`,
      go: ["See Guests →", "guests"],
    });
  const run = o.jobResult as { sent?: number; failed?: number } | null;
  if (!o.jobLastRun) items.push({ tone: "warn", icon: "?", title: "Background job hasn't reported yet", sub: "It runs every 2 minutes once push is set up (README step 6)." });
  else if (minutesSince(o.jobLastRun) > 10)
    items.push({ tone: "hot", icon: "!", title: "Background job stopped", sub: `Last ran ${ago(o.jobLastRun)}. Pushes and emails aren't going out.`, go: ["Open Errors →", "errors"] });
  else
    items.push({
      tone: "ok",
      icon: "✓",
      title: "Background jobs running",
      sub:
        `Push ran ${ago(o.jobLastRun)}: ${run?.sent ?? 0} sent, ${run?.failed ?? 0} failed` +
        (o.emailLast.at ? ` · last email at ${time(o.emailLast.at)}, ${o.emailLast.count} sent in 24h` : ""),
    });
  return (
    <ul className="gr-alerts" aria-label="What needs you">
      {items.map((a) => (
        <li key={a.title} className={`gr-alert gr-${a.tone}`}>
          <span className="gr-ic" aria-hidden="true">
            {a.icon}
          </span>
          <span className="gr-alert-text">
            <b>{a.title}</b>
            {a.sub && <span>{a.sub}</span>}
          </span>
          {a.go && (
            <button type="button" className="gr-go press" onClick={() => onGo(a.go![1])}>
              {a.go[0]}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Delta({ now, before }: { now: number; before: number }) {
  if (!before && !now) return null;
  const diff = now - before;
  if (diff === 0) return null;
  const text = before < 10 ? `${diff > 0 ? "+" : "−"}${Math.abs(diff)}` : `${diff > 0 ? "+" : "−"}${Math.abs(Math.round((diff / before) * 100))}%`;
  return <span className={`gr-delta ${diff > 0 ? "gr-up" : "gr-down"}`}>{text}</span>;
}

function Compare({ o }: { o: Overview }) {
  const rows: [string, (s: DaySnapshot) => number, ((s: DaySnapshot) => string)?][] = [
    ["Visitors", (s) => s.visitors],
    ["Signed up", (s) => s.signups],
    ["Guests started", (s) => s.guests],
    ["Votes", (s) => s.votes],
    ["Polls · snaps", (s) => s.polls + s.snaps, (s) => `${s.polls} · ${s.snaps}`],
    ["Shares", (s) => s.shares],
  ];
  return (
    <div className="gr-scroll">
      <table className="gr-cmp">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Number</span>
            </th>
            <th scope="col">Today</th>
            <th scope="col">Yesterday</th>
            <th scope="col">
              <span className="gr-wide">Same day last week</span>
              <span className="gr-narrow">Last week</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, n, text]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>
                <b>{text ? text(o.today) : n(o.today)}</b>
                <Delta now={n(o.today)} before={n(o.yesterday)} />
              </td>
              <td>{text ? text(o.yesterday) : n(o.yesterday)}</td>
              <td>{text ? text(o.lastWeek) : n(o.lastWeek)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Goal({ label, value, unit, goal, max, sub }: { label: string; value: number | null; unit: string; goal: number; max: number; sub: string }) {
  const met = value !== null && value >= goal;
  return (
    <div className={`gr-goal${met ? " gr-met" : ""}`}>
      <span className="err-label">{label}</span>
      <b>{value === null ? "–" : `${value}${unit}`}</b>
      <span className="gr-meter" role="img" aria-label={`${value ?? "no data"}${unit} of a goal of ${goal}${unit}`}>
        <i style={{ width: `${Math.min(100, ((value ?? 0) / max) * 100)}%` }} />
        <em style={{ left: `${(goal / max) * 100}%` }} />
      </span>
      <small>{sub}</small>
    </div>
  );
}

function Goals({ o }: { o: Overview }) {
  const was = (v: number | null, when: string) => (v === null ? "" : ` · was ${v}% ${when}`);
  return (
    <section className="gr-goals" aria-label="Goals">
      <Goal label="Visitors who vote" value={o.voteRate} unit="%" goal={GOALS.voteRate} max={100} sub={`last 7 days · goal ${GOALS.voteRate}%${was(o.voteRateBefore, "the week before")}`} />
      <Goal label="Back the next day" value={o.backRate} unit="%" goal={GOALS.backRate} max={100} sub={`goal ${GOALS.backRate}%${was(o.backRateBefore, "the week before")}`} />
      <Goal label="Shares per poll" value={o.sharesPerPoll} unit="" goal={GOALS.sharesPerPoll} max={GOALS.sharesPerPoll * 2} sub={`last 7 days · goal ${GOALS.sharesPerPoll}`} />
      <Goal label="Notifications on" value={o.pushOn} unit="%" goal={GOALS.pushOn} max={100} sub={`of people who signed up · goal ${GOALS.pushOn}%`} />
    </section>
  );
}

function Series({ o }: { o: Overview }) {
  const top = Math.max(1, ...o.series.map((s) => s.visitors));
  const best = o.series.reduce<Overview["series"][number] | null>((b, s) => (!b || s.visitors > b.visitors ? s : b), null);
  return (
    <section className="ppl-card ppl-pad ppl-stack" aria-labelledby="gr-series">
      <div className="gr-head">
        <h2 id="gr-series" className="err-label gr-h">
          Visitors and voters, last 14 days
        </h2>
        <span className="gr-legend">
          <span>
            <i className="gr-sky" /> Visitors
          </span>
          <span>
            <i className="gr-coral" /> Voted
          </span>
        </span>
      </div>
      <div className="gr-bars" role="img" aria-label={o.series.map((s) => `${day(s.day)}: ${s.visitors} visitors, ${s.voters} voted`).join("; ")}>
        {o.series.map((s) => (
          <span key={s.day} className="gr-col" title={`${day(s.day)}: ${s.visitors} visitors, ${s.voters} voted`}>
            <span className="gr-v" style={{ height: `${(s.visitors / top) * 100}%` }}>
              <span className="gr-w" style={{ height: `${pct(s.voters, s.visitors)}%` }} />
            </span>
          </span>
        ))}
      </div>
      <div className="gr-axis" aria-hidden="true">
        {o.series.map((s) => (
          <span key={s.day}>{Number(s.day.slice(8, 10))}</span>
        ))}
      </div>
      {best && best.visitors > 0 && (
        <p className="ppl-note">
          Busiest: {day(best.day)}, {plural(best.visitors, "visitor")}, {best.voters} voted.
        </p>
      )}
    </section>
  );
}

// ─── Funnel & retention ───────────────────────────────────────────────────

const retTint = (v: number | null) => (v === null ? "" : v >= 30 ? " gr-r3" : v >= 15 ? " gr-r2" : v > 0 ? " gr-r1" : " gr-r0");

export function AdminFunnel() {
  const [days, setDays] = useState(7);
  const { data: f, failed } = useLoad<Funnel>(fetchFunnel, days);
  if (failed) return <Failed />;
  const s = f?.steps;
  const steps: [string, number][] = s
    ? [
        ["Visited", s.visited],
        ["Voted once", s.voted],
        ["Signed in", s.signed],
        ["Made a poll", s.polled],
        ["Shared", s.shared],
        ["Added a friend", s.friended],
      ]
    : [];
  let biggest: [string, number] | null = null;
  steps.forEach(([label, n], i) => {
    if (i === 0) return;
    const drop = steps[i - 1][1] - n;
    if (drop > 0 && (!biggest || drop > biggest[1])) biggest = [`${steps[i - 1][0].toLowerCase()} → ${label.toLowerCase()}`, drop];
  });
  const stick = f && f.dau !== null && f.mau ? Math.round((f.dau / f.mau) * 100) : null;
  return (
    <div className="ppl gr">
      <Range days={days} onChange={setDays} />
      {!f ? (
        <Loading />
      ) : (
        <>
          <div className="ppl-tiles">
            <Tile label="Daily active" value={f.dau ?? "–"} sub="average, last 7 days" />
            <Tile label="Weekly active" value={f.wau} sub="opened Eithr, last 7 days" />
            <Tile label="Monthly active" value={f.mau} sub="last 30 days" />
            <Tile label="Stickiness" value={stick === null ? "–" : `${stick}%`} sub="daily ÷ monthly · good apps 20%+" tint={stick !== null && stick >= 20 ? "mint" : undefined} />
          </div>
          <section className="ppl-card ppl-pad ppl-stack" aria-labelledby="gr-funnel">
            <h2 id="gr-funnel" className="err-label gr-h">
              Where people drop off · first visits {days === 1 ? "today" : `in the last ${days} days`}
            </h2>
            <ol className="gr-funnel">
              {steps.map(([label, n], i) => {
                const prev = i ? steps[i - 1][1] : 0;
                return (
                  <li key={label}>
                    <span>{label}</span>
                    <span className="gr-fbar">
                      <i style={{ width: `${pct(n, steps[0][1])}%` }} />
                    </span>
                    <b>{n}</b>
                    <small>{i && prev > n ? `−${pct(prev - n, prev)}%` : ""}</small>
                  </li>
                );
              })}
            </ol>
            <p className="ppl-note">
              Each step counts people who did it within 7 days of their first visit.
              {biggest ? ` Biggest drop: ${(biggest as [string, number])[0]}.` : ""}
            </p>
          </section>
          <div className="ppl-two">
            <section className="ppl-card ppl-pad ppl-stack" aria-labelledby="gr-ret">
              <h2 id="gr-ret" className="err-label gr-h">
                Come back after… · by the week they joined
              </h2>
              {f.cohorts.length ? (
                <div className="gr-scroll">
                  <table className="gr-ret">
                    <thead>
                      <tr>
                        <th scope="col">
                          <span className="sr-only">Week</span>
                        </th>
                        <th scope="col">1 day</th>
                        <th scope="col">7 days</th>
                        <th scope="col">30 days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.cohorts.map((c, i) => (
                        <tr key={c.week}>
                          <th scope="row">
                            {i === 0 ? "Week of " : ""}
                            {day(c.week)} <small>· {c.n} joined</small>
                          </th>
                          {[c.d1, c.d7, c.d30].map((v, j) => (
                            <td key={j} className={`gr-rc${retTint(v)}`}>
                              {v === null ? "–" : `${v}%`}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="admin-empty">Nobody signed up in the last 8 weeks.</p>
              )}
              <p className="ppl-note">Signed-up people only. “–” means it&apos;s too soon to tell.</p>
            </section>
            <section className="ppl-card ppl-pad ppl-stack" aria-labelledby="gr-d1">
              <h2 id="gr-d1" className="err-label gr-h">
                Back the next day, compared
              </h2>
              {(
                [
                  ["Notifications", "On", f.d1.pushOn, "Off / never", f.d1.pushOff],
                  ["How they joined", "Invited by a friend", f.d1.invited, "Found it", f.d1.found],
                  ["Account", "Signed in", f.d1.signed, "Guest", f.d1.guest],
                ] as const
              ).map(([title, a, av, b, bv]) => (
                <div key={title} className="gr-vs">
                  <span className="gr-vs-title">{title}</span>
                  <HBar label={a} share={av ?? 0} value={av === null ? "–" : `${av}%`} />
                  <HBar label={b} share={bv ?? 0} value={bv === null ? "–" : `${bv}%`} />
                </div>
              ))}
              <p className="ppl-note">People who joined in the last 30 days.</p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sources ───────────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<string, string> = {
  poll: "Shared poll",
  invite: "Invite link",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  facebook: "Facebook",
  snapchat: "Snapchat",
  x: "X",
  search: "Search",
  email: "Email",
  notification: "Notification",
  old_address: "Old address",
  direct: "Direct",
  other_site: "Other sites",
};
const seenBy = (visibility: string) => (visibility === "circle" ? "friends only" : visibility === "link" ? "link only" : "everyone");

export function AdminSources() {
  const [days, setDays] = useState(7);
  const { data: s, failed } = useLoad<Sources>(fetchSources, days);
  if (failed) return <Failed />;
  const top = s ? Math.max(1, ...s.sources.map((x) => x.n)) : 1;
  return (
    <div className="ppl gr">
      <Range days={days} onChange={setDays} />
      {!s ? (
        <Loading />
      ) : (
        <>
          <div className="ppl-two">
            <section className="ppl-card ppl-pad ppl-stack" aria-labelledby="gr-src">
              <h2 id="gr-src" className="err-label gr-h">
                Where first visits came from
              </h2>
              {s.sources.length ? (
                <div className="ppl-hist">
                  {s.sources.map((x) => (
                    <HBar key={x.source} label={SOURCE_LABEL[x.source] ?? x.source} share={(x.n / top) * 100} value={x.n} tint="sky" />
                  ))}
                </div>
              ) : (
                <p className="admin-empty">No first visits in this time.</p>
              )}
              <p className="ppl-note">{plural(s.total, "first visit")}. Recorded since the People update.</p>
            </section>
            <section className="ppl-card ppl-stack" aria-labelledby="gr-bring">
              <h2 id="gr-bring" className="err-label ppl-pad gr-h">
                Who brings people in
              </h2>
              {s.bringers.length ? (
                <ul className="ppl-polls gr-flat">
                  {s.bringers.map((b) => (
                    <li key={b.username}>
                      <span>
                        <b>@{b.username}</b>
                        <small>
                          {[b.invites ? "invite link" : "", b.polls ? plural(b.polls, "poll") + " shared" : ""].filter(Boolean).join(" + ")} · {plural(b.visitors, "visitor")} · {b.voted} voted · {b.signed} signed up
                        </small>
                      </span>
                      <span className={`ppl-chip ${b.signed ? "ppl-on" : "ppl-plain"}`}>+{plural(b.signed, "user")}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="admin-empty ppl-pad">Nobody&apos;s shared link brought a visitor yet.</p>
              )}
            </section>
          </div>
          <div className="ppl-two">
            <section className="ppl-card ppl-stack" aria-labelledby="gr-polls">
              <h2 id="gr-polls" className="err-label ppl-pad gr-h">
                Polls that brought the most people
              </h2>
              {s.topPolls.length ? (
                <ul className="ppl-polls gr-flat">
                  {s.topPolls.map((p) => (
                    <li key={p.id}>
                      <span>
                        {p.question}
                        <small>
                          {p.author ? `@${p.author}` : "Eithr"} · {p.kind === "snap" ? "snap" : seenBy(p.visibility)}
                        </small>
                      </span>
                      <b>{plural(p.visitors, "visitor")}</b>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="admin-empty ppl-pad">No shared polls opened in this time.</p>
              )}
            </section>
            <section className="ppl-card" aria-labelledby="gr-phones">
              <h2 id="gr-phones" className="err-label ppl-pad gr-h">
                How each phone and browser does
              </h2>
              <div className="gr-scroll">
                <table className="gr-table">
                  <thead>
                    <tr>
                      <th scope="col">Phone</th>
                      <th scope="col">Visitors</th>
                      <th scope="col">Voted</th>
                      <th scope="col">Signed in</th>
                      <th scope="col">Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.phones.map((p) => (
                      <tr key={p.label}>
                        <th scope="row">{p.label}</th>
                        <td>{p.visitors}</td>
                        <td>{pct(p.voted, p.visitors)}%</td>
                        <td>{pct(p.signed, p.visitors)}%</td>
                        <td className={p.errors / Math.max(1, p.visitors) >= 0.05 ? "gr-bad" : undefined}>{pct(p.errors, p.visitors)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="ppl-foot">
                <span>Errors: visitors who hit one (Admin → Errors)</span>
              </p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Polls & snaps ─────────────────────────────────────────────────────────

const KINDS = [
  ["classic", "Typed", "gr-coral"],
  ["snap", "Snap", "gr-sky"],
  ["hot_take", "Hot take", "gr-sun"],
  ["mystery", "Mystery", "gr-lilac"],
] as const;

export function AdminContent() {
  const [days, setDays] = useState(7);
  const { data: c, failed } = useLoad<ContentStats>(fetchContent, days);
  if (failed) return <Failed />;
  const made = c ? c.polls + c.snaps : 0;
  const top = c ? Math.max(1, ...c.byDay.map((d) => d.classic + d.snap + d.hot_take + d.mystery)) : 1;
  const propTop = c ? Math.max(1, ...c.props.map((p) => p.n)) : 1;
  return (
    <div className="ppl gr">
      <Range days={days} onChange={setDays} />
      {!c ? (
        <Loading />
      ) : (
        <>
          <div className="ppl-tiles">
            <Tile label="Polls made" value={made} sub={`${days > 1 ? `${Math.round((made / days) * 10) / 10} a day · ` : ""}${plural(c.snaps, "snap")}`} />
            <Tile label="Votes per poll" value={c.medianVotes ?? "–"} sub={c.p90Votes !== null ? `median · top 10% get ${Math.round(c.p90Votes)}+` : "median"} />
            <Tile label="No votes yet" value={c.noVotes} sub={`${pct(c.noVotes, made)}% of polls · ${c.noVotesOpen} still open`} tint={c.noVotes ? "sun" : undefined} />
            <Tile label="Comments" value={c.comments} sub={made ? `${Math.round((c.comments / made) * 10) / 10} per poll` : undefined} />
          </div>
          <section className="ppl-card ppl-pad ppl-stack" aria-labelledby="gr-kinds">
            <div className="gr-head">
              <h2 id="gr-kinds" className="err-label gr-h">
                Polls per day, by kind
              </h2>
              <span className="gr-legend">
                {KINDS.map(([, label, tint]) => (
                  <span key={label}>
                    <i className={tint} /> {label}
                  </span>
                ))}
              </span>
            </div>
            <div className="gr-bars gr-stack" style={{ gridTemplateColumns: `repeat(${c.byDay.length}, minmax(0, 1fr))` }}>
              {c.byDay.map((d) => {
                const total = d.classic + d.snap + d.hot_take + d.mystery;
                return (
                  <span key={d.day} className="gr-col" title={`${day(d.day)}: ${total} (${KINDS.map(([k, label]) => `${d[k]} ${label.toLowerCase()}`).join(", ")})`}>
                    <span className="gr-pile" style={{ height: `${(total / top) * 100}%` }}>
                      {KINDS.map(([k, , tint]) => (d[k] ? <i key={k} className={tint} style={{ flexGrow: d[k] }} /> : null))}
                    </span>
                  </span>
                );
              })}
            </div>
            <div className="gr-axis" style={{ gridTemplateColumns: `repeat(${c.byDay.length}, minmax(0, 1fr))` }} aria-hidden="true">
              {c.byDay.map((d) => (
                <span key={d.day}>{Number(d.day.slice(8, 10))}</span>
              ))}
            </div>
          </section>
          <div className="ppl-two">
            <section className="ppl-card ppl-stack" aria-labelledby="gr-top">
              <h2 id="gr-top" className="err-label ppl-pad gr-h">
                Top {days === 1 ? "today" : `in ${days} days`}
              </h2>
              {c.top.length ? (
                <ul className="ppl-polls gr-flat">
                  {c.top.map((p) => (
                    <li key={p.id}>
                      <span>
                        {p.question}
                        <small>
                          {p.author ? `@${p.author}` : "Eithr"} · {p.kind === "snap" ? "snap" : seenBy(p.visibility)} · {plural(p.comments, "comment")}
                        </small>
                      </span>
                      <b>{plural(p.votes, "vote")}</b>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="admin-empty ppl-pad">No polls in this time.</p>
              )}
            </section>
            <div className="ppl-col">
              <section className="ppl-card ppl-pad ppl-stack" aria-labelledby="gr-snaps">
                <h2 id="gr-snaps" className="err-label gr-h">
                  Snaps
                </h2>
                <div className="ppl-stats gr-stats-3">
                  <div>
                    <b>{c.snapLive}</b>
                    <span>went live</span>
                  </div>
                  <div>
                    <b>{c.snapReview}</b>
                    <span>sent to you</span>
                  </div>
                  <div>
                    <b>{c.snapRejected}</b>
                    <span>turned down</span>
                  </div>
                </div>
              </section>
              <section className="ppl-card ppl-pad ppl-stack" aria-labelledby="gr-safety">
                <h2 id="gr-safety" className="err-label gr-h">
                  Safety checks
                </h2>
                <div className="ppl-stats gr-stats-3">
                  <div>
                    <b>{c.aiFlags}</b>
                    <span>hidden by the AI</span>
                  </div>
                  <div>
                    <b>{c.blocked}</b>
                    <span>stopped by blocked words</span>
                  </div>
                  <div>
                    <b>{c.reports}</b>
                    <span>reports filed</span>
                  </div>
                </div>
              </section>
              <section className="ppl-card ppl-pad ppl-stack" aria-labelledby="gr-props">
                <h2 id="gr-props" className="err-label gr-h">
                  Props given, by question
                </h2>
                {c.props.length ? (
                  <div className="ppl-hist">
                    {c.props.map((p) => (
                      <HBar key={p.label} label={`${p.label} ${p.emoji}`} share={(p.n / propTop) * 100} value={p.n} tint="lilac" />
                    ))}
                  </div>
                ) : (
                  <p className="admin-empty">No props in this time.</p>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Notifications ─────────────────────────────────────────────────────────

const NOTIF_LABEL: Record<string, string> = {
  votes: "Votes on your poll",
  props: "Props (💜)",
  circle: "Friend requests",
  results: "Results are in",
  daily: "Poll of the Day",
  comments: "Comments",
};

export function AdminNotifications() {
  const [days, setDays] = useState(7);
  const { data: n, failed } = useLoad<NotifStats>(fetchNotifStats, days);
  if (failed) return <Failed />;
  const tried = n ? n.sent + n.expired + n.failed : 0;
  const expected = runsExpected();
  return (
    <div className="ppl gr">
      <Range days={days} onChange={setDays} />
      {!n ? (
        <Loading />
      ) : (
        <>
          <div className="ppl-tiles">
            <Tile label="Sent" value={n.sent} sub={`pushes${tried ? ` · ${pct(n.sent, tried)}% reached the phone` : ""}`} />
            <Tile label="Opened" value={`${pct(n.opened, n.sent)}%`} sub={`${plural(n.opened, "push", "pushes")} tapped`} tint="mint" />
            <Tile label="Emails" value={n.emails} sub={`lunch ${n.emailsLunch} · evening ${n.emailsEvening} · ${pct(n.emailOpens, n.emails)}% clicked`} />
            <Tile label="Turned off" value={n.turnedOff} sub="people turned notifications off" tint={n.turnedOff ? "sun" : undefined} />
          </div>
          <section className="ppl-card" aria-labelledby="gr-kinds-n">
            <h2 id="gr-kinds-n" className="err-label ppl-pad gr-h">
              By kind
            </h2>
            <div className="gr-scroll">
              <table className="gr-table">
                <thead>
                  <tr>
                    <th scope="col">Kind</th>
                    <th scope="col">Made</th>
                    <th scope="col">Sent</th>
                    <th scope="col">Opened</th>
                    <th scope="col">Open rate</th>
                  </tr>
                </thead>
                <tbody>
                  {n.kinds.map((k) => (
                    <tr key={k.kind}>
                      <th scope="row">{NOTIF_LABEL[k.kind] ?? k.kind}</th>
                      <td>{k.made}</td>
                      <td>{k.sent}</td>
                      <td>{k.opened}</td>
                      <td className={k.sent && pct(k.opened, k.sent) >= 25 ? "gr-good" : undefined}>{k.sent ? `${pct(k.opened, k.sent)}%` : "–"}</td>
                    </tr>
                  ))}
                  {!n.kinds.length && (
                    <tr>
                      <td colSpan={5} className="gr-none">
                        No notifications in this time.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="ppl-foot">
              <span>
                Expired (the phone unsubscribed, removed automatically): {n.expired} · failed: {n.failed}
              </span>
              <span>Opens count the tap, not the phone showing it</span>
            </p>
          </section>
          <div className="ppl-two">
            <section className="ppl-card ppl-pad ppl-stack" aria-labelledby="gr-allow">
              <h2 id="gr-allow" className="err-label gr-h">
                Who allowed notifications, by phone
              </h2>
              {n.phones.length ? (
                <div className="ppl-hist">
                  {n.phones.map((p) => {
                    const cant = p.cant > 0 && p.on === 0 && p.cant >= p.people / 2;
                    return <HBar key={p.label} label={p.label} share={cant ? 0 : pct(p.on, p.people)} value={cant ? "can't" : `${pct(p.on, p.people)}%`} tint="coral" />;
                  })}
                </div>
              ) : (
                <p className="admin-empty">No phones recorded yet.</p>
              )}
              <p className="ppl-note">iPhones only get notifications from the Home Screen app, so the email covers the rest.</p>
            </section>
            <section className="ppl-card ppl-pad ppl-stack" aria-labelledby="gr-job">
              <h2 id="gr-job" className="err-label gr-h">
                The 2-minute job, today
              </h2>
              <div className="gr-job">
                <span>
                  <b>Runs</b>
                  <small>every 2 minutes{n.jobLastRun ? ` · last ${ago(n.jobLastRun)}` : ""}</small>
                </span>
                <b className={(n.runsToday ?? 0) >= expected * 0.9 ? "gr-good" : "gr-bad"}>
                  {n.runsToday ?? 0} of {expected}
                </b>
              </div>
              <div className="gr-job">
                <span>
                  <b>Failed sends</b>
                  <small>a push service said no</small>
                </span>
                <b className={n.failed ? "gr-bad" : "gr-good"}>{n.failed}</b>
              </div>
              <div className="gr-job">
                <span>
                  <b>Last problem</b>
                  <small>{n.jobProblem ? `${n.jobProblem.place ?? "job"}: ${n.jobProblem.message.slice(0, 80)}, ${ago(n.jobProblem.at)}` : "none"}</small>
                </span>
                {n.jobProblem && <span className={`ppl-chip ${n.jobProblem.status === "fixed" ? "ppl-on" : "ppl-block"}`}>{n.jobProblem.status === "fixed" ? "Fixed" : n.jobProblem.status === "ignored" ? "Ignored" : "Open"}</span>}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
