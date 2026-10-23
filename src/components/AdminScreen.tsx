"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  fetchLog,
  fetchMetrics,
  fetchQueue,
  moderate,
  type AdminAction,
  type DayMetrics,
  type LogItem,
  type QueueItem,
} from "@/lib/admin";
import { onUserChange } from "@/lib/auth";
import { getMyProfile } from "@/lib/profile";
import { REPORT_REASONS } from "@/lib/safety";
import { isSupabaseConfigured } from "@/lib/supabase";
import { Avatar } from "./Avatar";
import { LogoMark, Wordmark } from "./Logo";

type Tab = "reports" | "done" | "metrics";

const REASON_LABEL: Record<string, string> = Object.fromEntries(
  REPORT_REASONS.map((r) => [r.id, r.label.split(/[,(]/)[0].replace(/ or .*$/, "")]),
);

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

/** Reports queue, recent actions with undo, and the launch metrics. */
export function AdminScreen() {
  // undefined: checking · false: not an admin
  const [allowed, setAllowed] = useState<boolean | undefined>(isSupabaseConfigured ? undefined : false);
  const [tab, setTab] = useState<Tab>("reports");

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    return onUserChange(() => {
      getMyProfile()
        .then((p) => setAllowed(Boolean(p?.isAdmin)))
        .catch(() => setAllowed(false));
    });
  }, []);

  return (
    <div className="screen admin">
      <header className="app-header">
        <Link href="/" className="brand" aria-label="Docchi home">
          <LogoMark />
          <Wordmark />
        </Link>
        <span className="chip chip-small chip-sun">Admin</span>
      </header>

      {allowed === undefined ? (
        <p className="admin-empty" aria-busy="true">Checking…</p>
      ) : !allowed ? (
        <section className="poll-card soon">
          <h1 className="poll-question">This page is for the Docchi team.</h1>
          <Link href="/" className="btn btn-coral press">
            Back to the feed
          </Link>
        </section>
      ) : (
        <>
          <div role="tablist" aria-label="Admin" className="tabs admin-tabs">
            {(
              [
                ["reports", "Reports"],
                ["done", "Done"],
                ["metrics", "Metrics"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="tab" type="button" aria-selected={tab === id} className="tab press" onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          {tab === "reports" && <Queue />}
          {tab === "done" && <Done />}
          {tab === "metrics" && <Metrics />}
        </>
      )}
    </div>
  );
}

function Queue() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchQueue("open")
      .then(setItems)
      .catch(() => setError("Couldn't load reports."));
  }, []);
  useEffect(load, [load]);

  if (error) return <p className="poll-error">{error}</p>;
  if (!items) return <p className="admin-empty" aria-busy="true">Loading…</p>;
  if (!items.length) return <p className="admin-empty">Nothing to review. 🎉</p>;
  return (
    <ul className="admin-list">
      {items.map((it) => (
        <QueueCard key={`${it.targetType}-${it.targetId}`} item={it} onDone={load} />
      ))}
    </ul>
  );
}

function QueueCard({ item, onDone }: { item: QueueItem; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirmBan, setConfirmBan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPoll = item.targetType === "poll";

  async function run(action: AdminAction) {
    setBusy(true);
    setError(null);
    try {
      await moderate(item.targetType, item.targetId, action);
      onDone();
    } catch {
      setError("That didn't work. Try again?");
      setBusy(false);
    }
  }

  return (
    <li className="admin-card">
      <div className="admin-card-top">
        <span className={`chip chip-small ${isPoll ? "chip-white" : "chip-link"}`}>{isPoll ? "Poll" : "Person"}</span>
        {item.hiddenReason === "reports" && <span className="chip chip-small admin-chip-hidden">Hidden by reports</span>}
        <span className="admin-count">
          {item.reports} {item.reports === 1 ? "report" : "reports"} · {ago(item.lastAt)}
        </span>
      </div>

      <div className="admin-reasons">
        {Object.entries(item.reasons).map(([r, n]) => (
          <span key={r} className="admin-reason">
            {REASON_LABEL[r] ?? r}
            {n > 1 ? ` ×${n}` : ""}
          </span>
        ))}
      </div>

      {isPoll && (
        <div className="admin-poll">
          <p className="admin-q">{item.question}</p>
          {item.teaser && <p className="admin-meta">Teaser: {item.teaser}</p>}
          <ol className="admin-options">
            {item.options.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ol>
          <p className="admin-meta">
            {item.kind?.replace("_", " ")} · {item.visibility}
            {item.createdAt ? ` · posted ${ago(item.createdAt)}` : ""} ·{" "}
            <Link href={`/p/${item.targetId}`}>open</Link>
          </p>
        </div>
      )}

      {item.username && (
        <div className="admin-person">
          <Avatar name={item.username} url={item.avatarUrl} size={32} />
          <span>
            <Link href={`/u/${item.username}`}>@{item.username}</Link>
            {item.isBanned && <strong className="admin-banned"> · banned</strong>}
            <span className="admin-meta">
              {" "}
              · {item.userPolls} {item.userPolls === 1 ? "poll" : "polls"} · {item.userReports}{" "}
              {item.userReports === 1 ? "report" : "reports"} in total
            </span>
          </span>
        </div>
      )}

      <div className="admin-actions">
        {confirmBan ? (
          <>
            <span className="confirm-text">
              Ban @{item.username}? They can&apos;t vote or post, and all their polls are hidden.
            </span>
            <button type="button" className="mini-btn mini-btn-danger" disabled={busy} onClick={() => run("ban")}>
              Ban
            </button>
            <button type="button" className="mini-btn" onClick={() => setConfirmBan(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            {isPoll && (
              <button type="button" className="mini-btn mini-btn-coral" disabled={busy} onClick={() => run("remove")}>
                Remove poll
              </button>
            )}
            <button type="button" className="mini-btn" disabled={busy} onClick={() => run("dismiss")}>
              {isPoll && item.hiddenReason === "reports" ? "Keep (show again)" : "Dismiss"}
            </button>
            {item.username && !item.isBanned && (
              <button type="button" className="mini-btn mini-btn-danger-text" disabled={busy} onClick={() => setConfirmBan(true)}>
                Ban @{item.username}
              </button>
            )}
          </>
        )}
      </div>
      {error && (
        <p className="poll-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

const DID: Record<LogItem["action"], string> = {
  remove: "removed",
  restore: "restored",
  dismiss: "dismissed reports on",
  ban: "banned",
  unban: "unbanned",
};

function Done() {
  const [items, setItems] = useState<LogItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchLog()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);
  useEffect(load, [load]);

  async function undo(it: LogItem) {
    setBusy(it.id);
    try {
      if (it.action === "remove") await moderate("poll", it.targetId, "restore");
      else if (it.action === "ban" && it.userId) await moderate("user", it.userId, "unban");
      load();
    } finally {
      setBusy(null);
    }
  }

  if (!items) return <p className="admin-empty" aria-busy="true">Loading…</p>;
  if (!items.length) return <p className="admin-empty">No actions yet.</p>;
  return (
    <ul className="admin-list">
      {items.map((it) => (
        <li key={it.id} className="admin-card admin-log">
          <span>
            <strong>@{it.admin ?? "admin"}</strong> {DID[it.action]}{" "}
            {it.targetType === "poll" && it.question ? <>“{it.question}”</> : <>@{it.username}</>}
            <span className="admin-meta"> · {ago(it.at)}</span>
            {it.undone && <span className="admin-meta"> · undone</span>}
          </span>
          {!it.undone && (it.action === "remove" || it.action === "ban") && (
            <button type="button" className="mini-btn" disabled={busy === it.id} onClick={() => undo(it)}>
              Undo
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Targets from docs/poll-app-validation.md (after ~4 weeks with real users). */
const TARGETS = {
  votePct: { min: 60, label: "≥60%" },
  votesPerSession: { min: 8, label: "≥8" },
  shareRate: { min: 3, label: "3–5%" },
  d1: { min: 30, label: "≥30%" },
  d7: { min: 12, label: "≥12%" },
};

function Metrics() {
  const [days, setDays] = useState(14);
  const [rows, setRows] = useState<DayMetrics[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    fetchMetrics(days)
      .then((r) => live && setRows(r))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [days]);

  if (error) return <p className="poll-error">Couldn&apos;t load metrics.</p>;

  const sum = (f: (r: DayMetrics) => number, list = rows ?? []) => list.reduce((a, r) => a + f(r), 0);
  const pct = (a: number, b: number) => (b ? (100 * a) / b : null);
  const withD1 = (rows ?? []).filter((r) => r.d1 !== null);
  const withD7 = (rows ?? []).filter((r) => r.d7 !== null);
  const summary = rows && {
    visitors: sum((r) => r.visitors),
    votes: sum((r) => r.votes),
    votePct: pct(sum((r) => r.voters), sum((r) => r.visitors)),
    votesPerSession: sum((r) => r.signedSessions) ? sum((r) => r.votes) / sum((r) => r.signedSessions) : null,
    shareRate: pct(sum((r) => r.shares), sum((r) => r.votes)),
    d1: pct(sum((r) => ((r.d1 ?? 0) * r.newVisitors) / 100, withD1), sum((r) => r.newVisitors, withD1)),
    d7: pct(sum((r) => ((r.d7 ?? 0) * r.newVisitors) / 100, withD7), sum((r) => r.newVisitors, withD7)),
  };

  return (
    <section className="admin-metrics">
      <div className="admin-range" role="group" aria-label="Days">
        {[7, 14, 30].map((n) => (
          <button key={n} type="button" className="mini-btn" aria-pressed={days === n} onClick={() => setDays(n)}>
            {n} days
          </button>
        ))}
      </div>

      {!summary ? (
        <p className="admin-empty" aria-busy="true">Loading…</p>
      ) : (
        <>
          <div className="metric-grid">
            <Stat label="Visitors" value={summary.visitors.toLocaleString("en-IN")} />
            <Stat label="Votes" value={summary.votes.toLocaleString("en-IN")} />
            <Stat label="Visitors who vote" value={summary.votePct} unit="%" target={TARGETS.votePct} />
            <Stat label="Votes per session" value={summary.votesPerSession} target={TARGETS.votesPerSession} />
            <Stat label="Share rate (shares ÷ votes)" value={summary.shareRate} unit="%" target={TARGETS.shareRate} />
            <Stat label="Back next day (D1)" value={summary.d1} unit="%" target={TARGETS.d1} />
            <Stat label="Back after a week (D7)" value={summary.d7} unit="%" target={TARGETS.d7} />
          </div>

          <div className="admin-table-wrap" tabIndex={0} aria-label="Metrics by day">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Visitors</th>
                  <th scope="col">New</th>
                  <th scope="col">Voters</th>
                  <th scope="col">Votes</th>
                  <th scope="col">Vote %</th>
                  <th scope="col">Votes / session</th>
                  <th scope="col">Shares</th>
                  <th scope="col">Polls</th>
                  <th scope="col">Sign-ups</th>
                  <th scope="col">D1</th>
                  <th scope="col">D7</th>
                </tr>
              </thead>
              <tbody>
                {rows!.map((r) => (
                  <tr key={r.day}>
                    <th scope="row">{new Date(r.day).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</th>
                    <td>{r.visitors}</td>
                    <td>{r.newVisitors}</td>
                    <td>{r.voters}</td>
                    <td>{r.votes}</td>
                    <td>{r.votePct ?? "–"}</td>
                    <td>{r.votesPerSession ?? "–"}</td>
                    <td>{r.shares}</td>
                    <td>{r.polls}</td>
                    <td>{r.signups}</td>
                    <td>{r.d1 === null ? "–" : `${r.d1}%`}</td>
                    <td>{r.d7 === null ? "–" : `${r.d7}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="admin-meta admin-note">
            Days are India time. Visitors are browsers (a random id, no personal data); votes per session counts signed-in
            sessions; D1 / D7 are the share of each day&apos;s new visitors who came back 1 / 7 days later, shown once that
            day is over.
          </p>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, unit = "", target }: { label: string; value: number | string | null; unit?: string; target?: { min: number; label: string } }) {
  const n = typeof value === "number" ? value : null;
  const shown = value === null ? "–" : typeof value === "number" ? `${Math.round(value * 10) / 10}${unit}` : value;
  const ok = target && n !== null ? n >= target.min : null;
  return (
    <div className="metric" data-ok={ok === null ? undefined : String(ok)}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{shown}</span>
      {target && (
        <span className="metric-target">
          {ok === null ? "No data yet" : ok ? "✓ On target" : "↓ Below target"} · goal {target.label}
        </span>
      )}
    </div>
  );
}
