"use client";

import { useEffect, useRef, useState } from "react";
import { cardInput, pollUrl, recordShare, shareText, warmShareCard, type ShareChannel } from "@/lib/share";
import type { Poll } from "@/lib/types";
import { ShareIcon } from "./icons";
import { SharePreview } from "./SharePreview";

type Props = { poll: Poll; onClose: () => void };

/** "Challenge a friend": WhatsApp, X, the phone's share menu, or copy the link. */
export function ShareSheet({ poll, onClose }: Props) {
  const firstRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const [canNativeShare] = useState(() => typeof navigator !== "undefined" && "share" in navigator);
  const voted = poll.myOptionId !== null;
  // Your own poll that nobody has voted on yet: it was just posted.
  const fresh = poll.isMine && poll.voteCount === 0;
  // Link only: the link is the only way in, so the sheet says so.
  const linkOnly = poll.isMine && poll.visibility === "link";
  const text = shareText(poll);

  useEffect(() => {
    // Have the link preview ready before a friend's WhatsApp asks for it.
    warmShareCard(poll.id);
  }, [poll.id]);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function open(channel: ShareChannel, href: string) {
    recordShare(poll.id, channel);
    window.open(href, "_blank", "noopener,noreferrer");
  }

  async function native() {
    try {
      await navigator.share({ title: poll.question ?? poll.teaser ?? "Eithr", text, url: pollUrl(poll.id, "native") });
      recordShare(poll.id, "native");
    } catch {
      // Share menu dismissed.
    }
  }

  async function copy() {
    const url = pollUrl(poll.id, "copy");
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link", url);
    }
    recordShare(poll.id, "copy");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="sheet-layer">
      <div className="sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <section role="dialog" aria-modal="true" aria-labelledby="share-title" className="sheet share-sheet">
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="share-title" className="sheet-title">
          {linkOnly && fresh
            ? "Send it to someone"
            : fresh
              ? "Your poll is live 🎉"
              : voted || poll.kind === "hot_take"
                ? "Challenge a friend"
                : "Share this poll"}
        </h2>
        <p className="sheet-text">
          {linkOnly
            ? "Only people with this link can see it and vote."
            : fresh
              ? "Drop it in the group chat. Friends vote to see the results."
              : "Friends see the question, not the result. They vote to find out."}
        </p>

        {/* The same card WhatsApp and X will show, drawn here so it's instant. */}
        <SharePreview card={cardInput(poll)} />

        <div className="share-grid">
          <button
            ref={firstRef}
            type="button"
            className="share-btn share-btn-whatsapp press"
            onClick={() => open("whatsapp", `https://wa.me/?text=${encodeURIComponent(`${text} ${pollUrl(poll.id, "whatsapp")}`)}`)}
          >
            <WhatsAppIcon />
            WhatsApp
          </button>
          <button
            type="button"
            className="share-btn press"
            onClick={() =>
              open(
                "x",
                `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(pollUrl(poll.id, "x"))}`,
              )
            }
          >
            <XIcon />
            Post on X
          </button>
          {canNativeShare && (
            <button type="button" className="share-btn press" onClick={native}>
              <ShareIcon />
              More apps
            </button>
          )}
          <button type="button" className="share-btn press" onClick={copy} aria-live="polite">
            <LinkIcon />
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>

        <button type="button" className="sheet-later" onClick={onClose}>
          Done
        </button>
      </section>
    </div>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.4z" />
      <path d="M9 9.5c.3 2 2.5 4.3 5 5l1.2-1.3 2 1-.6 1.6c-3.5.3-7.6-3.6-7.8-7l1.5-.7 1 2z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4l16 16M20 4L4 20" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" />
    </svg>
  );
}
