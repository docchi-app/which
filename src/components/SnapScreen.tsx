"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { continueWithGoogle, isSignedIn, onUserChange, saveReturnTo } from "@/lib/auth";
import {
  checkSnap,
  postSnap,
  SNAP_TEMPLATES,
  snapErrorText,
  snapInfo,
  type SnapAudience,
  type SnapStatus,
  type SnapTemplate,
} from "@/lib/snap";
import { isSupabaseConfigured } from "@/lib/supabase";
import { SignInNote } from "./SignInSheet";

type Phase = "pick" | "compose" | "checking" | "review" | "rejected";

/** /snap: take or pick a photo, choose a question and who sees it, send. Gone in 24 hours. */
export function SnapScreen() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(isSupabaseConfigured ? null : false);
  const [phase, setPhase] = useState<Phase>("pick");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [template, setTemplate] = useState<SnapTemplate>("rate");
  const [own, setOwn] = useState("");
  const [audience, setAudience] = useState<SnapAudience>("circle");
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    return onUserChange((user) => setSignedIn(isSignedIn(user)));
  }, []);

  // Free the preview when the photo changes or the screen closes.
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  function choose(file: File | undefined, fromCamera: boolean) {
    if (!file) return;
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
    setLive(fromCamera);
    setError(null);
    setPhase("compose");
  }

  const tpl = SNAP_TEMPLATES.find((t) => t.id === template)!;
  const question = template === "own" ? own.trim() : tpl.question;
  const ready = !!photo && (template !== "own" || question.length >= 3);

  async function send() {
    if (!photo || !ready) return;
    setError(null);
    setPhase("checking");
    try {
      const id = await postSnap({ photo, template, question: template === "own" ? question : undefined, audience, live });
      let status: SnapStatus = await checkSnap(id);
      // The check normally answers at once; give a slow one a little longer.
      for (let i = 0; status === "pending" && i < 8; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        status = (await snapInfo(id))?.status ?? "pending";
      }
      if (status === "live") router.push(`/?poll=${id}&created=1`);
      else setPhase(status === "rejected" ? "rejected" : "review");
    } catch (e) {
      setError(snapErrorText(e));
      setPhase("compose");
    }
  }

  async function signIn() {
    saveReturnTo("/snap");
    try {
      await continueWithGoogle();
    } catch {
      setError("Google sign-in isn't available right now. Try again in a bit.");
    }
  }

  const inputs = (
    <>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => choose(e.target.files?.[0], true)} />
      <input ref={galleryRef} type="file" accept="image/*" hidden onChange={(e) => choose(e.target.files?.[0], false)} />
    </>
  );

  return (
    <div className="create-screen snap-screen">
      <header className="create-header">
        <Link href="/" aria-label="Close" className="icon-btn icon-btn-white press">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </Link>
        <h1 className="create-title">Quick snap</h1>
        <span className="create-spacer" />
      </header>

      {signedIn === false ? (
        <section className="poll-card soon profile-signin snap-intro">
          <h2 className="poll-question">Snap it, ask your friends</h2>
          <p className="poll-foot-note">A photo poll that disappears in 24 hours. Sign in to send one.</p>
          {isSupabaseConfigured && (
            <>
              <button type="button" className="post-btn post-btn-dark press" onClick={signIn}>
                Sign in with Google
              </button>
              <SignInNote />
            </>
          )}
        </section>
      ) : phase === "pick" ? (
        <section className="snap-pick">
          {inputs}
          <p className="snap-pitch">
            <strong>Snap it, ask your friends.</strong> A photo poll that disappears in 24 hours.
          </p>
          <button type="button" className="snap-big-btn snap-big-camera press" onClick={() => cameraRef.current?.click()}>
            <span aria-hidden="true">📸</span>
            Take a photo
          </button>
          <button type="button" className="snap-big-btn press" onClick={() => galleryRef.current?.click()}>
            <span aria-hidden="true">🖼️</span>
            Choose from gallery
          </button>
          <p className="create-note">Photos are shrunk on your phone (about 60–100 KB), location data removed, and checked before anyone sees them.</p>
        </section>
      ) : phase === "compose" ? (
        <div className="create-form snap-compose">
          {inputs}
          <div className="snap-photo snap-preview">
            {/* A local preview of the photo being posted. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {preview && <img src={preview} alt="Your photo" />}
            {live && <span className="snap-live">📸 Live</span>}
            <span className="snap-question">{question || "Type your question"}</span>
          </div>
          <div className="snap-retake">
            <button type="button" className="mini-btn" onClick={() => cameraRef.current?.click()}>
              📸 Retake
            </button>
            <button type="button" className="mini-btn" onClick={() => galleryRef.current?.click()}>
              🖼️ Gallery
            </button>
          </div>

          <fieldset className="field">
            <legend className="field-label">Ask</legend>
            <div className="snap-templates" role="radiogroup" aria-label="Question">
              {SNAP_TEMPLATES.map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={template === t.id} className="snap-template press" onClick={() => setTemplate(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            {template === "own" && (
              <input
                className="answer-input"
                aria-label="Your question"
                maxLength={80}
                placeholder="Too much for a first date?"
                value={own}
                onChange={(e) => setOwn(e.target.value)}
                autoFocus
              />
            )}
            <span className="format-blurb">Answers: {tpl.answers.join("  ")}</span>
          </fieldset>

          <fieldset className="field">
            <legend className="field-label">Who sees it</legend>
            <div className="snap-audience">
              <button type="button" className="snap-aud press" aria-pressed={audience === "circle"} onClick={() => setAudience("circle")}>
                <strong>👥 Friends</strong>
                <span>They see who voted what</span>
              </button>
              <button type="button" className="snap-aud press" aria-pressed={audience === "public"} onClick={() => setAudience("public")}>
                <strong>🌍 Everyone</strong>
                <span>Counts only, extra safety check</span>
              </button>
            </div>
          </fieldset>
        </div>
      ) : phase === "checking" ? (
        <section className="check-card" role="status">
          <span className="chip chip-white">🛡️ Safety check</span>
          <h2 className="poll-question">Checking your photo…</h2>
          <div className="check-bar" aria-hidden="true">
            <span />
          </div>
          <p className="poll-foot-note">Usually a few seconds.</p>
        </section>
      ) : phase === "review" ? (
        <section className="check-card check-review" role="status">
          <span className="chip chip-sun">⏳ Quick review</span>
          <h2 className="poll-question">Your snap is waiting for a quick review.</h2>
          <p className="poll-foot-note">A person will check it soon. If it&apos;s fine, it goes live; you&apos;ll find it in your feed.</p>
          <Link href="/" className="btn btn-coral press">
            Back to the feed
          </Link>
        </section>
      ) : (
        <section className="check-card check-rejected" role="alert">
          <span className="chip">🚫 Not posted</span>
          <h2 className="poll-question">This photo can&apos;t be posted.</h2>
          <p className="poll-foot-note">
            It may break the <Link href="/guidelines">community guidelines</Link>. Try another photo.
          </p>
          <button
            type="button"
            className="btn btn-coral press"
            onClick={() => {
              setPhoto(null);
              setPhase("pick");
            }}
          >
            Try another photo
          </button>
        </section>
      )}

      {phase === "compose" && (
        <div className="create-footer">
          {error && (
            <p className="poll-error" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="post-btn press" onClick={send} disabled={!ready}>
            Send snap →
          </button>
          <p className="create-note">⏳ Gone in 24 hours · 3 snaps a day</p>
        </div>
      )}
      {phase === "pick" && error && (
        <p className="poll-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
