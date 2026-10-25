"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { installPlatform } from "@/lib/install";
import {
  getPushKinds,
  isPushOn,
  pushSupport,
  sendTestPush,
  setPushKinds,
  type TestResult,
  turnOffPush,
  turnOnPush,
  type PushKinds,
  type PushSupport,
} from "@/lib/push";
import { InstallSheet } from "./InstallSheet";

const KINDS: { id: keyof PushKinds; label: string; hint: string }[] = [
  { id: "votes", label: "Votes on my polls", hint: "At 10, 25, 50, 100…" },
  { id: "comments", label: "Comments on my polls", hint: "A few at a time, not every one" },
  { id: "props", label: "Friends gave me props", hint: "💜 Anonymous: never who" },
  { id: "circle", label: "Friends", hint: "Friend requests, new friends and friends-only polls" },
  { id: "results", label: "Results", hint: "When a poll you voted on closes" },
  { id: "daily", label: "Poll of the Day", hint: "Once a day, 9am" },
];

type State = "loading" | "off" | "on" | "denied";

/** What to say when the test doesn't arrive. The setup hints are for whoever runs Docchi. */
const TEST_TEXT: Record<TestResult, string> = {
  sent: "Sent! Check your notifications.",
  too_many: "That's enough tests for now. Try again in an hour.",
  secret_mismatch: "Push isn't connected yet: the secret in Supabase doesn't match PUSH_CRON_SECRET in Vercel. Run schedule_push again with the Vercel value.",
  no_migration: "Push isn't set up in the database yet (run the push migration).",
  send_failed: "The push service refused it. Check VAPID_PRIVATE_KEY and NEXT_PUBLIC_VAPID_PUBLIC_KEY in Vercel are the same pair, then redeploy.",
  no_device: "This phone isn't registered anymore. Turn notifications off and on again.",
  not_configured: "Push isn't set up on the server yet.",
  failed: "Couldn't send a test. Try again?",
};

const HIDE_KEY = "docchi.notifPromptHidden";
const SENT_NOTE = "Sent you a test. Check your notifications.";

/** This device's push state, and turning it on. Shared by the Profile prompt and Settings. */
function usePush() {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [state, setState] = useState<State>("loading");
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

  async function on(): Promise<boolean> {
    setBusy(true);
    setNote(null);
    try {
      const r = await turnOnPush();
      setState(r === "on" ? "on" : "denied");
      if (r !== "on") return false;
      const t = await sendTestPush();
      setNote(t.result === "sent" ? SENT_NOTE : TEST_TEXT[t.result]);
      return true;
    } catch (e) {
      console.error(e);
      setNote("Couldn't turn them on. Try again?");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { support, state, setState, busy, setBusy, note, setNote, on };
}

function statusText(support: PushSupport, state: State) {
  if (support === "install") {
    return installPlatform() === "in-app"
      ? "Open Docchi in your browser first, then turn these on there."
      : "On iPhone, add Docchi to your Home Screen first. Then open it from there and turn these on.";
  }
  if (support === "unsupported") return "This browser can't show notifications. Try Chrome, or Safari on iPhone from the Home Screen.";
  if (state === "denied") return "Notifications are blocked for Docchi. Allow them in your browser or phone settings, then come back.";
  if (state === "on") return "We'll tap you when your poll takes off, friends add you, or results land.";
  return "Know when your poll takes off, friends add you, or results are in.";
}

/**
 * A slim "turn on notifications" row, only while they're off on this phone:
 * on Profile, and on a poll you just posted (with its own pitch). ✕ hides it
 * for a month; once they're on, it says so and goes away.
 */
export function NotificationPrompt({ pitch }: { pitch?: ReactNode } = {}) {
  const { support, state, busy, note, on } = usePush();
  const [hidden, setHidden] = useState(true);
  const [justOn, setJustOn] = useState(false);
  const [howTo, setHowTo] = useState(false);

  useEffect(() => {
    let until = 0;
    try {
      until = Number(localStorage.getItem(HIDE_KEY) ?? 0);
    } catch {
      // Show it.
    }
    // localStorage is only readable after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHidden(until > Date.now());
  }, []);

  useEffect(() => {
    if (!justOn) return;
    const t = window.setTimeout(() => setJustOn(false), 6000);
    return () => window.clearTimeout(t);
  }, [justOn]);

  function hide() {
    try {
      localStorage.setItem(HIDE_KEY, String(Date.now() + 30 * 864e5));
    } catch {
      // Hidden for this visit only.
    }
    setHidden(true);
  }

  if (justOn) {
    return (
      <div className="notif-prompt notif-prompt-done" role="status">
        <span className="notif-prompt-text">
          {!note || note === SENT_NOTE ? (
            <>
              <strong>You&apos;re all set ✓</strong> {note ?? ""} Change what you get in <Link href="/settings">Settings</Link>.
            </>
          ) : (
            <>
              <strong>Turned on, but the test didn&apos;t arrive.</strong> {note}
            </>
          )}
        </span>
      </div>
    );
  }
  const wanted = support === "install" || (support === "ready" && state === "off");
  if (!support || hidden || !wanted) return null;

  return (
    <div className="notif-prompt">
      <span className="notif-bell" aria-hidden="true">
        <BellIcon />
      </span>
      <span className="notif-prompt-text">
        {pitch ?? (
          <>
            <strong>Get notified</strong> when your poll takes off or results land.
          </>
        )}
      </span>
      {support === "install" ? (
        <button type="button" className="mini-btn mini-btn-coral" onClick={() => setHowTo(true)}>
          How?
        </button>
      ) : (
        <button
          type="button"
          className="mini-btn mini-btn-coral"
          disabled={busy}
          onClick={async () => setJustOn(await on())}
        >
          {busy ? "…" : "Turn on"}
        </button>
      )}
      <button type="button" className="notif-prompt-x" aria-label="Hide for now" onClick={hide}>
        ✕
      </button>
      {howTo && <InstallSheet reason="notifications" onClose={() => setHowTo(false)} />}
    </div>
  );
}

/** Settings → Notifications: turn on/off, pick kinds, send a test. */
export function NotificationSettings() {
  const { support, state, setState, busy, setBusy, note, setNote, on } = usePush();
  const [kinds, setKinds] = useState<PushKinds | null>(null);
  const [howTo, setHowTo] = useState(false);

  useEffect(() => {
    if (state === "on" && !kinds) getPushKinds().then(setKinds).catch(() => {});
  }, [state, kinds]);

  if (!support || support === "off") return null;

  async function off() {
    setBusy(true);
    try {
      await turnOffPush();
      setState("off");
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
    setNote(TEST_TEXT[r.result] + (r.detail ? ` (${r.detail})` : ""));
    setBusy(false);
  }

  return (
    <section className="settings-group" aria-labelledby="notif-title">
      <h2 id="notif-title" className="settings-heading">
        Notifications {state === "on" && <span className="chip chip-small chip-mint">On</span>}
      </h2>
      <div className="settings-card">
        <p className="notif-text">{statusText(support, state)}</p>

        {support === "install" && (
          <button type="button" className="post-btn press" onClick={() => setHowTo(true)}>
            Show me how
          </button>
        )}
        {howTo && <InstallSheet reason="notifications" onClose={() => setHowTo(false)} />}

        {support === "ready" && state === "off" && (
          <button type="button" className="post-btn press" onClick={on} disabled={busy}>
            {busy ? "Turning on…" : "Turn on notifications"}
          </button>
        )}

        {state === "on" && (
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
      </div>
    </section>
  );
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" />
      <path d="M10 20a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}
