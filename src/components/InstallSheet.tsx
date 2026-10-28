"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { randomTagline } from "@/lib/brand";
import {
  canPromptInstall,
  installPlatform,
  onInstallChange,
  promptInstall,
  snoozeInstall,
  type InstallPlatform,
} from "@/lib/install";
import { useBackClose } from "@/lib/back";
import type { AskMoment } from "@/lib/asks";

type Props = {
  /**
   * notifications: from the notifications prompt or settings · nudge: after a few votes ·
   * app: Settings → The app · posted / props / friend: a moment worth hearing about again (MomentAsk).
   */
  reason: "notifications" | "nudge" | "app" | AskMoment;
  onClose: () => void;
};

const IN_APP_NAMES: [RegExp, string][] = [
  [/Instagram/i, "Instagram"],
  [/FBAN|FBAV|FB_IAB|FBIOS/i, "Facebook"],
  [/WhatsApp/i, "WhatsApp"],
  [/Snapchat/i, "Snapchat"],
  [/LinkedInApp/i, "LinkedIn"],
];

/** Step-by-step help to put Eithr on the Home Screen (iPhone, Android, or from inside another app). */
export function InstallSheet({ reason, onClose }: Props) {
  const [platform] = useState<InstallPlatform>(() => installPlatform());
  const [canPrompt, setCanPrompt] = useState(canPromptInstall);
  const [copied, setCopied] = useState(false);
  // A different tagline each time the sheet opens.
  const [tagline] = useState(randomTagline);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const iphone = /iPad|iPhone|iPod/.test(ua) || platform === "ios";
  // Safari keeps Share in the bottom bar; Chrome/Firefox/Edge on iPhone put it at the top.
  const otherIosBrowser = /CriOS|FxiOS|EdgiOS/.test(ua);
  const host = IN_APP_NAMES.find(([re]) => re.test(ua))?.[1] ?? "this app";
  // The back button counts as "later".
  const dismiss = useBackClose(true, later);

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    window.addEventListener("keydown", onKey);
    const off = onInstallChange(() => setCanPrompt(canPromptInstall()));
    return () => {
      window.removeEventListener("keydown", onKey);
      off();
    };
    // dismiss() only snoozes and closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function later() {
    if (reason === "nudge") snoozeInstall(7);
    onClose();
  }

  async function install() {
    const accepted = await promptInstall();
    if (accepted) dismiss();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const homeScreen = iphone
    ? "iPhone only sends notifications to apps on your Home Screen. It takes 10 seconds:"
    : "Notifications need Eithr in a real browser. It takes 10 seconds:";
  const why =
    reason === "notifications"
      ? homeScreen
      : reason === "posted"
        ? `Want to know the moment friends vote? ${homeScreen}`
        : reason === "props"
          ? `💜 Someone picked you! Hear about the next one. ${homeScreen}`
          : reason === "friend"
            ? `Hear when your friends post or pick you. ${homeScreen}`
            : "Open it with one tap, full screen, and get told when your polls take off.";

  const arrow = platform === "ios" ? (otherIosBrowser ? "top" : "bottom") : platform === "android" && !canPrompt ? "top" : null;

  return createPortal(
    <div className="sheet-layer">
      <div className="sheet-backdrop" aria-hidden="true" onClick={dismiss} />
      {arrow === "top" && (
        <div className="install-arrow install-arrow-top" aria-hidden="true">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4v15M5 12l7 7 7-7" />
          </svg>
          <span>{platform === "ios" ? "Share is up here" : "Menu is up here"}</span>
        </div>
      )}
      <section role="dialog" aria-modal="true" aria-labelledby="install-title" className="sheet install-sheet">
        <div className="sheet-handle" aria-hidden="true" />
        <div className="install-icon" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" width={64} height={64} />
        </div>
        <p className="install-tagline">{tagline}</p>
        <h2 id="install-title" ref={titleRef} tabIndex={-1} className="sheet-title">
          {platform === "in-app" ? "Open Eithr in your browser" : platform === "android" ? "Get the Eithr app" : "Add Eithr to your Home Screen"}
        </h2>
        <p className="sheet-text">
          {platform === "in-app"
            ? `You're in ${host}'s built-in browser, which can't add apps or send notifications.`
            : why}
        </p>

        {platform === "ios" && (
          <ol className="install-steps">
            <li>
              <span className="install-step-icon">
                <ShareIcon />
              </span>
              <span>
                Tap <strong>Share</strong> {otherIosBrowser ? "at the top of the screen" : "in Safari's bar at the bottom"}
                {!otherIosBrowser && (
                  <small>
                    On newer iPhones it&apos;s inside the <strong>⋯</strong> button.
                  </small>
                )}
              </span>
            </li>
            <li>
              <span className="install-step-icon">
                <PlusSquareIcon />
              </span>
              <span>
                Scroll down and tap <strong>Add to Home Screen</strong>
              </span>
            </li>
            <li>
              <span className="install-step-icon install-step-logo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/icon-192.png" alt="" width={28} height={28} />
              </span>
              <span>
                Tap <strong>Add</strong>, then open <strong>Eithr</strong> from your Home Screen
                {reason === "notifications" && <small>Then Profile → Turn on.</small>}
              </span>
            </li>
          </ol>
        )}

        {platform === "android" &&
          (canPrompt ? (
            <button type="button" className="post-btn press" onClick={install}>
              Install Eithr
            </button>
          ) : (
            <ol className="install-steps">
              <li>
                <span className="install-step-icon">
                  <DotsIcon />
                </span>
                <span>
                  Tap <strong>⋮</strong> at the top right of Chrome
                </span>
              </li>
              <li>
                <span className="install-step-icon">
                  <PlusSquareIcon />
                </span>
                <span>
                  Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>
                </span>
              </li>
            </ol>
          ))}

        {platform === "in-app" && (
          <>
            <ol className="install-steps">
              <li>
                <span className="install-step-icon">
                  <DotsIcon />
                </span>
                <span>
                  Tap <strong>⋯</strong> or <strong>⋮</strong> at the top of the screen
                </span>
              </li>
              <li>
                <span className="install-step-icon">
                  <OpenIcon />
                </span>
                <span>
                  Tap <strong>{iphone ? "Open in Safari" : "Open in Chrome"}</strong> (or “Open in browser”)
                </span>
              </li>
            </ol>
            <button type="button" className="post-btn post-btn-light press" onClick={copyLink}>
              {copied ? "Link copied. Paste it in your browser" : "Or copy the link"}
            </button>
          </>
        )}

        <button type="button" className="sheet-later" onClick={dismiss}>
          {reason === "notifications" || reason === "app" ? "Close" : "Not now"}
        </button>
        {arrow === "bottom" && (
          <div className="install-arrow-bottom" aria-hidden="true">
            <span>Share is down here</span>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 4v15M5 12l7 7 7-7" />
            </svg>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}

const icon = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function ShareIcon() {
  return (
    <svg {...icon}>
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" />
      <path d="M8 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-2" />
    </svg>
  );
}

function PlusSquareIcon() {
  return (
    <svg {...icon}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg {...icon} fill="currentColor" stroke="none">
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg {...icon}>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </svg>
  );
}
