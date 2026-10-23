"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  announceCircleChange,
  circleErrorText,
  createGroup,
  deleteGroup,
  getMyCircle,
  leaveCircle,
  removeFromCircle,
  renameGroup,
  requestCircle,
  respondRequest,
  searchPeople,
  setGroupMember,
  type CircleStatus,
  type MyCircle,
  type Person,
} from "@/lib/circle";
import { Avatar } from "./Avatar";

/** The Circle tab on your own profile. */
export function CirclePanel({ username, onChanged }: { username: string | null; onChanged?: () => void }) {
  const [circle, setCircle] = useState<MyCircle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getMyCircle()
      .then(setCircle)
      .catch((e) => setError(circleErrorText(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Run a change, then reload the circle (and the badge). */
  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      load();
      announceCircleChange();
      onChanged?.();
    } catch (e) {
      setError(circleErrorText(e));
    }
  }

  return (
    <div className="circle-panel">
      {error && (
        <p className="poll-error" role="alert">
          {error}
        </p>
      )}

      {username && <InviteCard username={username} />}

      <FindPeople onChanged={load} />

      {circle && circle.requests.length > 0 && (
        <section className="circle-section">
          <h2 className="circle-title">
            Requests <span className="count-pill">{circle.requests.length}</span>
          </h2>
          <ul className="people">
            {circle.requests.map((r) => (
              <li key={r.username} className="person">
                <PersonLink person={r} />
                <span className="person-note">wants to join</span>
                <div className="person-actions">
                  <button type="button" className="mini-btn mini-btn-mint" onClick={() => act(() => respondRequest(r.username, true))}>
                    Accept
                  </button>
                  <button type="button" className="mini-btn" onClick={() => act(() => respondRequest(r.username, false))}>
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {circle && <Groups circle={circle} act={act} />}

      {circle && (
        <section className="circle-section">
          <h2 className="circle-title">
            In your circle <span className="count-pill">{circle.members.length}</span>
          </h2>
          {circle.members.length === 0 ? (
            <p className="circle-empty">
              Nobody yet. Send your link above: people ask to join, you accept. Then they see the polls you share with
              your circle.
            </p>
          ) : (
            <ul className="people">
              {circle.members.map((m) => (
                <Member key={m.username} member={m} circle={circle} act={act} />
              ))}
            </ul>
          )}
        </section>
      )}

      {circle && circle.joined.length > 0 && (
        <section className="circle-section">
          <h2 className="circle-title">Circles you&apos;re in</h2>
          <ul className="people">
            {circle.joined.map((j) => (
              <li key={j.username} className="person">
                <PersonLink person={j} />
                <span className={`chip chip-small ${j.status === "member" ? "chip-mint" : ""}`}>
                  {j.status === "member" ? "In" : "Requested"}
                </span>
                <div className="person-actions">
                  <button type="button" className="mini-btn" onClick={() => act(() => leaveCircle(j.username))}>
                    {j.status === "member" ? "Leave" : "Cancel"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!circle && !error && <div className="skeleton profile-skeleton" />}
    </div>
  );
}

export function PersonLink({ person }: { person: Person }) {
  return (
    <Link href={`/u/${person.username}`} className="person-link">
      <Avatar name={person.username} url={person.avatarUrl} size={36} />
      <span className="person-name">@{person.username}</span>
    </Link>
  );
}

/** "Your link": the way people find you and ask to join. */
function InviteCard({ username }: { username: string }) {
  const [copied, setCopied] = useState(false);
  const [url] = useState(() => (typeof window === "undefined" ? `/u/${username}` : `${window.location.origin}/u/${username}`));

  async function share() {
    const text = `Join my circle on Docchi. I'll share polls just for us.`;
    try {
      if (navigator.share) await navigator.share({ title: "Docchi", text, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      // Dismissed.
    }
  }

  return (
    <section className="invite-card">
      <div>
        <strong>Your circle link</strong>
        <span className="invite-url">{url.replace(/^https?:\/\//, "")}</span>
      </div>
      <button type="button" className="btn btn-coral press" onClick={share}>
        {copied ? "Copied!" : "Share"}
      </button>
    </section>
  );
}

/** Search by username, and ask to join their circle. */
function FindPeople({ onChanged }: { onChanged: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ q: string; people: (Person & { theirCircle: CircleStatus })[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = q.trim().toLowerCase().replace(/^@/, "");

  useEffect(() => {
    if (query.length < 2) return;
    const timer = window.setTimeout(() => {
      searchPeople(query)
        .then((people) => setResults({ q: query, people }))
        .catch(() => setResults({ q: query, people: [] }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const shown = query.length >= 2 && results?.q === query ? results.people : null;

  async function request(name: string) {
    setError(null);
    try {
      const status = await requestCircle(name);
      setResults((r) => r && { ...r, people: r.people.map((p) => (p.username === name ? { ...p, theirCircle: status } : p)) });
      onChanged();
    } catch (e) {
      setError(circleErrorText(e));
    }
  }

  return (
    <section className="circle-section">
      <label htmlFor="people-search" className="circle-title">
        Find people
      </label>
      <div className="name-input-wrap">
        <span aria-hidden="true">@</span>
        <input
          id="people-search"
          className="name-input"
          placeholder="username"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {error && <p className="poll-error">{error}</p>}
      {shown && (
        <ul className="people">
          {shown.length === 0 && <li className="circle-empty">No one by that name yet.</li>}
          {shown.map((p) => (
            <li key={p.username} className="person">
              <PersonLink person={p} />
              <div className="person-actions">
                {p.theirCircle === "none" ? (
                  <button type="button" className="mini-btn mini-btn-coral" onClick={() => request(p.username)}>
                    Ask to join
                  </button>
                ) : (
                  <span className={`chip chip-small ${p.theirCircle === "member" ? "chip-mint" : ""}`}>
                    {p.theirCircle === "member" ? "In their circle" : "Requested"}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Act = (fn: () => Promise<unknown>) => Promise<void>;

/** Group chips: Family (3), Office (5)… plus new / rename / delete. */
function Groups({ circle, act }: { circle: MyCircle; act: Act }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [rename, setRename] = useState("");

  return (
    <section className="circle-section">
      <h2 className="circle-title">Groups</h2>
      <p className="circle-hint">Sort your circle into groups, like Family or Office, to share a poll with just them.</p>
      <div className="group-chips">
        {circle.groups.map((g) =>
          editing === g.id ? (
            <form
              key={g.id}
              className="group-edit"
              onSubmit={(e) => {
                e.preventDefault();
                act(() => renameGroup(g.id, rename)).then(() => setEditing(null));
              }}
            >
              <input className="answer-input" aria-label="Group name" maxLength={24} value={rename} onChange={(e) => setRename(e.target.value)} autoFocus />
              <button type="submit" className="mini-btn mini-btn-mint">
                Save
              </button>
              <button type="button" className="mini-btn mini-btn-danger-text" onClick={() => act(() => deleteGroup(g.id)).then(() => setEditing(null))}>
                Delete group
              </button>
            </form>
          ) : (
            <button
              key={g.id}
              type="button"
              className="group-chip press"
              onClick={() => {
                setEditing(g.id);
                setRename(g.name);
              }}
              aria-label={`${g.name}, ${g.count} people. Edit group`}
            >
              {g.name} <span className="group-count">{g.count}</span>
            </button>
          ),
        )}
        {circle.groups.length < 10 &&
          (adding ? (
            <form
              className="group-edit"
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                act(() => createGroup(name)).then(() => {
                  setAdding(false);
                  setName("");
                });
              }}
            >
              <input
                className="answer-input"
                aria-label="New group name"
                placeholder="Family"
                maxLength={24}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
              <button type="submit" className="mini-btn mini-btn-mint">
                Add
              </button>
              <button type="button" className="mini-btn" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" className="group-chip group-chip-new" onClick={() => setAdding(true)}>
              + New group
            </button>
          ))}
      </div>
    </section>
  );
}

/** Someone in my circle: their groups (tap to toggle) and Remove. */
function Member({ member, circle, act }: { member: MyCircle["members"][number]; circle: MyCircle; act: Act }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="person person-member">
      <PersonLink person={member} />
      <div className="person-actions">
        {confirming ? (
          <>
            <button type="button" className="mini-btn mini-btn-danger" onClick={() => act(() => removeFromCircle(member.username))}>
              Remove
            </button>
            <button type="button" className="mini-btn" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className="mini-btn mini-btn-danger-text" onClick={() => setConfirming(true)}>
            Remove
          </button>
        )}
      </div>
      {circle.groups.length > 0 && (
        <div className="member-groups" role="group" aria-label={`Groups for @${member.username}`}>
          {circle.groups.map((g) => {
            const on = member.groups.includes(g.id);
            return (
              <button
                key={g.id}
                type="button"
                className="member-group"
                aria-pressed={on}
                onClick={() => act(() => setGroupMember(g.id, member.username, !on))}
              >
                {on ? "✓ " : "+ "}
                {g.name}
              </button>
            );
          })}
        </div>
      )}
    </li>
  );
}
