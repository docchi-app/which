"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchErrorDetail,
  fetchErrors,
  fetchErrorsSummary,
  setErrorStatus,
  type ErrorDetail,
  type ErrorFilter,
  type ErrorRow,
  type ErrorSource,
  type ErrorStatus,
  type ErrorsSummary,
} from "@/lib/admin";

const REPO = process.env.NEXT_PUBLIC_GITHUB_REPO || "docchi-app/which";
const RANGES = [
  { days: 1, label: "24 hours" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
];
const SOURCE_LABEL: Record<ErrorSource, string> = { app: "The app", server: "Server", job: "Background job" };

const minutesSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 60000;

function ago(iso: string | null) {
  if (!iso) return "never";
  const m = Math.round(minutesSince(iso));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

const ist = (iso: string, withDay = true) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    ...(withDay ? { day: "numeric", month: "short" } : {}),
    hour: "numeric",
    minute: "2-digit",
  });

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** New, Open, Back after fix, Fixed or Ignored. */
function statusLabel(e: { status: ErrorStatus; cameBack: boolean }) {
  if (e.cameBack && e.status === "open") return "Back after fix";
  return { new: "New", open: "Open", fixed: "Fixed", ignored: "Ignored" }[e.status];
}
const statusClass = (e: { status: ErrorStatus; cameBack: boolean }) => `err-chip err-chip-${e.cameBack && e.status === "open" ? "back" : e.status}`;

const whoLine = (d: ErrorDetail) =>
  [d.who.user && plural(d.who.user, "signed in", "signed in"), d.who.guest && plural(d.who.guest, "guest"), d.who.visitor && plural(d.who.visitor, "visitor")]
    .filter(Boolean)
    .join(" · ") || "Server only";

const deviceOf = (o: { device: string | null; browser: string | null; inApp: string | null; installed: boolean | null }) =>
  [o.device, o.inApp ?? o.browser, o.installed ? "installed" : null].filter(Boolean).join(" · ") || "Server";

/** The ready-to-paste report: the facts, counts only (no names or emails). */
export function errorReport(d: ErrorDetail, days: number, origin: string) {
  const range = RANGES.find((r) => r.days === days)?.label ?? `${days} days`;
  const latest = d.latest[0];
  const stack = latest?.stack?.split("\n").slice(0, 5).map((l) => `  ${l.trim()}`) ?? [];
  return [
    "Eithr error report",
    `Error: ${d.message} (${d.kind})`,
    `Where: ${SOURCE_LABEL[d.source]}${d.place ? ` · ${d.place}` : ""}`,
    ...(d.code ? [`Code: ${d.code}`] : []),
    `Status: ${statusLabel(d)}${d.spike ? " · spike" : ""}`,
    `Seen: ${plural(d.times, "time")} by ${plural(d.people, "person", "people")} in the last ${range} (${d.timesTotal} in all)`,
    `First: ${ist(d.firstSeen)} IST · last: ${ist(d.lastSeen)}`,
    ...(d.devices.length ? [`Phones: ${d.devices.map((x) => `${x.label} ${x.people}`).join(" · ")}`] : []),
    `Who: ${whoLine(d).replace(/^Server only$/, "the server")}`,
    ...(d.versions.length ? [`App version: ${d.versions.join(", ")}`] : []),
    ...(stack.length ? ["Stack (first lines):", ...stack] : []),
    ...(latest?.prevPath || latest?.path ? [`Steps before: ${[latest.prevPath, latest.path].filter(Boolean).join(" → ")}`] : []),
    `Report id: err_${d.id}`,
    `Admin: ${origin}/admin#errors/${d.id}`,
  ].join("\n");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers: select a hidden box and copy.
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    box.remove();
    return ok;
  }
}

/** Admin → Errors: what broke, for whom, and a report ready to hand over. (Remount with a new
 * `initialId`, as AdminScreen does through `key`, to open another error from a link.) */
export function AdminErrors({ initialId, onChange }: { initialId: number | null; onChange: () => void }) {
  const [days, setDays] = useState(1);
  const [filter, setFilter] = useState<ErrorFilter>("look");
  const [source, setSource] = useState<ErrorSource | null>(null);
  const [summary, setSummary] = useState<ErrorsSummary | null>(null);
  const [rows, setRows] = useState<ErrorRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<number | null>(initialId);
  const detailRef = useRef<HTMLElement>(null);

  const load = useCallback(() => {
    Promise.all([fetchErrorsSummary(days), fetchErrors(days, filter, source)])
      .then(([s, r]) => {
        setSummary(s);
        setRows(r);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [days, filter, source]);
  useEffect(load, [load]);

  const select = (id: number) => {
    setSelected(id);
    window.history.replaceState(window.history.state, "", `#errors/${id}`);
    // On a phone the details sit under the list.
    requestAnimationFrame(() => {
      if (window.innerWidth < 1200) detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const jobAge = summary?.jobLastRun ? minutesSince(summary.jobLastRun) : null;
  const jobOk = jobAge !== null && jobAge < 10;
  const jobFailed = Number(summary?.jobResult?.failed ?? 0);
  const filters: { id: ErrorFilter; label: string }[] = [
    { id: "look", label: summary ? `Needs a look ${summary.look}` : "Needs a look" },
    { id: "new", label: summary ? `New ${summary.new}` : "New" },
    { id: "open", label: "Open" },
    { id: "fixed", label: "Fixed" },
    { id: "ignored", label: "Ignored" },
    { id: "all", label: "All" },
  ];

  return (
    <div className="err">
      <div className="err-range" role="group" aria-label="Time range">
        {RANGES.map((r) => (
          <button key={r.days} type="button" className="err-pill press" aria-pressed={days === r.days} onClick={() => setDays(r.days)}>
            {r.label}
          </button>
        ))}
      </div>

      <div className="err-tiles">
        <div className={`err-tile ${summary?.new ? "err-tile-hot" : ""}`}>
          <span className="err-tile-label">New errors</span>
          <strong className="err-tile-num">{summary ? summary.new : "–"}</strong>
          <span className="err-tile-sub">
            {summary?.newest ? `“${summary.newest}”${summary.newestPlace ? ` · ${summary.newestPlace}` : ""}, since ${ist(summary.newestSince!, false)}` : "Nothing new"}
          </span>
        </div>
        <div className="err-tile">
          <span className="err-tile-label">People hit</span>
          <strong className="err-tile-num">{summary ? summary.people : "–"}</strong>
          <span className="err-tile-sub">
            {summary && summary.opened ? `of ${summary.opened} who opened Eithr (${Math.round((summary.people / summary.opened) * 100)}%)` : "people who saw an error"}
          </span>
        </div>
        <div className="err-tile">
          <span className="err-tile-label">Errors</span>
          <strong className="err-tile-num">{summary ? summary.times : "–"}</strong>
          <span className="err-tile-sub">{summary ? plural(summary.kinds, "kind") : ""}</span>
        </div>
        <div className={`err-tile ${summary ? (jobOk && !jobFailed ? "err-tile-ok" : "err-tile-warn") : ""}`}>
          <span className="err-tile-label">Background jobs</span>
          <strong className="err-tile-num">{!summary ? "–" : jobOk ? (jobFailed ? "Check" : "OK") : "Stopped?"}</strong>
          <span className="err-tile-sub">
            {!summary
              ? ""
              : summary.jobLastRun
                ? `Push and email ran ${ago(summary.jobLastRun)}, ${plural(jobFailed, "failed", "failed")}`
                : "Hasn't run since the errors update"}
          </span>
        </div>
      </div>

      <div className="err-grid">
        <section className="err-list-card" aria-label="Errors">
          <div className="err-filters">
            {filters.map((f) => (
              <button key={f.id} type="button" className="err-pill press" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
            <label className="err-where">
              Where
              <select className="field-input" value={source ?? ""} onChange={(e) => setSource((e.target.value || null) as ErrorSource | null)}>
                <option value="">Everywhere</option>
                <option value="app">The app</option>
                <option value="server">Server</option>
                <option value="job">Background jobs</option>
              </select>
            </label>
          </div>
          {failed ? (
            <p className="poll-error err-pad">Couldn&apos;t load errors. Has 20261205000000_errors.sql been run?</p>
          ) : !rows ? (
            <p className="admin-empty err-pad" aria-busy="true">
              Loading…
            </p>
          ) : !rows.length ? (
            <p className="admin-empty err-pad">{filter === "look" ? "Nothing needs a look. 🎉" : "No errors here."}</p>
          ) : (
            <ul className="err-rows">
              {rows.map((r) => (
                <li key={r.id}>
                  <button type="button" className="err-row" aria-current={selected === r.id ? "true" : undefined} onClick={() => select(r.id)}>
                    <span className="err-row-main">
                      <strong>{r.message}</strong>
                      <span className="err-row-where">
                        {SOURCE_LABEL[r.source]}
                        {r.place ? ` · ${r.place}` : ""}
                      </span>
                    </span>
                    <span className="err-row-num">
                      <b>{r.people}</b>
                      <span> {r.people === 1 ? "person" : "people"}</span>
                    </span>
                    <span className="err-row-num">
                      {r.times}
                      <span> {r.times === 1 ? "time" : "times"}</span>
                    </span>
                    <span className="err-row-last">{ago(r.lastSeen)}</span>
                    <span className="err-row-chips">
                      <span className={statusClass(r)}>{statusLabel(r)}</span>
                      {r.spike && <span className="err-chip err-chip-spike">Spike</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="err-foot">Repeats of the same error are grouped into one line. Kept 30 days.</p>
        </section>

        <section ref={detailRef} className="err-detail-card" aria-label="Error details">
          {selected ? (
            <Detail
              key={`${selected}-${days}`}
              id={selected}
              days={days}
              onStatus={() => {
                load();
                onChange();
              }}
            />
          ) : (
            <p className="admin-empty">Pick an error to see who it hit, on which phones, and to copy a report.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function Detail({ id, days, onStatus }: { id: number; days: number; onStatus: () => void }) {
  const [d, setD] = useState<ErrorDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchErrorDetail(id, days)
      .then(setD)
      .catch(() => setFailed(true));
  }, [id, days]);
  useEffect(load, [load]);

  if (failed) return <p className="poll-error">That error is gone (kept 30 days).</p>;
  if (!d) {
    return (
      <p className="admin-empty" aria-busy="true">
        Loading…
      </p>
    );
  }

  const max = Math.max(1, ...d.buckets);
  const report = errorReport(d, days, window.location.origin);
  const issue = new URL(`https://github.com/${REPO}/issues/new`);
  issue.searchParams.set("title", `[Error] ${d.message.slice(0, 80)}${d.place ? ` · ${d.place}` : ""} · ${plural(d.people, "person", "people")}`);
  issue.searchParams.set("body", report);
  issue.searchParams.set("labels", "bug");

  async function mark(status: "open" | "fixed" | "ignored") {
    setBusy(true);
    setNote(null);
    try {
      await setErrorStatus(id, status);
      setNote(status === "fixed" ? "Marked fixed. If it happens again it comes back as “Back after fix”." : status === "ignored" ? "Ignored. No more alerts for it." : "Marked open.");
      load();
      onStatus();
    } catch {
      setNote("That didn't work. Try again?");
    }
    setBusy(false);
  }

  return (
    <div className="err-detail">
      <div className="err-row-chips">
        <span className={statusClass(d)}>{statusLabel(d)}</span>
        {d.spike && <span className="err-chip err-chip-spike">Spike</span>}
      </div>
      <h2 className="err-title">{d.message}</h2>
      <p className="err-sub">
        {SOURCE_LABEL[d.source]}
        {d.place ? ` · ${d.place}` : ""}
        {d.code ? ` · ${d.code}` : ""}
      </p>

      <div className="err-stats">
        <div>
          <b>{d.times}</b>
          <span>{d.times === 1 ? "time" : "times"}</span>
        </div>
        <div>
          <b>{d.people}</b>
          <span>{d.people === 1 ? "person" : "people"}</span>
        </div>
        <div>
          <b className="err-stat-small">{ist(d.firstSeen)}</b>
          <span>first seen</span>
        </div>
        <div>
          <b className="err-stat-small">{ago(d.lastSeen)}</b>
          <span>last seen</span>
        </div>
      </div>

      <div>
        <span className="err-label">{days === 1 ? "Per hour, last 24 hours" : `Per day, last ${days} days`}</span>
        <div className="err-bars" role="img" aria-label={`${d.times} times: ${d.buckets.join(", ")}`}>
          {d.buckets.map((n, i) => (
            <span key={i} className={n ? "err-bar err-bar-on" : "err-bar"} style={{ height: n ? `${Math.max(4, Math.round((n / max) * 48))}px` : "2px" }} />
          ))}
        </div>
        <div className="err-axis">
          <span>{days === 1 ? "24h ago" : `${days} days ago`}</span>
          <span>now</span>
        </div>
      </div>

      <div className="err-two">
        <div>
          <span className="err-label">Phones</span>
          {d.devices.length ? (
            d.devices.map((x) => (
              <div key={x.label}>
                {x.label} <b>{x.people}</b>
              </div>
            ))
          ) : (
            <div>Server</div>
          )}
        </div>
        <div>
          <span className="err-label">Who</span>
          <div>{whoLine(d)}</div>
          {d.who.names.length > 0 && <div className="err-names">{d.who.names.map((n) => `@${n}`).join(", ")}</div>}
        </div>
      </div>

      <div>
        <span className="err-label">Latest</span>
        <ul className="err-latest">
          {d.latest.map((o, i) => (
            <li key={i}>
              <span>
                {ist(o.at)} · {deviceOf(o)} · {o.appVersion ? `app ${o.appVersion}` : "no version"} · {o.who === "user" ? `@${o.username ?? "someone"}` : o.who}
              </span>
              {o.stack && (
                <details>
                  <summary>Stack</summary>
                  <pre>{o.stack}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="err-actions">
        <button
          type="button"
          className="btn btn-coral press"
          onClick={async () => setNote((await copyText(report)) ? "Copied. Paste it into your Claude session." : "Couldn't copy. Select the report below instead.")}
        >
          Copy for Claude
        </button>
        <a className="btn press" href={issue.toString()} target="_blank" rel="noopener noreferrer">
          Open GitHub issue
        </a>
      </div>
      <div className="err-mark" role="group" aria-label="Mark as">
        <span>Mark as</span>
        {(["open", "fixed", "ignored"] as const).map((s) => (
          <button key={s} type="button" className="err-pill press" aria-pressed={d.status === s} disabled={busy || d.status === s} onClick={() => mark(s)}>
            {s === "open" ? "Open" : s === "fixed" ? "Fixed" : "Ignore"}
          </button>
        ))}
      </div>
      {note && (
        <p className="notif-note" role="status">
          {note}
        </p>
      )}
      <details className="err-report">
        <summary>See the report text</summary>
        <pre>{report}</pre>
      </details>
    </div>
  );
}
