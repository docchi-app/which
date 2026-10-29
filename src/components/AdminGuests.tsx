"use client";

import { useEffect, useState } from "react";
import { fetchGuestList, fetchGuests, type GuestRow, type GuestsSummary } from "@/lib/admin";
import { ago, phoneText, sourceText } from "./AdminUsers";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const minutesText = (m: number) => (m < 60 ? `${m} minutes` : m < 48 * 60 ? `${Math.round(m / 60)} hours` : `${Math.round(m / 1440)} days`);

/** Admin → Guests: visitors, guests who voted without an account, and guests who signed up. */
export function AdminGuests({ onOpenUser }: { onOpenUser: (id: string) => void }) {
  const [days, setDays] = useState(7);
  const [filter, setFilter] = useState<"still" | "signed" | "all">("still");
  const [g, setG] = useState<GuestsSummary | null>(null);
  const [rows, setRows] = useState<GuestRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetchGuests(days)
      .then((x) => {
        if (!live) return;
        setG(x);
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [days]);
  useEffect(() => {
    let live = true;
    fetchGuestList(days, filter)
      .then((x) => live && setRows(x))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [days, filter]);

  if (failed) return <p className="poll-error ppl-pad">Couldn&apos;t load guests. Has 20261206000000_people.sql been run?</p>;
  const signedTotal = g ? g.buckets.visit + g.buckets.day + g.buckets.days3 + g.buckets.later : 0;
  const buckets: [string, number][] = g
    ? [
        ["Same visit", g.buckets.visit],
        ["Same day", g.buckets.day],
        ["1–3 days", g.buckets.days3],
        ["Later", g.buckets.later],
      ]
    : [];
  const guestShare = g ? pct(g.guestVotes, g.votes) : 0;

  return (
    <div className="ppl">
      <div className="err-range" role="group" aria-label="Time range">
        {[7, 30].map((d) => (
          <button key={d} type="button" className="err-pill press" aria-pressed={days === d} onClick={() => setDays(d)}>
            {d} days
          </button>
        ))}
      </div>

      <section className="ppl-card ppl-flow" aria-label="From visitor to user">
        <div>
          <span className="err-label">Opened Eithr</span>
          <b>{g ? g.opened : "–"}</b>
          <small>visitors, not signed in</small>
          <span className="ppl-bar">
            <i style={{ width: "100%" }} />
          </span>
        </div>
        <div>
          <span className="err-label">Voted as a guest</span>
          <b>{g ? g.voted : "–"}</b>
          <small>
            <strong>{g ? pct(g.voted, g.opened) : 0}%</strong> of visitors
          </small>
          <span className="ppl-bar">
            <i style={{ width: `${g ? pct(g.voted, g.opened) : 0}%` }} />
          </span>
        </div>
        <div>
          <span className="err-label">Then signed up</span>
          <b>{g ? g.signedUp : "–"}</b>
          <small>
            <strong>{g ? pct(g.signedUp, g.voted) : 0}%</strong> of guests · {g ? pct(g.signedUp, g.opened) : 0}% of visitors
          </small>
          <span className="ppl-bar">
            <i style={{ width: `${g ? pct(g.signedUp, g.opened) : 0}%` }} />
          </span>
        </div>
      </section>

      <div className="ppl-two">
        <section className="ppl-card ppl-pad ppl-stack" aria-label="How long guests took to sign up">
          <span className="err-label">How long guests took to sign up</span>
          <div className="ppl-hist">
            {buckets.map(([label, n]) => (
              <div key={label} className="ppl-hist-row">
                <span>{label}</span>
                <span className="ppl-track">
                  <i style={{ width: `${pct(n, signedTotal)}%` }} />
                </span>
                <b>{n}</b>
              </div>
            ))}
          </div>
          <p className="ppl-note">
            {g && g.medianMinutes !== null ? `Median: ${minutesText(g.medianMinutes)}.` : "Nobody signed up from a guest yet in this time."}
          </p>
        </section>
        <section className="ppl-card ppl-pad ppl-stack" aria-label="Who cast the votes">
          <span className="err-label">Who cast the votes</span>
          <div className="ppl-split" role="img" aria-label={`Signed in ${100 - guestShare}%, guests ${guestShare}%`}>
            <span style={{ width: `${100 - guestShare}%` }}>{100 - guestShare >= 15 ? `Signed in ${100 - guestShare}%` : ""}</span>
            <span style={{ width: `${guestShare}%` }}>{guestShare >= 15 ? `Guests ${guestShare}%` : ""}</span>
          </div>
          <div className="ppl-stats ppl-stats-2">
            <div>
              <b>{g ? pct(g.oneVote, g.voted) : 0}%</b>
              <span>of guests left after 1 vote</span>
            </div>
            <div>
              <b>{g?.avgVotes ?? "–"}</b>
              <span>votes per guest{g?.medianVotes !== null && g?.medianVotes !== undefined ? ` (median ${g.medianVotes})` : ""}</span>
            </div>
          </div>
          <p className="ppl-note">Guest votes don&apos;t count in totals until they sign in with Google.</p>
        </section>
      </div>

      <section className="ppl-card" aria-label="Guests">
        <div className="ppl-tools">
          <span className="err-label">Guests</span>
          <div className="ppl-pills" role="group" aria-label="Filter">
            {(
              [
                ["still", "Still guests"],
                ["signed", "Signed up"],
                ["all", "All"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" className="err-pill press" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {!rows ? (
          <p className="admin-empty ppl-pad" aria-busy="true">
            Loading…
          </p>
        ) : !rows.length ? (
          <p className="admin-empty ppl-pad">No guests here.</p>
        ) : (
          <>
            <div className="ppl-head ppl-ghead" aria-hidden="true">
              <span>Guest</span>
              <span>Started</span>
              <span>Came from</span>
              <span>Phone</span>
              <span className="ppl-n">Votes</span>
              <span>Last seen</span>
              <span>Now</span>
            </div>
            <ul className="ppl-rows">
              {rows.map((r) => {
                const [src, by] = sourceText(r);
                const [ph, phSub] = phoneText(r);
                const cells = (
                  <>
                    <span>
                      <b>Guest {r.code}</b>
                    </span>
                    <span className="ppl-cell">
                      <span className="ppl-k">Started </span>
                      {when(r.started)}
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
                    <span className="ppl-n">
                      <b>{r.votes}</b>
                      <span className="ppl-k"> votes</span>
                    </span>
                    <span className="ppl-cell">
                      <span className="ppl-k">Seen </span>
                      {ago(r.lastSeen)}
                    </span>
                    <span>
                      {r.signedUp ? <span className="ppl-chip ppl-on">Signed up as @{r.username}</span> : <span className="ppl-chip ppl-ask">Still a guest</span>}
                    </span>
                  </>
                );
                return (
                  <li key={r.id}>
                    {r.signedUp ? (
                      <button type="button" className="ppl-row ppl-grow" onClick={() => onOpenUser(r.id)}>
                        {cells}
                      </button>
                    ) : (
                      <div className="ppl-row ppl-grow ppl-static">{cells}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <p className="ppl-foot">
          <span>Guests are shown by a short code, never a name</span>
          <span>Click a guest who signed up to open their page</span>
        </p>
      </section>
    </div>
  );
}
