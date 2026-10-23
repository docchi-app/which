"use client";

import { useEffect, useState } from "react";
import {
  getPushKinds,
  isPushOn,
  pushSupport,
  sendTestPush,
  setPushKinds,
  turnOffPush,
  turnOnPush,
  type PushKinds,
  type PushSupport,
} from "@/lib/push";

const KINDS: { id: keyof PushKinds; label: string; hint: string }[] = [
  { id: "votes", label: "Votes on my polls", hint: "At 10, 25, 50, 100…" },
  { id: "circle", label: "Circle", hint: "Requests, yeses and circle polls" },
  { id: "results", label: "Results", hint: "When a poll you voted on closes" },
  { id: "daily", label: "Poll of the Day", hint: "Once a day, 9am" },
];

type State = "loading" | "off" | "on" | "denied";

/** Profile → turn phone notifications on/off and pick what they're for. */
export function NotificationsCard() {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [state, setState] = useState<State>("loading");
  const [kinds, setKinds] = useState<PushKinds | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const s = pushSupport();
    // Reading browser capabilities can only happen after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupport(s);
    if (s !== "ready") return;
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    isPushOn().then((on) => setState(on ? "on" : "off"));
  }, []);

  useEffect(() => {
    if (state === "on" && open && !kinds) getPushKinds().then(setKinds).catch(() => {});
  }, [state, open, kinds]);

  if (!support || support === "off") return null;

  async function on() {
    setBusy(true);
    setNote(null);
    try {
      const r = await turnOnPush();
      setState(r === "on" ? "on" : "denied");
      if (r === "on") {
        setOpen(true);
        const t = await sendTestPush();
        setNote(t === "sent" ? "Sent you a test. Check your notifications." : null);
      }
    } catch (e) {
      console.error(e);
      setNote("Couldn't turn them on. Try again?");
    } finally {
      setBusy(false);
    }
  }

  async function off() {
    setBusy(true);
    try {
      await turnOffPush();
      setState("off");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: keyof PushKinds) {
    if (!kinds) return;
    const next = { ...kinds, [id]: !kinds[id] };
    setKinds(next);
    try {
      await setPushKinds(next);
    } catch {
      setKinds(kinds);
      setNote("Couldn't save that. Try again?");
    }
  }

  async function test() {
    setBusy(true);
    const r = await sendTestPush();
    setNote(r === "sent" ? "Sent! Check your notifications." : r === "too_many" ? "That's enough tests for now." : "Couldn't send a test.");
    setBusy(false);
  }

  return (
    <section className="notif-card" aria-labelledby="notif-title">
      <div className="notif-top">
        <span className="notif-bell" aria-hidden="true">
          <BellIcon />
        </span>
        <div className="notif-copy">
          <h2 id="notif-title" className="notif-title">
            Notifications {state === "on" && <span className="chip chip-small chip-mint">On</span>}
          </h2>
          <p className="notif-text">
            {support === "install"
              ? "On iPhone, add Docchi to your Home Screen first: tap Share, then “Add to Home Screen”. Open it from there and turn these on."
              : support === "unsupported"
                ? "This browser can't show notifications. Try Chrome, or Safari on iPhone from the Home Screen."
                : state === "denied"
                  ? "Notifications are blocked for Docchi. Allow them in your browser or phone settings, then come back."
                  : state === "on"
                    ? "We'll tap you when your poll takes off, your circle moves, or results land."
                    : "Know when your poll takes off, your circle moves, or results are in."}
          </p>
        </div>
      </div>

      {support === "ready" && state === "off" && (
        <button type="button" className="post-btn press" onClick={on} disabled={busy}>
          {busy ? "Turning on…" : "Turn on notifications"}
        </button>
      )}

      {state === "on" && (
        <button type="button" className="notif-manage" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Done" : "Choose what you get"}
        </button>
      )}

      {state === "on" && open && (
        <div className="notif-kinds">
          {KINDS.map((k) => (
            <label key={k.id} className="notif-kind">
              <span>
                <strong>{k.label}</strong>
                <span className="notif-hint">{k.hint}</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={kinds?.[k.id] ?? true}
                disabled={!kinds}
                onChange={() => toggle(k.id)}
              />
            </label>
          ))}
          <p className="notif-hint">Quiet from 11pm to 8am, and never more than 8 a day.</p>
          <div className="notif-actions">
            <button type="button" className="mini-btn" onClick={test} disabled={busy}>
              Send me a test
            </button>
            <button type="button" className="mini-btn mini-btn-danger-text" onClick={off} disabled={busy}>
              Turn off on this phone
            </button>
          </div>
        </div>
      )}

      {note && (
        <p className="notif-note" role="status">
          {note}
        </p>
      )}
    </section>
  );
}

function BellIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" />
      <path d="M10 20a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}
