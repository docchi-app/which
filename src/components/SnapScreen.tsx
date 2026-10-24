"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { continueWithGoogle, isSignedIn, onUserChange, saveReturnTo } from "@/lib/auth";
import {
  checkSnap,
  postSnap,
  saveSnapPrefs,
  SNAP_TEMPLATES,
  snapErrorText,
  snapInfo,
  snapPrefs,
  type SnapAudience,
  type SnapStatus,
  type SnapTemplate,
} from "@/lib/snap";
import { drawFill, encode, isUpright, loadPhoto } from "@/lib/snap-photo";
import { isSupabaseConfigured } from "@/lib/supabase";
import { SignInNote } from "./SignInSheet";
import { SnapCamera } from "./SnapCamera";
import { SnapCardShell } from "./SnapCard";
import { SnapFramer } from "./SnapFramer";

type Phase = "camera" | "frame" | "preview" | "checking" | "review" | "rejected";

/**
 * /snap: the camera opens straight away (3:4, exactly the card), you pick the
 * question and who sees it on the camera, snap, check the preview, send.
 * Gallery photos that aren't upright get a quick "frame your photo" step.
 */
export function SnapScreen() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(isSupabaseConfigured ? null : false);
  const [phase, setPhase] = useState<Phase>("camera");
  const [template, setTemplate] = useState<SnapTemplate>("rate");
  const [audience, setAudience] = useState<SnapAudience>("circle");
  const [own, setOwn] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [framing, setFraming] = useState<{ bitmap: ImageBitmap; url: string; live: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    return onUserChange((user) => setSignedIn(isSignedIn(user)));
  }, []);

  // The last question and audience (localStorage, so after hydration).
  useEffect(() => {
    const p = snapPrefs();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTemplate(p.template);
    setAudience(p.audience);
  }, []);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  useEffect(() => () => void (framing && URL.revokeObjectURL(framing.url)), [framing]);

  function pickTemplate(t: SnapTemplate) {
    setTemplate(t);
    saveSnapPrefs(t, audience);
  }
  function pickAudience(a: SnapAudience) {
    setAudience(a);
    saveSnapPrefs(template, a);
  }

  function showPreview(blob: Blob, fromCamera: boolean) {
    setPhoto(blob);
    setPreview(URL.createObjectURL(blob));
    setLive(fromCamera);
    setError(null);
    setPhase("preview");
  }

  async function shot(frame: HTMLCanvasElement) {
    try {
      showPreview(await encode(frame), true);
    } catch (e) {
      setError(snapErrorText(e));
    }
  }

  async function picked(file: File, fromCamera: boolean) {
    setError(null);
    try {
      const bitmap = await loadPhoto(file);
      // Upright (3:4-ish): it fills the card as it is. Otherwise the person frames it.
      if (isUpright(bitmap.width, bitmap.height)) return showPreview(await encode(drawFill(bitmap)), fromCamera);
      setFraming({ bitmap, url: URL.createObjectURL(file), live: fromCamera });
      setPhase("frame");
    } catch (e) {
      console.error(e);
      setError(snapErrorText(e));
    }
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
      setPhase("preview");
    }
  }

  function retake() {
    setPhoto(null);
    setPhase("camera");
  }

  async function signIn() {
    saveReturnTo("/snap");
    try {
      await continueWithGoogle();
    } catch {
      setError("Google sign-in isn't available right now. Try again in a bit.");
    }
  }

  if (signedIn === false) {
    return (
      <div className="create-screen snap-screen">
        <SnapHeader title="Quick snap" />
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
          {error && (
            <p className="poll-error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
    );
  }

  if (phase === "camera") {
    return (
      <>
        <SnapCamera template={template} audience={audience} onTemplate={pickTemplate} onAudience={pickAudience} onShot={shot} onPick={picked} />
        {error && (
          <p className="poll-error cam-error" role="alert">
            {error}
          </p>
        )}
      </>
    );
  }

  if (phase === "frame" && framing) {
    return (
      <div className="create-screen snap-screen">
        <SnapHeader title="Frame your photo" />
        <SnapFramer
          bitmap={framing.bitmap}
          url={framing.url}
          onDone={(blob) => showPreview(blob, framing.live)}
          onCancel={() => setPhase("camera")}
        />
      </div>
    );
  }

  if (phase === "preview") {
    return (
      <div className="create-screen snap-screen">
        <SnapHeader
          title="Your snap"
          right={
            <button type="button" className="snap-retake-btn" onClick={retake}>
              Retake
            </button>
          }
        />
        <div className="snap-preview-wrap">
          <SnapCardShell src={preview} live={live} who="You" sub="⏳ Gone in 24 hours">
            <p className="snapc-q">{question || "Type your question below"}</p>
            <div className="snapc-answers">
              {tpl.answers.map((a) => (
                <span key={a} className={`snapc-answer${tpl.answers.length > 2 ? " snapc-emoji" : ""}`}>
                  {a}
                </span>
              ))}
            </div>
          </SnapCardShell>
        </div>
        <div className="snap-preview-controls">
          <div className="snap-templates" role="radiogroup" aria-label="Question">
            {SNAP_TEMPLATES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={template === t.id} className="snap-template press" onClick={() => pickTemplate(t.id)}>
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
          <div className="snap-seg" role="radiogroup" aria-label="Who sees it">
            <button type="button" role="radio" aria-checked={audience === "circle"} onClick={() => pickAudience("circle")}>
              👥 Friends <small>see who picked what</small>
            </button>
            <button type="button" role="radio" aria-checked={audience === "public"} onClick={() => pickAudience("public")}>
              🌍 Everyone <small>counts only</small>
            </button>
          </div>
        </div>
        <div className="create-footer">
          {error && (
            <p className="poll-error" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="post-btn press" onClick={send} disabled={!ready}>
            Send snap →
          </button>
          <p className="create-note">Checked for safety, live in seconds · 3 snaps a day</p>
        </div>
      </div>
    );
  }

  return (
    <div className="create-screen snap-screen">
      <SnapHeader title="Quick snap" />
      {phase === "checking" ? (
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
          <button type="button" className="btn btn-coral press" onClick={retake}>
            Try another photo
          </button>
        </section>
      )}
    </div>
  );
}

function SnapHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <header className="create-header">
      <Link href="/" aria-label="Close" className="icon-btn icon-btn-white press">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </Link>
      <h1 className="create-title">{title}</h1>
      {right ?? <span className="create-spacer" />}
    </header>
  );
}
