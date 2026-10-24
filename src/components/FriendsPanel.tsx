"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  addFriend,
  announceCircleChange,
  circleErrorText,
  createGroup,
  deleteGroup,
  friendStatus,
  getInviteCode,
  getMyCircle,
  renameGroup,
  respondRequest,
  searchPeople,
  setGroupMember,
  suggestFriends,
  unfriend,
  type FriendStatus,
  type MyCircle,
  type Person,
  type Suggestion,
} from "@/lib/circle";
import { Avatar } from "./Avatar";

/** Everything on the Friends screen: invite, find, requests, suggestions, friends, lists. */
export function FriendsPanel({ username }: { username: string | null }) {
  const [circle, setCircle] = useState<MyCircle | null>(null);
  const [suggested, setSuggested] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getMyCircle()
      .then(setCircle)
      .catch((e) => setError(circleErrorText(e)));
    suggestFriends()
      .then(setSuggested)
      .catch(() => setSuggested([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Run a change, then reload (and refresh the badges). */
  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      load();
      announceCircleChange();
    } catch (e) {
      setError(circleErrorText(e));
    }
  }

  const sent = circle?.joined.filter((j) => j.status === "pending") ?? [];

  return (
    <div className="circle-panel">
      {error && (
        <p className="poll-error" role="alert">
          {error}
        </p>
      )}

      {username && <InviteCard username={username} />}

      {circle && circle.requests.length > 0 && (
        <section className="circle-section">
          <h2 className="circle-title">
            Friend requests <span className="count-pill">{circle.requests.length}</span>
          </h2>
          <ul className="people">
            {circle.requests.map((r) => (
              <li key={r.username} className="person">
                <PersonLink person={r} />
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

      <FindPeople onChanged={load} />

      {suggested && suggested.length > 0 && (
        <section className="circle-section">
          <h2 className="circle-title">People you might know</h2>
          <ul className="people">
            {suggested.map((s) => (
              <li key={s.username} className="person">
                <PersonLink person={s} />
                <span className="person-note">
                  {s.mutual > 0
                    ? `${s.mutual} mutual ${s.mutual === 1 ? "friend" : "friends"}`
                    : s.voted > 0
                      ? "You vote on their polls"
                      : "Top creator this week"}
                </span>
                <div className="person-actions">
                  <button type="button" className="mini-btn mini-btn-coral" onClick={() => act(() => addFriend(s.username))}>
                    Add
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {circle && (
        <section className="circle-section">
          <h2 className="circle-title">
            Friends <span className="count-pill">{circle.members.length}</span>
          </h2>
          {circle.members.length === 0 ? (
            <p className="circle-empty">
              No friends yet. Share your invite link above: whoever opens it becomes your friend straight away. Friends see
              the polls you share with friends, and you see theirs.
            </p>
          ) : (
            <ul className="people">
              {circle.members.map((m) => (
                <Friend key={m.username} member={m} circle={circle} act={act} />
              ))}
            </ul>
          )}
        </section>
      )}

      {circle && circle.members.length > 0 && <Lists circle={circle} act={act} />}

      {sent.length > 0 && (
        <section className="circle-section">
          <h2 className="circle-title">Requests you sent</h2>
          <ul className="people">
            {sent.map((j) => (
              <li key={j.username} className="person">
                <PersonLink person={j} />
                <div className="person-actions">
                  <button type="button" className="mini-btn" onClick={() => act(() => unfriend(j.username))}>
                    Cancel
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

/** "Invite friends": a link that makes whoever opens it your friend. */
function InviteCard({ username }: { username: string }) {
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    getInviteCode()
      .then((code) => setUrl(`${window.location.origin}/u/${username}?invite=${code}`))
      .catch(() => setUrl(`${window.location.origin}/u/${username}`));
  }, [username]);

  async function share() {
    if (!url) return;
    const text = `Add me on Docchi, the app for settling arguments with polls.`;
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
        <strong>Invite friends</strong>
        <span className="invite-url">Opening it adds you as friends.</span>
      </div>
      <button type="button" className="btn btn-coral press" onClick={share} disabled={!url}>
        {copied ? "Copied!" : "Share link"}
      </button>
    </section>
  );
}

/** The button for someone in a list of people, by where I stand with them. */
function FriendButton({ status, onAdd, onAccept }: { status: FriendStatus; onAdd: () => void; onAccept: () => void }) {
  if (status === "none")
    return (
      <button type="button" className="mini-btn mini-btn-coral" onClick={onAdd}>
        Add
      </button>
    );
  if (status === "incoming")
    return (
      <button type="button" className="mini-btn mini-btn-mint" onClick={onAccept}>
        Accept
      </button>
    );
  return (
    <span className={`chip chip-small ${status === "friends" ? "chip-mint" : ""}`}>{status === "friends" ? "Friends" : "Requested"}</span>
  );
}

/** Search by username. */
function FindPeople({ onChanged }: { onChanged: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ q: string; people: (Person & { status: FriendStatus })[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = q.trim().toLowerCase().replace(/^@/, "");

  const search = useCallback((term: string) => {
    searchPeople(term)
      .then((people) => setResults({ q: term, people: people.map((p) => ({ ...p, status: friendStatus(p.theirCircle, p.myCircle) })) }))
      .catch(() => setResults({ q: term, people: [] }));
  }, []);

  useEffect(() => {
    if (query.length < 2) return;
    const timer = window.setTimeout(() => search(query), 300);
    return () => window.clearTimeout(timer);
  }, [query, search]);

  const shown = query.length >= 2 && results?.q === query ? results.people : null;

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      search(query);
      announceCircleChange();
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
                <FriendButton
                  status={p.status}
                  onAdd={() => run(() => addFriend(p.username))}
                  onAccept={() => run(() => respondRequest(p.username, true))}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Act = (fn: () => Promise<unknown>) => Promise<void>;

/** Lists: Family (3), Office (5)… plus new / rename / delete. */
function Lists({ circle, act }: { circle: MyCircle; act: Act }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [rename, setRename] = useState("");

  return (
    <section className="circle-section">
      <h2 className="circle-title">Lists</h2>
      <p className="circle-hint">Sort friends into lists, like Family or Office, to share a poll with just them.</p>
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
              <input className="answer-input" aria-label="List name" maxLength={24} value={rename} onChange={(e) => setRename(e.target.value)} autoFocus />
              <button type="submit" className="mini-btn mini-btn-mint">
                Save
              </button>
              <button type="button" className="mini-btn mini-btn-danger-text" onClick={() => act(() => deleteGroup(g.id)).then(() => setEditing(null))}>
                Delete list
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
              aria-label={`${g.name}, ${g.count} people. Edit list`}
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
                aria-label="New list name"
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
              + New list
            </button>
          ))}
      </div>
    </section>
  );
}

/** A friend: their lists (tap to toggle) and Unfriend. */
function Friend({ member, circle, act }: { member: MyCircle["members"][number]; circle: MyCircle; act: Act }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="person person-member">
      <PersonLink person={member} />
      <div className="person-actions">
        {confirming ? (
          <>
            <button type="button" className="mini-btn mini-btn-danger" onClick={() => act(() => unfriend(member.username))}>
              Unfriend
            </button>
            <button type="button" className="mini-btn" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className="mini-btn mini-btn-danger-text" onClick={() => setConfirming(true)}>
            Unfriend
          </button>
        )}
      </div>
      {circle.groups.length > 0 && (
        <div className="member-groups" role="group" aria-label={`Lists for @${member.username}`}>
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
