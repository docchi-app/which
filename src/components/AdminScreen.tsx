"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  fetchAdminEvents,
  fetchErrorsSummary,
  fetchLog,
  fetchMetrics,
  fetchTestAccounts,
  setTestAccount,
  fetchViewStats,
  fetchQueue,
  moderate,
  type AdminAction,
  type AdminEvent,
  type DayMetrics,
  type LogItem,
  type QueueItem,
  type TestAccount,
} from "@/lib/admin";
import { onUserChange } from "@/lib/auth";
import { getMyProfile } from "@/lib/profile";
import { REPORT_REASONS } from "@/lib/safety";
import { isSupabaseConfigured } from "@/lib/supabase";
import { Avatar } from "./Avatar";
import { Schedule } from "./AdminSchedule";
import { AdminErrors } from "./AdminErrors";
import { AdminContent, AdminFunnel, AdminNotifications, AdminOverview, AdminSources } from "./AdminGrowth";
import { AdminGuests } from "./AdminGuests";
import { AdminLimits } from "./AdminLimits";
import { AdminUsers } from "./AdminUsers";
import { AdminSnaps } from "./AdminSnaps";
import { AdminWords } from "./AdminWords";
import { LogoMark, Wordmark } from "./Logo";

type Tab =
  | "overview"
  | "errors"
  | "users"
  | "guests"
  | "funnel"
  | "sources"
  | "metrics"
  | "content"
  | "notifications"
  | "reports"
  | "snaps"
  | "words"
  | "schedule"
  | "limits"
  | "tests"
  | "log";

// The sections, grouped as the laptop sidebar shows them (one row of tabs on a phone).
const SECTIONS: { group: string; items: { id: Tab; label: string }[] }[] = [
  { group: "Today", items: [{ id: "overview", label: "Overview" }] },
  { group: "Health", items: [{ id: "errors", label: "Errors" }] },
  { group: "People", items: [{ id: "users", label: "Users" }, { id: "guests", label: "Guests" }] },
  {
    group: "Growth",
    items: [
      { id: "funnel", label: "Funnel & retention" },
      { id: "sources", label: "Sources" },
      { id: "metrics", label: "Metrics" },
    ],
  },
  {
    group: "Content",
    items: [
      { id: "content", label: "Polls & snaps" },
      { id: "notifications", label: "Notifications" },
    ],
  },
  { group: "Safety", items: [{ id: "reports", label: "Reports" }, { id: "snaps", label: "Snaps" }, { id: "words", label: "Words" }] },
  {
    group: "Run",
    items: [
      { id: "schedule", label: "Schedule" },
      { id: "limits", label: "Limits" },
      { id: "tests", label: "Test accounts" },
      { id: "log", label: "Admin log" },
    ],
  },
];
const ALL = SECTIONS.flatMap((g) => g.items);
const isTab = (x: string): x is Tab => ALL.some((i) => i.id === x);

const REASON_LABEL: Record<string, string> = Object.fromEntries(
  REPORT_REASONS.map((r) => [r.id, r.label.split(/[,(]/)[0].replace(/ or .*$/, "")]),
);
// Reasons filed by the AI check ("auto:harassment").
const reasonLabel = (r: string) => REASON_LABEL[r] ?? (r.startsWith("auto:") ? `🤖 Auto check: ${r.slice(5).replace(/[/_-]/g, " ")}` : r);

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

/** The owner's admin: Overview first, then health, people, growth, content, safety and running it. */
export function AdminScreen() {
  // undefined: checking · false: not the admin. The server has already turned away
  // anyone it could tell isn't; this covers a sign-in that had expired.
  const [allowed, setAllowed] = useState<boolean | undefined>(isSupabaseConfigured ? undefined : false);
  // Overview is the admin home (what /admin opens).
  const [tab, setTabState] = useState<Tab>("overview");
  // #errors/12 opens that error (the link in an alert or a GitHub issue).
  const [errorId, setErrorId] = useState<number | null>(null);
  const [newErrors, setNewErrors] = useState(0);
  // #users/<id> opens that person's page.
  const [personId, setPersonId] = useState<string | null>(null);
  const loadBadge = useCallback(() => {
    fetchErrorsSummary(1)
      .then((s) => setNewErrors(s.new))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    return onUserChange(() => {
      getMyProfile()
        .then((p) => setAllowed(Boolean(p?.isAdmin)))
        .catch(() => setAllowed(false));
    });
  }, []);

  // The section is in the address (#metrics), so a reload or a bookmark opens it again.
  useEffect(() => {
    const read = () => {
      const [h, id] = window.location.hash.slice(1).split("/");
      if (isTab(h)) setTabState(h);
      if (h === "errors" && id && /^\d+$/.test(id)) setErrorId(Number(id));
      if (h === "users") setPersonId(id && /^[0-9a-f-]{36}$/i.test(id) ? id : null);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const setTab = (t: Tab) => {
    setTabState(t);
    if (t === "users") setPersonId(null);
    window.history.replaceState(window.history.state, "", `#${t}`);
  };
  const openPerson = (id: string | null) => {
    setTabState("users");
    setPersonId(id);
    window.history.replaceState(window.history.state, "", id ? `#users/${id}` : "#users");
  };

  useEffect(() => {
    if (allowed) loadBadge();
  }, [allowed, loadBadge]);

  // Nothing of the admin (not even its sections) until the sign-in is confirmed as yours.
  if (allowed !== true) {
    return (
      <div className="screen admin admin-gone">
        {allowed === undefined ? (
          <p className="admin-empty" aria-busy="true">Checking…</p>
        ) : (
          <section className="poll-card soon">
            <h1 className="poll-question">This page could not be found.</h1>
            <Link href="/" className="btn btn-coral press">
              Back to Eithr
            </Link>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="screen admin">
      <nav className="admin-side" aria-label="Admin sections">
        <Link href="/" className="admin-back">
          ← Back to Eithr
        </Link>
        <div className="admin-side-brand">
          <LogoMark />
          <span className="chip chip-small chip-sun">Admin</span>
        </div>
        {SECTIONS.map((g) => (
          <div key={g.group} className="admin-side-group">
            <span className="admin-side-label">{g.group}</span>
            {g.items.map((i) => (
              <button key={i.id} type="button" className="admin-side-item" aria-current={tab === i.id ? "page" : undefined} onClick={() => setTab(i.id)}>
                {i.label}
                {i.id === "errors" && newErrors > 0 && <span className="admin-badge">{newErrors} new</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="admin-main">
        <header className="app-header admin-top">
          <Link href="/" className="admin-back-small" aria-label="Back to Eithr">
            ‹
          </Link>
          <Link href="/" className="brand" aria-label="Eithr home">
            <LogoMark />
            <Wordmark />
          </Link>
          <span className="chip chip-small chip-sun">Admin</span>
        </header>
        <div role="tablist" aria-label="Admin" className="tabs admin-tabs">
          {ALL.map((i) => (
            <button key={i.id} role="tab" type="button" aria-selected={tab === i.id} className="tab press" onClick={() => setTab(i.id)}>
              {i.label}
              {i.id === "errors" && newErrors > 0 && <span className="admin-dot" aria-label={`${newErrors} new`} />}
            </button>
          ))}
        </div>
        <h1 className="admin-title">{ALL.find((i) => i.id === tab)!.label}</h1>
        {tab === "overview" && <AdminOverview onGo={setTab} />}
        {tab === "funnel" && <AdminFunnel />}
        {tab === "sources" && <AdminSources />}
        {tab === "content" && <AdminContent />}
        {tab === "notifications" && <AdminNotifications />}
        {tab === "errors" && <AdminErrors key={errorId ?? "list"} initialId={errorId} onChange={loadBadge} />}
        {tab === "users" && <AdminUsers key={personId ?? "list"} openId={personId} onOpen={openPerson} />}
        {tab === "guests" && <AdminGuests onOpenUser={openPerson} />}
        {tab === "reports" && <Queue />}
        {tab === "snaps" && <AdminSnaps />}
        {tab === "words" && <AdminWords />}
        {tab === "metrics" && <Metrics />}
        {tab === "schedule" && <Schedule />}
        {tab === "limits" && <AdminLimits />}
        {tab === "tests" && <TestAccounts />}
        {tab === "log" && <Done />}
      </div>
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
  const isComment = item.targetType === "comment";

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
        <span className={`chip chip-small ${isPoll ? "chip-white" : isComment ? "chip-sun" : "chip-link"}`}>
          {isPoll ? "Poll" : isComment ? "Comment" : "Person"}
        </span>
        {item.hiddenReason === "reports" && <span className="chip chip-small admin-chip-hidden">Hidden by reports</span>}
        <span className="admin-count">
          {item.reports} {item.reports === 1 ? "report" : "reports"} · {ago(item.lastAt)}
        </span>
      </div>

      <div className="admin-reasons">
        {Object.entries(item.reasons).map(([r, n]) => (
          <span key={r} className="admin-reason">
            {reasonLabel(r)}
            {n > 1 ? ` ×${n}` : ""}
          </span>
        ))}
      </div>

      {isComment && (
        <div className="admin-poll">
          <p className="admin-q">“{item.commentText}”</p>
          <p className="admin-meta">on “{item.question}”</p>
        </div>
      )}
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
            {(isPoll || isComment) && (
              <button type="button" className="mini-btn mini-btn-coral" disabled={busy} onClick={() => run("remove")}>
                {isPoll ? "Remove poll" : "Remove comment"}
              </button>
            )}
            <button type="button" className="mini-btn" disabled={busy} onClick={() => run("dismiss")}>
              {(isPoll || isComment) && item.hiddenReason === "reports" ? "Keep (show again)" : "Dismiss"}
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
  schedule: "scheduled",
  reschedule: "changed the schedule for",
  unschedule: "removed a scheduled poll",
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
      if (it.action === "remove") await moderate(it.targetType === "comment" ? "comment" : "poll", it.targetId, "restore");
      else if (it.action === "ban" && it.userId) await moderate("user", it.userId, "unban");
      load();
    } finally {
      setBusy(null);
    }
  }

  if (!items) return <p className="admin-empty" aria-busy="true">Loading…</p>;
  return (
    <>
      <h2 className="admin-sub">Moderation</h2>
      {!items.length ? <p className="admin-empty">No actions yet.</p> : <ModerationLog items={items} busy={busy} undo={undo} />}
      <h2 className="admin-sub">Other changes</h2>
      <OtherChanges />
    </>
  );
}

function ModerationLog({ items, busy, undo }: { items: LogItem[]; busy: string | null; undo: (it: LogItem) => void }) {
  return (
    <ul className="admin-list">
      {items.map((it) => (
        <li key={it.id} className="admin-card admin-log">
          <span>
            <strong>@{it.admin ?? "admin"}</strong> {DID[it.action]}{" "}
            {it.targetType === "user" ? <>@{it.username}</> : it.question ? <>{it.targetType === "comment" ? "comment " : ""}“{it.question}”</> : null}
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

/** Words, test accounts, settings: everything done in admin that isn't moderation. */
function OtherChanges() {
  const [items, setItems] = useState<AdminEvent[] | null>(null);
  useEffect(() => {
    fetchAdminEvents()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);
  if (!items) return <p className="admin-empty" aria-busy="true">Loading…</p>;
  if (!items.length) return <p className="admin-empty">Nothing yet.</p>;
  return (
    <ul className="admin-list">
      {items.map((e, i) => (
        <li key={`${e.at}-${i}`} className="admin-card admin-log">
          <span>
            <strong>@{e.admin ?? "admin"}</strong> {eventText(e)}
            <span className="admin-meta"> · {ago(e.at)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function eventText(e: AdminEvent) {
  switch (e.action) {
    case "word_added":
      return `added the word ${e.detail}`;
    case "word_changed":
      return `changed the word ${e.detail}`;
    case "word_removed":
      return `removed the word ${e.detail}`;
    case "test_added":
      return `marked ${e.detail} as a test account`;
    case "test_removed":
      return `counted ${e.detail} again (not a test account)`;
    case "props_no_wait":
      return `turned props without the wait ${e.detail}`;
    case "limits":
      return `changed a limit: ${e.detail}`;
    default:
      return `${e.action.replace(/_/g, " ")}${e.detail ? ` ${e.detail}` : ""}`;
  }
}

/** Accounts left out of Metrics (yours always is), so testing doesn't skew the numbers. */
function TestAccounts() {
  const [items, setItems] = useState<TestAccount[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchTestAccounts()
      .then(setItems)
      .catch(() => setError("Couldn't load test accounts."));
  }, []);
  useEffect(load, [load]);

  async function change(username: string, on: boolean) {
    setBusy(true);
    setError(null);
    try {
      await setTestAccount(username, on);
      if (on) setName("");
      load();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setError(code === "not_found" ? "No one has that username." : code === "own_account" ? "Your own account is always left out." : "That didn't work. Try again?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-tests">
      <p className="admin-meta admin-note">
        Votes, polls, shares, sign-ups and visits from these accounts (and from any phone they&apos;ve signed in on) are left
        out of Metrics. Your own account always is.
      </p>
      <form
        className="admin-tests-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) change(name, true);
        }}
      >
        <label className="sr-only" htmlFor="test-account">
          Username
        </label>
        <input id="test-account" className="field-input" placeholder="@username" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        <button type="submit" className="mini-btn" disabled={busy || !name.trim()}>
          Add
        </button>
      </form>
      {error && (
        <p className="poll-error" role="alert">
          {error}
        </p>
      )}
      {!items ? (
        <p className="admin-empty" aria-busy="true">Loading…</p>
      ) : !items.length ? (
        <p className="admin-empty">No test accounts yet.</p>
      ) : (
        <ul className="admin-list admin-list-flush">
          {items.map((t) => (
            <li key={t.username} className="admin-card admin-log">
              <span className="admin-person">
                <Avatar url={t.avatarUrl} name={t.username} size={32} />
                <span>
                  <strong>@{t.username}</strong>
                  <span className="admin-meta">
                    {" "}
                    · {t.votes} votes · joined {new Date(t.joined).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </span>
                </span>
              </span>
              <button type="button" className="mini-btn" disabled={busy} aria-label={`Count @${t.username} again`} onClick={() => change(t.username, false)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
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
  const [views, setViews] = useState<Map<string, { views: number; per100: number | null }> | null>(null);
  const [error, setError] = useState(false);
  const [tests, setTests] = useState(0);

  useEffect(() => {
    fetchTestAccounts()
      .then((t) => setTests(t.length))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let live = true;
    fetchMetrics(days)
      .then((r) => live && setRows(r))
      .catch(() => live && setError(true));
    fetchViewStats(days).then((v) => live && setViews(v));
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
  // Votes per 100 views, over the days that have views counted.
  const viewDays = (rows ?? []).filter((r) => (views?.get(r.day)?.views ?? 0) > 0);
  const per100 = pct(sum((r) => r.votes, viewDays), sum((r) => views?.get(r.day)?.views ?? 0, viewDays));

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
            <Stat label="Votes per 100 views" value={per100} />
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
                  <th scope="col">Views</th>
                  <th scope="col">Votes / 100 views</th>
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
                    <td>{views?.get(r.day)?.views || "–"}</td>
                    <td>{views?.get(r.day)?.per100 ?? "–"}</td>
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
            Leaving out your account{tests ? ` and ${tests} test account${tests === 1 ? "" : "s"}` : ""} (Run → Test accounts). Days are India time. Visitors are browsers (a random id, no personal data); votes per session counts signed-in
            sessions; views are counted from the day the live-feed update was installed; D1 / D7 are the share of each day&apos;s new visitors who came back 1 / 7 days later, shown once that
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
