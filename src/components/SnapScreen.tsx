"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
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

const EMOJI_SET = ["🔥", "😍", "😐", "🙅"];
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x.trim() === b[i].trim());

const AUDIENCES: { id: SnapAudience; name: string; text: string; send: string }[] = [
  { id: "circle", name: "👥 Friends", text: "see who picked", send: "Send to friends →" },
  { id: "public", name: "🌍 Everyone", text: "counts only", send: "Send to everyone →" },
  { id: "link", name: "🔗 Link only", text: "you send it", send: "Send and get the link →" },
];
const DAY = 864e5;

/**
 * /snap: Shoot → Ask → Send. The camera opens at once (3:4, exactly the card).
 * Then one screen finishes it: the question sits on the photo (last idea filled
 * in, tap it to type your own), ideas wrap below, who sees it is three plain
 * choices, and Send. Link only opens the share sheet right after.
 */
export function SnapScreen() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(isSupabaseConfigured ? null : false);
  const [phase, setPhase] = useState<Phase>("camera");
  const [idea, setIdea] = useState<SnapIdea | null>("buy");
  const [question, setQuestion] = useState<string>(SNAP_IDEAS[0].question);
  const [answers, setAnswers] = useState<string[]>([...SNAP_IDEAS[0].answers]);
  // Answers picked or typed by hand stay put; otherwise they follow the question ("X or Y?").
  const [answersSet, setAnswersSet] = useState(true);
  const [typing, setTyping] = useState(false);
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
  const sending = useRef(false);

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
    setAnswersSet(true);
    setError(null);
    // Still typing: the new idea's text is selected, so typing replaces it.
    const box = questionRef.current;
    if (box && document.activeElement === box) requestAnimationFrame(() => box.select());
  }

  function editQuestion(text: string) {
    const q = text.replace(/\n/g, " ").slice(0, QUESTION_MAX);
    setQuestion(q);
    setIdea(null);
    // Typing over an idea: its answers go too, and new ones follow the question ("X or Y?").
    if (idea) setAnswersSet(false);
    if (idea || !answersSet) setAnswers(eitherOr(q) ?? [...YES_NO]);
  }

  function editAnswer(i: number, text: string) {
    setAnswers((list) => list.map((a, n) => (n === i ? text.slice(0, ANSWER_MAX) : a)));
    setAnswersSet(true);
    setIdea(null);
  }

  function pickAnswers(list: readonly string[]) {
    setAnswers([...list]);
    setAnswersSet(true);
    setIdea(null);
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
  const problem =
    q.length < 3
      ? "Type your question"
      : clean.some((a) => !a)
        ? "Fill in every answer"
        : new Set(clean.map((a) => a.toLowerCase())).size < clean.length
          ? "Two answers are the same"
          : null;
  const blocked = (a: SnapAudience) => (a === "circle" && friends === 0) || (a === "public" && tooNew);
  // A remembered choice that can't be used yet becomes Link only (shown as picked).
  const sendTo: SnapAudience = blocked(audience) ? "link" : audience;
  const emoji = isEmojiAnswers(answers);
  const sides = eitherOr(q);
  const answerIdeas = [...(sides ? [sides] : []), YES_NO, EMOJI_SET].filter((l, i, all) => all.findIndex((x) => same(x, l)) === i);

  async function send() {
    if (!photo || problem || sending.current) return;
    sending.current = true;
    setError(null);
    // Sent: back no longer means "retake".
    dropLayer();
    setPhase("checking");
    try {
      const id = await postSnap({ photo, question: q, answers: clean, audience: sendTo, live });
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
    setTyping(false);
    setPhase("camera");
  }
  // After the photo, back goes back to the camera (not out of /snap).
  const backToCamera = useBackClose(phase === "frame" || phase === "ask", retake);

  // The photo is in: the keyboard comes up on the question (an idea's text selected,
  // so typing replaces it). Phones that only open it on a tap (iPhone) show the caret.
  useEffect(() => {
    if (phase !== "ask") return;
    const box = questionRef.current;
    if (!box) return;
    box.focus({ preventScroll: true });
    if (idea) box.select();
    else box.setSelectionRange(box.value.length, box.value.length);
    // Only when a new photo arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, preview]);

  // Is the on-screen keyboard up? (The visible screen is much shorter than it was.) While it is,
  // only the photo with its question shows. When it goes away, by Done, ‹, or the phone's own
  // back/hide key, typing is done and everything below comes back.
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
      else if (box?.closest(".ask-card")) box.blur();
    };
    vv.addEventListener("resize", onResize);
    return () => {
      vv.removeEventListener("resize", onResize);
      setKeyboard(false);
    };
  }, [phase]);

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
    // Keeps the text box focused while a chip is tapped.
    const keep = (e: React.PointerEvent) => e.preventDefault();
    return (
      <div className="ask-screen">
        <div className="cam-top">
          <button
            type="button"
            className="cam-icon"
            aria-label={typing ? "Stop typing" : "Retake"}
            onPointerDown={typing ? keep : undefined}
            // While typing it only puts the keyboard away; the photo stays.
            onClick={typing ? () => (document.activeElement as HTMLElement | null)?.blur() : backToCamera}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <h1 className="cam-title">{typing ? "Your own question" : "Ask about it"}</h1>
          {typing ? (
            <button type="button" className="ask-done" onPointerDown={keep} onClick={() => (document.activeElement as HTMLElement | null)?.blur()}>
              Done
            </button>
          ) : (
            <span className="cam-icon cam-spacer" aria-hidden="true" />
          )}
        </div>

        <div
          className={`ask-card${keyboard ? " ask-card-typing" : ""}`}
          onFocus={() => setTyping(true)}
          onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setTyping(false)}
        >
          <SnapCardShell src={preview} live={live} who="You" sub="Gone in 24 hours">
            <textarea
              ref={questionRef}
              className="snapc-q snapc-q-input"
              aria-label="Your question"
              placeholder="Type your question…"
              rows={1}
              maxLength={QUESTION_MAX}
              value={question}
              onChange={(e) => editQuestion(e.target.value)}
              // An idea's question is all selected, so typing replaces it (after the tap has
              // placed the caret, or the tap would undo it).
              onFocus={(e) => {
                const box = e.currentTarget;
                if (idea) setTimeout(() => box.select(), 0);
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), (e.target as HTMLElement).blur())}
            />
            <div className={`snapc-answers${emoji ? "" : answers.length > 2 ? " snapc-grid" : ""}`} style={{ "--n": answers.length } as CSSProperties}>
              {answers.map((a, i) => (
                <span key={i} className={`snapc-answer snapc-edit${emoji ? " snapc-emoji" : ""}`}>
                  <input
                    aria-label={`Answer ${i + 1}`}
                    placeholder={`Answer ${i + 1}`}
                    maxLength={ANSWER_MAX}
                    value={a}
                    onChange={(e) => editAnswer(i, e.target.value)}
                  />
                  {typing && answers.length > 2 && (
                    <button
                      type="button"
                      className="snapc-x"
                      aria-label={`Remove answer ${i + 1}`}
                      onPointerDown={keep}
                      onClick={() => pickAnswers(answers.filter((_, n) => n !== i))}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
              {typing && answers.length < MAX_ANSWERS && (
                <button type="button" className="snapc-add" aria-label="Add an answer" onPointerDown={keep} onClick={() => pickAnswers([...answers, ""])}>
                  +
                </button>
              )}
            </div>
          </SnapCardShell>
        </div>

        {keyboard ? null : typing && idea ? (
          <>
            <p className="ask-label">Type your own, or pick an idea</p>
            <div className="ask-chips">
              {SNAP_IDEAS.map((t) => (
                <button key={t.id} type="button" className="ask-chip" aria-pressed={idea === t.id} onPointerDown={keep} onClick={() => pickIdea(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
          </>
        ) : typing ? (
          <>
            <p className="ask-label">Answers</p>
            <div className="ask-chips">
              {answerIdeas.map((list) => (
                <button key={list.join("|")} type="button" className="ask-chip" aria-pressed={same(answers, list)} onPointerDown={keep} onClick={() => pickAnswers(list)}>
                  {isEmojiAnswers(list) ? list.join("") : list.join(" / ")}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="ask-label">Tap the question to type your own, or pick an idea</p>
            <div className="ask-chips">
              {SNAP_IDEAS.map((t) => (
                <button key={t.id} type="button" className="ask-chip" aria-pressed={idea === t.id} onClick={() => pickIdea(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="ask-bar" hidden={keyboard}>
          {error && (
            <p className="poll-error ask-error" role="alert">
              {error}
            </p>
          )}
          {!typing && (
            <div className="ask-seg" role="radiogroup" aria-label="Who sees it">
              {AUDIENCES.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={sendTo === o.id}
                  disabled={blocked(o.id)}
                  onClick={() => pickAudience(o.id)}
                >
                  {o.name}
                  <small>{o.id === "circle" && friends === 0 ? "add friends first" : o.id === "public" && tooNew ? "from tomorrow" : o.text}</small>
                </button>
              ))}
            </div>
          )}
          <button type="button" className="ask-send press" onPointerDown={keep} onClick={send} disabled={!!problem}>
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
