"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { continueWithGoogle, isSignedIn, onUserChange, saveReturnTo } from "@/lib/auth";
import {
  ANSWER_MAX,
  checkSnap,
  eitherOr,
  isEmojiAnswers,
  MAX_ANSWERS,
  postSnap,
  QUESTION_MAX,
  saveSnapPrefs,
  SNAP_IDEAS,
  snapErrorText,
  snapInfo,
  snapPrefs,
  YES_NO,
  type SnapAudience,
  type SnapIdea,
  type SnapStatus,
} from "@/lib/snap";
import { drawFill, encode, isUpright, loadPhoto } from "@/lib/snap-photo";
import { openingFeedOnPoll } from "@/lib/screen-cache";
import { getMyCircle } from "@/lib/circle";
import { isSupabaseConfigured } from "@/lib/supabase";
import { SignInNote } from "./SignInSheet";
import { SnapCamera } from "./SnapCamera";
import { SnapCardShell } from "./SnapCard";
import { SnapFramer } from "./SnapFramer";
import { dropLayer, leaveScreen, useBackClose } from "@/lib/back";

type Phase = "camera" | "frame" | "ask" | "checking" | "review" | "rejected";

const AUDIENCES: { id: SnapAudience; name: string; text: string; send: string }[] = [
  { id: "circle", name: "👥 Friends", text: "See who picked what", send: "Send to friends →" },
  { id: "public", name: "🌍 Everyone", text: "Counts only, names hidden", send: "Send to everyone →" },
  { id: "link", name: "🔗 Link only", text: "Only people you send it to", send: "Send and get the link →" },
];
const DAY = 864e5;

/**
 * /snap: Shoot → Ask → Send. The camera opens at once (3:4, exactly the card).
 * Then one page finishes it, scrolling like the feed: the photo on its own, the
 * question and its answers (last idea filled in), ideas, who sees it, and Send
 * pinned at the bottom. Link only opens the share sheet right after.
 */
export function SnapScreen() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(isSupabaseConfigured ? null : false);
  const [phase, setPhase] = useState<Phase>("camera");
  const [idea, setIdea] = useState<SnapIdea | null>("buy");
  const [question, setQuestion] = useState<string>(SNAP_IDEAS[0].question);
  const [answers, setAnswers] = useState<string[]>([...SNAP_IDEAS[0].answers]);
  // "How friends see it": the photo with the question and answers on it, as in the feed.
  const [look, setLook] = useState(false);
  const [audience, setAudience] = useState<SnapAudience>("circle");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [framing, setFraming] = useState<{ bitmap: ImageBitmap; url: string; live: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Who can't be picked yet: no friends, or an account under a day old (Everyone opens tomorrow).
  const [friends, setFriends] = useState<number | null>(null);
  const [tooNew, setTooNew] = useState(false);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const answersRef = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  // The photo uploading: percent done (null when not uploading), whether it's slow, and Cancel.
  const [upload, setUpload] = useState<number | null>(null);
  const [slowUp, setSlowUp] = useState(false);
  const cancelUp = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    return onUserChange((user) => {
      setSignedIn(isSignedIn(user));
      setTooNew(!!user && Date.now() - Date.parse(user.created_at) < DAY);
    });
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    getMyCircle()
      .then((c) => setFriends(c.members.length))
      .catch(() => {});
  }, [signedIn]);

  // The last idea and audience (localStorage, so after hydration).
  useEffect(() => {
    const p = snapPrefs();
    const last = SNAP_IDEAS.find((t) => t.id === p.idea)!;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIdea(last.id);
    setQuestion(last.question);
    setAnswers([...last.answers]);
    setAudience(p.audience);
  }, []);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  useEffect(() => () => void (framing && URL.revokeObjectURL(framing.url)), [framing]);

  function pickIdea(id: SnapIdea) {
    const t = SNAP_IDEAS.find((x) => x.id === id)!;
    setIdea(id);
    setQuestion(t.question);
    setAnswers([...t.answers]);
    setError(null);
  }

  function editQuestion(text: string) {
    const q = text.replace(/\n/g, " ").slice(0, QUESTION_MAX);
    // Your own question needs your own answers: typing over an idea, or clearing the
    // question, takes the answers away (picking an idea brings them back).
    if (idea || !q.trim()) setAnswers([]);
    setQuestion(q);
    setIdea(null);
    setError(null);
  }

  function editAnswer(i: number, text: string) {
    setAnswers((list) => list.map((a, n) => (n === i ? text.slice(0, ANSWER_MAX) : a)));
    setIdea(null);
  }

  function pickAnswers(list: readonly string[]) {
    setAnswers([...list]);
    setIdea(null);
  }

  /** One more answer box, with the keyboard on it (focused within the tap, so iPhone opens it). */
  function addAnswer() {
    flushSync(() => setAnswers((list) => [...list, ""]));
    answersRef.current?.querySelector<HTMLInputElement>(".ask-answer:last-of-type input")?.focus();
  }

  function pickAudience(a: SnapAudience) {
    setAudience(a);
    saveSnapPrefs({ audience: a });
  }

  function showPreview(blob: Blob, fromCamera: boolean) {
    setPhoto(blob);
    setPreview(URL.createObjectURL(blob));
    setLive(fromCamera);
    setError(null);
    setPhase("ask");
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
      setError("Couldn't open that photo. Try another one.");
    }
  }

  const q = question.trim().replace(/\s+/g, " ");
  const clean = answers.map((a) => a.trim());
  const problem = !q
    ? "Add a question"
    : q.length < 3
      ? "Type your question"
      : clean.length === 0
        ? "Add 2 answers"
        : clean.length === 1
          ? "Add one more answer"
          : clean.some((a) => !a)
            ? "Fill in every answer"
            : new Set(clean.map((a) => a.toLowerCase())).size < clean.length
              ? "Two answers are the same"
              : null;
  const blocked = (a: SnapAudience) => (a === "circle" && friends === 0) || (a === "public" && tooNew);
  // A remembered choice that can't be used yet becomes Link only (shown as picked).
  const sendTo: SnapAudience = blocked(audience) ? "link" : audience;
  const emoji = isEmojiAnswers(answers);
  // No answers yet for your own question: pairs to fill in with one tap ("Goa or Manali?" → Goa / Manali).
  const sides = eitherOr(q);
  const offers = answers.length === 0 && q ? [...(sides ? [sides] : []), YES_NO] : [];

  async function send() {
    if (!photo || problem || sending.current) return;
    sending.current = true;
    setError(null);
    // Sent: back no longer means "retake".
    dropLayer();
    setPhase("checking");
    setUpload(0);
    setSlowUp(false);
    cancelUp.current = new AbortController();
    const slowT = window.setTimeout(() => setSlowUp(true), 3000);
    try {
      const id = await postSnap({ photo, question: q, answers: clean, audience: sendTo, live, onProgress: setUpload, signal: cancelUp.current.signal }).finally(() => {
        window.clearTimeout(slowT);
        setUpload(null);
        setSlowUp(false);
      });
      if (idea) saveSnapPrefs({ idea });
      let status: SnapStatus = await checkSnap(id);
      // The check normally answers at once; give a slow one a little longer.
      for (let i = 0; status === "pending" && i < 8; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        status = (await snapInfo(id))?.status ?? "pending";
      }
      if (status === "live") {
        openingFeedOnPoll();
        // Replaces this screen: back from your snap doesn't return to the camera.
        router.replace(`/?poll=${id}&created=1`);
      } else setPhase(status === "rejected" ? "rejected" : "review");
    } catch (e) {
      setError(snapErrorText(e));
      setPhase("ask");
    }
    sending.current = false;
  }

  function retake() {
    setPhoto(null);
    setLook(false);
    setPhase("camera");
  }
  // After the photo, back goes back to the camera (not out of /snap).
  const backToCamera = useBackClose(phase === "frame" || phase === "ask", retake);

  // Is the on-screen keyboard up? (The visible screen is much shorter than it was.) While it is,
  // only the question and answers show, with the photo small in the top bar. When it goes away,
  // by Done, ‹, or the phone's own back/hide key, the whole page comes back. Nothing is focused
  // when the page opens: iPhone only brings the keyboard up for a tap, and the photo comes first.
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (phase !== "ask" || !vv) return;
    let full = vv.height;
    let width = vv.width;
    let up = false;
    const onResize = () => {
      // Turned the phone: start over.
      if (Math.abs(vv.width - width) > 40) {
        width = vv.width;
        full = vv.height;
      }
      full = Math.max(full, vv.height);
      const now = full - vv.height > 120;
      if (now === up) return;
      up = now;
      setKeyboard(now);
      const box = document.activeElement as HTMLElement | null;
      if (now) requestAnimationFrame(() => box?.scrollIntoView({ block: "center" }));
      else if (box?.closest(".ask-edit")) box.blur();
    };
    vv.addEventListener("resize", onResize);
    return () => {
      vv.removeEventListener("resize", onResize);
      setKeyboard(false);
    };
  }, [phase]);

  // Scrolled past the photo: it shows small in the top bar, so you still know what you're asking about.
  const photoRef = useRef<HTMLElement>(null);
  const [photoAway, setPhotoAway] = useState(false);
  useEffect(() => {
    const el = photoRef.current;
    if (phase !== "ask" || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setPhotoAway(!e.isIntersecting), { rootMargin: "-64px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [phase]);

  // The question box grows with the question (Safari has no field-sizing yet).
  useEffect(() => {
    const box = questionRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight + box.offsetHeight - box.clientHeight}px`;
  }, [question, phase, keyboard]);

  // A send that failed says why right under the question; bring it into view.
  useEffect(() => {
    if (phase === "ask" && error) document.querySelector(".ask-error")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [phase, error]);

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
        <SnapCamera onShot={shot} onPick={picked} />
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
          onCancel={backToCamera}
        />
      </div>
    );
  }

  if (phase === "ask") {
    // Keeps the keyboard on the box while a button next to it is tapped.
    const keep = (e: React.PointerEvent) => e.preventDefault();
    const stopTyping = () => (document.activeElement as HTMLElement | null)?.blur();
    const nextBox = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const boxes = [...(answersRef.current?.querySelectorAll<HTMLInputElement>(".ask-answer input") ?? [])];
      const next = boxes[boxes.indexOf(e.currentTarget) + 1];
      if (next) next.focus();
      else e.currentTarget.blur();
    };
    return (
      <div className="ask-screen">
        <div className="ask-top">
          <button
            type="button"
            className="cam-icon"
            aria-label={keyboard ? "Stop typing" : "Retake"}
            onPointerDown={keyboard ? keep : undefined}
            // While typing it only puts the keyboard away; the photo stays.
            onClick={keyboard ? stopTyping : backToCamera}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          {preview && (
            // A local preview of the photo just taken.
            // eslint-disable-next-line @next/next/no-img-element
            <img className={`ask-thumb${keyboard || photoAway ? " ask-thumb-on" : ""}`} src={preview} alt="" aria-hidden="true" />
          )}
          <h1 className="cam-title">{keyboard ? "Your question" : "Ask about it"}</h1>
          {keyboard ? (
            <button type="button" className="ask-done" onPointerDown={keep} onClick={stopTyping}>
              Done
            </button>
          ) : (
            <span className="cam-icon cam-spacer" aria-hidden="true" />
          )}
        </div>

        <div className="ask-body">
          <section className="ask-photo" ref={photoRef} hidden={keyboard} aria-label="Your photo">
            {look ? (
              <SnapCardShell src={preview} live={live} who="You" sub="Gone in 24 hours">
                <p className="snapc-q">{q || "Your question"}</p>
                <div className={`snapc-answers${!emoji && answers.length > 2 ? " snapc-grid" : ""}`}>
                  {answers.map((a, i) => (
                    <span key={i} className={`snapc-answer${emoji ? " snapc-emoji" : ""}`}>
                      <span className="snapc-label">{a.trim() || "…"}</span>
                    </span>
                  ))}
                </div>
              </SnapCardShell>
            ) : (
              // A local preview of the photo just taken.
              // eslint-disable-next-line @next/next/no-img-element
              preview && <img className="ask-photo-img" src={preview} alt="Your photo" />
            )}
            {!look && (
              <button type="button" className="ask-pchip ask-retake" onClick={backToCamera}>
                ↺ Retake
              </button>
            )}
            <button type="button" className={`ask-pchip ${look ? "ask-look-off" : "ask-look"}`} aria-pressed={look} onClick={() => setLook(!look)}>
              {look ? "✕ Just the photo" : "👁 How friends see it"}
            </button>
          </section>

          <section className="ask-sec ask-edit">
            <label className="ask-label" htmlFor="snap-question">
              Your question
            </label>
            <textarea
              id="snap-question"
              ref={questionRef}
              className="ask-q"
              placeholder="Type your question…"
              rows={1}
              maxLength={QUESTION_MAX}
              value={question}
              onChange={(e) => editQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
            />
            {error && (
              <p className="poll-error ask-error" role="alert">
                {error}
              </p>
            )}
            <span className="ask-label" id="snap-answers">
              Answers
            </span>
            {/* Long answers get a row each, so they show whole. */}
            <div className={`ask-answers${answers.some((a) => [...a].length > 12) ? " ask-answers-wide" : ""}`} ref={answersRef} role="group" aria-labelledby="snap-answers">
              {answers.map((a, i) => (
                <span key={i} className="ask-answer">
                  <input aria-label={`Answer ${i + 1}`} placeholder={`Answer ${i + 1}`} maxLength={ANSWER_MAX} value={a} onChange={(e) => editAnswer(i, e.target.value)} onKeyDown={nextBox} />
                  {answers.length > 2 && (
                    <button type="button" className="ask-x" aria-label={`Remove answer ${i + 1}`} onPointerDown={keep} onClick={() => pickAnswers(answers.filter((_, n) => n !== i))}>
                      ×
                    </button>
                  )}
                </span>
              ))}
              {answers.length < MAX_ANSWERS && (
                <button type="button" className={`ask-add${answers.length === 0 ? " ask-add-first" : ""}`} onPointerDown={keep} onClick={addAnswer}>
                  + Add answer
                </button>
              )}
              {offers.length > 0 && (
                <div className="ask-offers">
                  <small>Or tap a pair to fill them in:</small>
                  {offers.map((list) => (
                    <button key={list.join("|")} type="button" className="ask-chip" onPointerDown={keep} onClick={() => pickAnswers(list)}>
                      {list.join(" / ")}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="ask-sec" hidden={keyboard}>
            <span className="ask-label">Or pick an idea</span>
            <div className="ask-chips">
              {SNAP_IDEAS.map((t) => (
                <button key={t.id} type="button" className="ask-chip" aria-pressed={idea === t.id} onClick={() => pickIdea(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
          </section>

          <section className="ask-sec" hidden={keyboard}>
            <span className="ask-label" id="snap-audience">
              Who sees it
            </span>
            <div className="ask-aud" role="radiogroup" aria-labelledby="snap-audience">
              {AUDIENCES.map((o) => (
                <button key={o.id} type="button" role="radio" aria-checked={sendTo === o.id} disabled={blocked(o.id)} onClick={() => pickAudience(o.id)}>
                  <span>
                    <b>{o.name}</b>
                    <small>{o.id === "circle" && friends === 0 ? "Add friends first" : o.id === "public" && tooNew ? "From tomorrow (new accounts wait a day)" : o.text}</small>
                  </span>
                  <span className="ask-dot" aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="ask-bar" hidden={keyboard}>
          <button type="button" className="ask-send press" onClick={send} disabled={!!problem}>
            {problem ?? AUDIENCES.find((o) => o.id === sendTo)!.send}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="create-screen snap-screen">
      <SnapHeader title="Quick snap" />
      {phase === "checking" ? (
        <section className="check-card" role="status">
          {upload !== null && slowUp ? (
            <>
              <span className="chip chip-white">📤 Sending</span>
              <h2 className="poll-question">Posting your snap · {upload}%</h2>
              <span className="state-bar state-real" aria-hidden="true" style={{ "--done": `${upload}%` } as CSSProperties}>
                <i />
              </span>
              <p className="poll-foot-note">Slow connection. Keep Eithr open until it&apos;s done.</p>
              <button type="button" className="btn btn-white press snap-cancel" onClick={() => cancelUp.current?.abort()}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <span className="chip chip-white">🛡️ Safety check</span>
              <h2 className="poll-question">Checking your photo…</h2>
              <div className="check-bar" aria-hidden="true">
                <span />
              </div>
              <p className="poll-foot-note">Usually a few seconds.</p>
            </>
          )}
        </section>
      ) : phase === "review" ? (
        <section className="check-card check-review" role="status">
          <span className="chip chip-sun">⏳ Quick review</span>
          <h2 className="poll-question">Your snap is waiting for a quick review.</h2>
          <p className="poll-foot-note">
            A person will check it soon. If it&apos;s fine, it goes live; you&apos;ll find it in your feed
            {sendTo === "link" ? ", with its link to share." : "."}
          </p>
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
  const router = useRouter();
  return (
    <header className="create-header">
      <button type="button" aria-label="Close" className="icon-btn icon-btn-white press" onClick={() => leaveScreen(router, "/")}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <h1 className="create-title">{title}</h1>
      {right ?? <span className="create-spacer" />}
    </header>
  );
}
