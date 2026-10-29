"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchUserDetail,
  fetchUserEmail,
  fetchUsers,
  fetchUsersSummary,
  moderate,
  resetUsername,
  setTestAccount,
  type PushState,
  type UserDetail,
  type UserFilter,
  type UserRow,
  type UserSort,
  type UsersSummary,
} from "@/lib/admin";

const PAGE = 50;
const FILTERS: { id: UserFilter; label: string }[] = [
  { id: "all", label: "Everyone" },
  { id: "week", label: "Joined this week" },
  { id: "novote", label: "No vote yet" },
  { id: "push_off", label: "Notifications off" },
  { id: "banned", label: "Banned" },
  { id: "test", label: "Test" },
];
const SOURCE: Record<string, string> = {
  poll: "Shared poll",
  invite: "Invite link",
  email: "Email",
  notification: "Notification",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  facebook: "Facebook",
  x: "X",
  snapchat: "Snapchat",
  old_address: "Old address",
  search: "Search",
  direct: "Direct",
};
const PUSH: Record<PushState, [string, string]> = {
  on: ["On", "ppl-on"],
  off: ["Off", "ppl-off"],
  never: ["Never asked", "ppl-ask"],
  blocked: ["Blocked", "ppl-block"],
  unsupported: ["Can't", "ppl-off"],
  unknown: ["Unknown", "ppl-off"],
};
const COLORS = ["#ff7a59", "#6cb4ff", "#52d6a8", "#b79cff", "#ffd23f"];

export const minutesSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 60000;
export function ago(iso: string | null) {
  if (!iso) return "never";
  const m = Math.round(minutesSince(iso));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 24 * 60) return `${Math.round(m / 60)}h ago`;
  if (m < 48 * 60) return "yesterday";
  return `${Math.round(m / 1440)} days ago`;
}
export const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** "Shared poll" + "by @riya.k", "Instagram", "Unknown"… */
export function sourceText(r: { source: string | null; sourceBy: string | null; site: string | null }): [string, string | null] {
  if (!r.source) return ["Unknown", "before this was recorded"];
  if (r.source === "other_site") return [r.site ?? "Another site", null];
  const by = r.sourceBy ? (r.source === "invite" ? `from @${r.sourceBy}` : `by @${r.sourceBy}`) : null;
  return [SOURCE[r.source] ?? r.source, by];
}

export function phoneText(r: { device: string | null; browser: string | null; inApp: string | null; installed?: boolean | null }): [string, string | null] {
  if (!r.device) return ["Unknown", null];
  return [r.device, r.installed ? "installed app" : r.inApp ? `inside ${r.inApp}` : r.browser];
}

const howJoined = (u: UserRow) => {
  if (!u.wasGuest || !u.guestSince) return "Google";
  const m = (new Date(u.joined).getTime() - new Date(u.guestSince).getTime()) / 60000;
  const days = Math.round(m / 1440);
  const span = m < 60 ? `${Math.max(1, Math.round(m))} min` : m < 24 * 60 ? `${Math.round(m / 60)} h` : `${days} day${days === 1 ? "" : "s"}`;
  return `was a guest for ${span}`;
};

function Avatar({ u, size = 34 }: { u: { username: string; avatarUrl: string | null }; size?: number }) {
  const color = COLORS[u.username.charCodeAt(0) % COLORS.length];
  return u.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="ppl-av" src={u.avatarUrl} alt="" width={size} height={size} style={{ width: size, height: size }} referrerPolicy="no-referrer" />
  ) : (
    <span className="ppl-av" style={{ width: size, height: size, background: color, fontSize: size * 0.42 }} aria-hidden="true">
      {u.username[0]?.toUpperCase()}
    </span>
  );
}

const Badges = ({ u }: { u: UserRow }) => (
  <>
    {u.isAdmin && <span className="ppl-chip ppl-test">You</span>}
    {u.isTest && !u.isAdmin && <span className="ppl-chip ppl-test">Test</span>}
    {u.isBanned && <span className="ppl-chip ppl-ban">Banned</span>}
  </>
);

/** Admin → Users: everyone who signed up; `openId` shows one person's page. */
export function AdminUsers({ openId, onOpen }: { openId: string | null; onOpen: (id: string | null) => void }) {
  if (openId) return <Person id={openId} onBack={() => onOpen(null)} />;
  return <UserList onOpen={(id) => onOpen(id)} />;
}

function UserList({ onOpen }: { onOpen: (id: string) => void }) {
  const [summary, setSummary] = useState<UsersSummary | null>(null);
  const [filter, setFilter] = useState<UserFilter>("all");
  const [sort, setSort] = useState<UserSort>("new");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    fetchUsersSummary()
      .then(setSummary)
      .catch(() => {});
  }, []);
  // Search as you type, a moment after the last key.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    let live = true;
    fetchUsers(filter, query, sort, PAGE, 0)
      .then((r) => {
        if (!live) return;
        setRows(r.rows);
        setTotal(r.total);
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [filter, query, sort]);

  async function loadMore() {
    if (!rows) return;
    setMore(true);
    try {
      const r = await fetchUsers(filter, query, sort, PAGE, rows.length);
      setRows([...rows, ...r.rows]);
    } catch {
      setFailed(true);
    }
    setMore(false);
  }

  return (
    <div className="ppl">
      <div className="ppl-tiles">
        <div className="ppl-tile">
          <span>Signed up</span>
          <b>{summary ? summary.total : "–"}</b>
          <small>{summary ? `+${summary.newWeek} this week` : ""}</small>
        </div>
        <div className="ppl-tile ppl-tile-mint">
          <span>Active this week</span>
          <b>{summary ? summary.activeWeek : "–"}</b>
          <small>{summary && summary.total ? `${Math.round((summary.activeWeek / summary.total) * 100)}% of everyone who signed up` : ""}</small>
        </div>
        <div className="ppl-tile ppl-tile-sky">
          <span>Notifications on</span>
          <b>{summary ? summary.pushOn : "–"}</b>
          <small>{summary ? `${summary.total ? Math.round((summary.pushOn / summary.total) * 100) : 0}% · ${summary.pushNever} never asked` : ""}</small>
        </div>
        <div className="ppl-tile ppl-tile-sun">
          <span>Joined, never voted</span>
          <b>{summary ? summary.noVote : "–"}</b>
          <small>signed up, then left</small>
        </div>
      </div>

      <section className="ppl-card" aria-label="Users">
        <div className="ppl-tools">
          <label className="ppl-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input id="ppl-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search username or name" aria-label="Search username or name" />
          </label>
          <div className="ppl-pills" role="group" aria-label="Filter">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className="err-pill press" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <label className="ppl-sort">
            Sort
            <select id="ppl-sort" className="field-input" value={sort} onChange={(e) => setSort(e.target.value as UserSort)}>
              <option value="new">Newest first</option>
              <option value="active">Last active</option>
              <option value="votes">Most votes</option>
              <option value="friends">Most friends</option>
            </select>
          </label>
          <button type="button" className="ppl-locked" disabled title="Comes with the authenticator code">
            🔒 Export CSV
          </button>
        </div>

        {failed ? (
          <p className="poll-error ppl-pad">Couldn&apos;t load people. Has 20261206000000_people.sql been run?</p>
        ) : !rows ? (
          <p className="admin-empty ppl-pad" aria-busy="true">
            Loading…
          </p>
        ) : !rows.length ? (
          <p className="admin-empty ppl-pad">Nobody here.</p>
        ) : (
          <>
            <div className="ppl-head" aria-hidden="true">
              <span>Person</span>
              <span>Joined</span>
              <span>Came from</span>
              <span>Phone</span>
              <span>Last active</span>
              <span className="ppl-n">Votes</span>
              <span className="ppl-n">Polls</span>
              <span className="ppl-n">Friends</span>
              <span>Notifications</span>
            </div>
            <ul className="ppl-rows">
              {rows.map((u) => {
                const [src, by] = sourceText(u);
                const [ph, phSub] = phoneText(u);
                return (
                  <li key={u.id}>
                    <button type="button" className="ppl-row" onClick={() => onOpen(u.id)}>
                      <span className="ppl-who">
                        <Avatar u={u} />
                        <span>
                          <b>
                            @{u.username} <Badges u={u} />
                          </b>
                          <small>{u.name ?? ""}</small>
                        </span>
                      </span>
                      <span className="ppl-cell">
                        <span className="ppl-k">Joined </span>
                        {day(u.joined)}
                        <small>{howJoined(u)}</small>
                      </span>
                      <span className="ppl-cell">
                        <span className="ppl-k">From </span>
                        {src}
                        {by && <small>{by}</small>}
                      </span>
                      <span className="ppl-cell">
                        {ph}
                        {phSub && <small>{phSub}</small>}
                      </span>
                      <span className="ppl-cell ppl-last">
                        <span className="ppl-k">Active </span>
                        {ago(u.lastActive)}
                      </span>
                      <span className="ppl-n">
                        <b>{u.votes}</b>
                        <span className="ppl-k"> votes</span>
                      </span>
                      <span className="ppl-n">
                        {u.polls}
                        <span className="ppl-k"> polls</span>
                      </span>
                      <span className="ppl-n">
                        {u.friends}
                        <span className="ppl-k"> friends</span>
                      </span>
                      <span>
                        <span className={`ppl-chip ${PUSH[u.push][1]}`}>{PUSH[u.push][0]}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {rows.length < total && (
              <div className="ppl-more">
                <button type="button" className="btn press" onClick={loadMore} disabled={more}>
                  {more ? "Loading…" : `Show more (${total - rows.length} left)`}
                </button>
              </div>
            )}
          </>
        )}
        <p className="ppl-foot">
          <span>{rows ? `Showing ${rows.length} of ${total}` : ""}</span>
          <span>Emails stay hidden until you tap Show on a person&apos;s page</span>
        </p>
      </section>
    </div>
  );
}

function Person({ id, onBack }: { id: string; onBack: () => void }) {
  const [d, setD] = useState<UserDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"ban" | "reset" | null>(null);
  const [typed, setTyped] = useState("");
  const top = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    fetchUserDetail(id)
      .then((x) => {
        setD(x);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [id]);
  useEffect(load, [load]);
  // Braces: newer Chrome and Edge return a Promise from scrollIntoView, and an effect that
  // returns anything but a cleanup function crashes when the page closes.
  useEffect(() => {
    top.current?.scrollIntoView({ block: "start" });
  }, []);

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      setNote(done);
      setConfirm(null);
      setTyped("");
      load();
    } catch {
      setNote("That didn't work. Try again?");
    }
    setBusy(false);
  }

  if (failed) {
    return (
      <div className="ppl" ref={top}>
        <button type="button" className="ppl-back" onClick={onBack}>
          ‹ Users
        </button>
        <p className="poll-error">That person is gone, or the link is wrong.</p>
      </div>
    );
  }
  if (!d) {
    return (
      <div className="ppl" ref={top}>
        <button type="button" className="ppl-back" onClick={onBack}>
          ‹ Users
        </button>
        <p className="admin-empty" aria-busy="true">
          Loading…
        </p>
      </div>
    );
  }

  const [src, by] = sourceText(d);
  const [ph, phSub] = phoneText(d);
  const stats: [number, string][] = [
    [d.votes, "votes"],
    [d.polls, "polls"],
    [d.snaps, "snaps"],
    [d.comments, "comments"],
    [d.friends, "friends"],
    [d.propsGiven, "props given"],
    [d.propsReceived, "props received"],
    [d.daysActive, "days active"],
  ];

  return (
    <div className="ppl" ref={top}>
      <button type="button" className="ppl-back" onClick={onBack}>
        ‹ Users
      </button>
      <div className="ppl-person">
        <div className="ppl-col">
          <section className="ppl-card ppl-pad ppl-stack" aria-label="About">
            <div className="ppl-id">
              <Avatar u={d} size={64} />
              <div>
                <h2 className="ppl-name">
                  @{d.username} <Badges u={d} />
                </h2>
                <p className="ppl-sub">
                  {d.name ? `${d.name} · ` : ""}joined {day(d.joined)} · {howJoined(d)}
                </p>
              </div>
            </div>
            {d.emailHint && (
              <span className="ppl-email">
                <span>{email ?? d.emailHint}</span>
                {email ? (
                  <small>Shown · in the admin log</small>
                ) : (
                  <button
                    type="button"
                    className="ppl-mini"
                    onClick={() =>
                      fetchUserEmail(d.id)
                        .then((e) => setEmail(e ?? "No email"))
                        .catch(() => setNote("Couldn't show the email."))
                    }
                  >
                    Show
                  </button>
                )}
              </span>
            )}
            <div className="ppl-facts">
              <span className={`ppl-chip ${PUSH[d.push][1]}`}>Notifications: {PUSH[d.push][0]}</span>
              <span className="ppl-chip ppl-plain">
                {ph}
                {phSub ? ` · ${phSub}` : ""}
              </span>
              <span className="ppl-chip ppl-plain">
                Came from: {src}
                {by ? ` ${by}` : ""}
              </span>
              {d.streak > 0 && <span className="ppl-chip ppl-ask">🔥 {d.streak}-day streak</span>}
              {d.reports > 0 && (
                <span className="ppl-chip ppl-block">
                  {d.reports} report{d.reports === 1 ? "" : "s"} against
                </span>
              )}
            </div>
            <div className="ppl-stats">
              {stats.map(([n, label]) => (
                <div key={label}>
                  <b>{n}</b>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <p className="ppl-note">Last active {ago(d.lastActive)}.</p>
          </section>

          <section className="ppl-card ppl-pad ppl-stack" aria-label="Their polls">
            <span className="err-label">Their polls</span>
            {d.pollList.length ? (
              <ul className="ppl-polls">
                {d.pollList.map((p) => (
                  <li key={p.id}>
                    <span>
                      {p.question}
                      <small>
                        {p.kind === "snap" ? "Snap · " : ""}
                        {p.visibility === "public" ? "Everyone" : p.visibility === "circle" ? "Friends only" : "Link only"} ·{" "}
                        {p.deleted ? "deleted by them" : p.hidden ? "hidden" : minutesSince(p.closesAt) > 0 ? "closed" : "open"} · {day(p.createdAt)}
                      </small>
                    </span>
                    <b>{p.votes} votes</b>
                    {!p.deleted && (
                      <button
                        type="button"
                        className="ppl-mini"
                        disabled={busy}
                        onClick={() => act(() => moderate("poll", p.id, p.hidden ? "restore" : "remove"), p.hidden ? "Restored." : "Removed. Undo it from the Admin log.")}
                      >
                        {p.hidden ? "Restore" : "Remove"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ppl-note">No polls yet.</p>
            )}
          </section>
        </div>

        <div className="ppl-col">
          <section className="ppl-card ppl-pad ppl-stack" aria-label="What they've done">
            <span className="err-label">What they&apos;ve done</span>
            <ul className="ppl-tl">
              {d.timeline.map((t, i) => (
                <li key={i}>
                  <time>{when(t.at)}</time>
                  <i className={`ppl-dot ppl-dot-${t.kind}`} aria-hidden="true" />
                  <span>{t.text}</span>
                </li>
              ))}
            </ul>
          </section>

          {!d.isAdmin && (
            <section className="ppl-card ppl-pad ppl-stack" aria-label="Actions">
              <span className="err-label">Actions</span>
              <div className="ppl-actions">
                <button
                  type="button"
                  className="btn press"
                  disabled={busy}
                  onClick={() => act(() => setTestAccount(d.username, !d.isTest), d.isTest ? "Counted again." : "Marked as a test account: left out of every number.")}
                >
                  {d.isTest ? "Count them again" : "Mark as test account"}
                </button>
                <button type="button" className="btn press" disabled={busy} onClick={() => setConfirm(confirm === "reset" ? null : "reset")}>
                  Reset username
                </button>
                <button
                  type="button"
                  className="btn press"
                  onClick={() =>
                    navigator.clipboard.writeText(d.id).then(
                      () => setNote("User ID copied."),
                      () => setNote(`User ID: ${d.id}`),
                    )
                  }
                >
                  Copy user ID
                </button>
                {d.isBanned ? (
                  <button type="button" className="btn press" disabled={busy} onClick={() => act(() => moderate("user", d.id, "unban"), "Unbanned.")}>
                    Unban
                  </button>
                ) : (
                  <button type="button" className="btn press ppl-danger" disabled={busy} onClick={() => setConfirm(confirm === "ban" ? null : "ban")}>
                    Ban…
                  </button>
                )}
              </div>
              {confirm === "reset" && (
                <div className="ppl-confirm">
                  <p>Give @{d.username} a fresh username? They&apos;ll be asked to pick a new one next time they open Eithr.</p>
                  <div className="ppl-actions">
                    <button type="button" className="btn btn-coral press" disabled={busy} onClick={() => act(() => resetUsername(d.id), "Username reset.")}>
                      Reset it
                    </button>
                    <button type="button" className="btn press" onClick={() => setConfirm(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {confirm === "ban" && (
                <div className="ppl-confirm">
                  <label htmlFor="ppl-ban">
                    They won&apos;t be able to vote, post or report, and their polls will be hidden. Type <b>{d.username}</b> to confirm.
                  </label>
                  <input id="ppl-ban" className="field-input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
                  <div className="ppl-actions">
                    <button
                      type="button"
                      className="btn press ppl-danger"
                      disabled={busy || typed.trim().replace(/^@/, "").toLowerCase() !== d.username.toLowerCase()}
                      onClick={() => act(() => moderate("user", d.id, "ban"), "Banned. Unban any time.")}
                    >
                      Ban @{d.username}
                    </button>
                    <button type="button" className="btn press" onClick={() => setConfirm(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {note && (
                <p className="notif-note" role="status">
                  {note}
                </p>
              )}
              <p className="ppl-note">Every action here goes into the Admin log, with Undo where it can.</p>
            </section>
          )}
          {d.isAdmin && note && (
            <p className="notif-note" role="status">
              {note}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
