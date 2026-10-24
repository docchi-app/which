"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { continueWithGoogle, saveReturnTo } from "@/lib/auth";
import { deleteComment, fetchThread, postComment, type Thread } from "@/lib/comments";
import { useLiveInterval } from "@/lib/useLiveInterval";
import { Avatar } from "./Avatar";
import { ReportSheet } from "./ReportSheet";

const MAX = 200;
const REFRESH_MS = 8000;

type Props = {
  pollId: string;
  /** Answer colours for this poll, so each pick chip matches its answer. */
  colors: string[];
  /** false: signed out (or a guest) · null: not known yet */
  signedIn: boolean | null;
  onClose: () => void;
  /** The number of live comments changed. */
  onCount: (n: number) => void;
};

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

/** A poll's comments: the conversation, the write box, delete and report. */
export function CommentsSheet({ pollId, colors, signedIn, onClose, onCount }: Props) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const onCountRef = useRef(onCount);
  useEffect(() => {
    onCountRef.current = onCount;
  });

  const load = useCallback(async () => {
    try {
      const t = await fetchThread(pollId);
      setThread(t);
      if (t.canRead) onCountRef.current(t.comments.length);
    } catch {
      setThread((t) => t ?? { canRead: false, why: "not_found" });
    }
  }, [pollId]);

  useEffect(() => {
    // Fetching when the sheet opens is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load, onClose]);

  useLiveInterval(load, REFRESH_MS, Boolean(thread?.canRead));

  // Keep the newest comment in view unless the reader has scrolled up.
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [thread]);

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    try {
      await postComment(pollId, t);
      setText("");
      stick.current = true;
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await deleteComment(id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function signIn() {
    saveReturnTo(window.location.pathname);
    try {
      await continueWithGoogle();
    } catch {
      setError("Google sign-in isn't available right now.");
    }
  }

  const count = thread?.canRead ? thread.comments.length : null;

  return createPortal(
    <div className="sheet-layer">
      <div className="sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <section role="dialog" aria-modal="true" aria-labelledby="comments-title" className="sheet comments-sheet">
        <div className="sheet-handle" aria-hidden="true" />
        <header className="comments-head">
          <h2 id="comments-title" className="comments-title">
            Comments{count ? <span className="comments-count">{count}</span> : null}
          </h2>
          <span className="comments-note">Gone after 24h</span>
          <button type="button" className="notif-prompt-x" aria-label="Close comments" onClick={onClose}>
            ✕
          </button>
        </header>

        {!thread ? (
          <p className="comments-empty" aria-busy="true">
            Loading…
          </p>
        ) : !thread.canRead ? (
          <div className="comments-locked">
            {thread.why === "vote_first" ? (
              <>
                <p className="comments-empty">
                  <span aria-hidden="true">👀</span> Vote first, then see what everyone&apos;s saying.
                </p>
                <button type="button" className="post-btn press" onClick={onClose}>
                  Back to the poll
                </button>
              </>
            ) : thread.why === "sign_in" ? (
              <>
                <p className="comments-empty">Sign in and vote to join the conversation.</p>
                <button type="button" className="sheet-btn sheet-btn-google press" onClick={signIn}>
                  Continue with Google
                </button>
              </>
            ) : (
              <p className="comments-empty">Comments aren&apos;t available for this poll.</p>
            )}
          </div>
        ) : (
          <>
            <ol
              ref={listRef}
              className="comments-list"
              onScroll={(e) => {
                const el = e.currentTarget;
                stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
              }}
            >
              {thread.comments.length === 0 && (
                <li className="comments-empty">{thread.canPost ? "No comments yet. Start it off!" : "No comments."}</li>
              )}
              {thread.comments.map((c) => (
                <li key={c.id} className="comment" data-mine={c.isMine || undefined}>
                  <Avatar name={c.username} url={c.avatarUrl} size={34} />
                  <div className="comment-body">
                    <div className="comment-meta">
                      <Link href={`/u/${c.username}`} className="comment-name">
                        @{c.username}
                      </Link>
                      {c.isCreator && <span className="chip chip-small chip-white">Creator</span>}
                      {c.pick && (
                        <span className="comment-pick" style={{ background: colors[c.pickIndex ?? 0] ?? "var(--line)" }}>
                          {c.pick}
                        </span>
                      )}
                      <span className="comment-time">{ago(c.createdAt)}</span>
                    </div>
                    <p className="comment-text">{c.text}</p>
                    <div className="comment-actions">
                      {c.canDelete && (
                        <button type="button" className="comment-action" onClick={() => remove(c.id)}>
                          Delete
                        </button>
                      )}
                      {!c.isMine && (
                        <button type="button" className="comment-action" onClick={() => setReporting(c.id)}>
                          Report
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>

            {thread.canPost ? (
              <form
                className="comment-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
              >
                <textarea
                  className="comment-input"
                  rows={1}
                  maxLength={MAX}
                  placeholder="Say something nice…"
                  aria-label="Write a comment"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
                <button type="submit" className="comment-send press" disabled={busy || !text.trim()} aria-label="Send comment">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
                {text.length > MAX - 30 && <span className="comment-left">{MAX - text.length}</span>}
              </form>
            ) : (
              <p className="comments-note comments-closed">
                {thread.closed ? "This poll has closed, so comments are read-only." : signedIn === false ? "Sign in to comment." : "You can't comment right now."}
              </p>
            )}
          </>
        )}
        {error && (
          <p className="poll-error" role="alert">
            {error}
          </p>
        )}
      </section>
      {reporting && (
        <ReportSheet
          target={{ kind: "comment", commentId: reporting }}
          canReport={signedIn}
          onClose={() => setReporting(null)}
          onReported={load}
        />
      )}
    </div>,
    document.body,
  );
}
