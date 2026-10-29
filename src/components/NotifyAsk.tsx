"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { AskMoment } from "@/lib/asks";
import { isIPhoneLike } from "@/lib/install";
import { turnOnPush } from "@/lib/push";
import { useBackClose } from "@/lib/back";

const PITCH: Record<AskMoment | "first", { title: string; text: string }> = {
  first: { title: "Don't miss what your friends say", text: "Eithr tells you when something's waiting for you:" },
  posted: { title: "Know the moment friends vote 🗳️", text: "Get a notification when votes come in on your poll." },
  props: { title: "💜 Someone picked you!", text: "Get told the next time a friend gives you props (never who)." },
  friend: { title: "You've got a new friend 👥", text: "Get told when friends post a poll, or pick you for props." },
};

const REASONS = [
  ["🗳️", "Votes on your polls"],
  ["💜", "Props from friends, never who"],
  ["👥", "Friend requests"],
  ["📊", "The Poll of the Day"],
];

/**
 * "Turn on notifications", with a reason. The button asks the phone straight from the tap,
 * which is the only way iPhone shows its "Allow" box. Full screen the first time Eithr is
 * opened from the Home Screen; a sheet at the moments after that.
 */
export function NotifyAsk({ moment, onClose }: { moment: AskMoment | "first"; onClose: () => void }) {
  const [state, setState] = useState<"ask" | "busy" | "on" | "denied" | "failed">("ask");
  const close = useBackClose(true, onClose);
  const full = moment === "first";
  const pitch = PITCH[moment];

  async function on() {
    setState("busy");
    try {
      const r = await turnOnPush();
      setState(r);
      if (r === "on") window.setTimeout(close, 1400);
    } catch {
      setState("failed");
    }
  }

  return createPortal(
    <div className={full ? "notify-ask-full" : "sheet-layer"}>
      {!full && <div className="sheet-backdrop" aria-hidden="true" onClick={close} />}
      <section role="dialog" aria-modal="true" aria-labelledby="notify-ask-title" className={full ? "notify-ask notify-ask-page" : "sheet notify-ask"}>
        {!full && <div className="sheet-handle" aria-hidden="true" />}
        <span className="notify-ask-bell" aria-hidden="true">
          🔔
        </span>
        <h2 id="notify-ask-title" className="sheet-title">
          {pitch.title}
        </h2>
        <p className="sheet-text">{pitch.text}</p>
        {full && (
          <ul className="notify-ask-reasons">
            {REASONS.map(([icon, text]) => (
              <li key={text}>
                <span aria-hidden="true">{icon}</span>
                {text}
              </li>
            ))}
          </ul>
        )}
        {state === "on" ? (
          <p className="notify-ask-done" role="status">
            ✓ You&apos;re all set
          </p>
        ) : state === "denied" ? (
          <p className="notify-ask-note" role="status">
            {isIPhoneLike()
              ? "Notifications are off for Eithr. To turn them on later: iPhone Settings → Notifications → Eithr."
              : "Notifications are blocked for Eithr. You can allow them in your phone's settings for Eithr."}
          </p>
        ) : state === "failed" ? (
          <p className="notify-ask-note" role="alert">
            Couldn&apos;t turn them on just now. Try again from Settings → Notifications.
          </p>
        ) : (
          <button type="button" className="post-btn press notify-ask-btn" onClick={on} disabled={state === "busy"}>
            {state === "busy" ? "Turning on…" : "Turn on notifications"}
          </button>
        )}
        <button type="button" className="sheet-later" onClick={close}>
          {state === "ask" || state === "busy" ? "Not now" : "Close"}
        </button>
      </section>
    </div>,
    document.body,
  );
}
