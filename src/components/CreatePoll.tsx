"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { continueWithGoogle, currentUser, saveReturnTo } from "@/lib/auth";
import {
  checkUsername,
  createPoll,
  CreatePollError,
  DAILY_POLL_LIMIT,
  getCreateStatus,
  type CreateStatus,
  type UsernameProblem,
} from "@/lib/create";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { PollKind, Visibility } from "@/lib/types";
import { getMyCircle, type MyCircle } from "@/lib/circle";
import { ANSWER_COLORS } from "./PollCard";
import { ArrowIcon, PlusIcon } from "./icons";

const QUESTION_MAX = 140;
const ANSWER_MAX = 40;
const DURATIONS = [1, 3, 7] as const;
type Days = (typeof DURATIONS)[number];

type Draft = {
  kind: PollKind;
  question: string;
  teaser: string;
  answers: string[];
  days: Days;
  username: string;
  visibility: Visibility;
  /** Friends-only polls: only these lists (empty = all friends). */
  groups: string[];
};
const EMPTY_DRAFT: Draft = {
  kind: "classic",
  question: "",
  teaser: "",
  answers: ["", ""],
  days: 3,
  username: "",
  visibility: "public",
  groups: [],
};
const TEASER_MAX = 60;

const FORMATS: { kind: PollKind; label: string; blurb: string }[] = [
  { kind: "classic", label: "Classic", blurb: "A question and 2 to 4 answers." },
  { kind: "hot_take", label: "Hot take", blurb: "A bold statement. People agree or disagree." },
  { kind: "mystery", label: "Mystery", blurb: "People pick on gut. Your question shows after they tap." },
];
const DRAFT_KEY = "docchi.draft";

// Result of checking one username with the server.
type NameCheck = { name: string; problem: UsernameProblem; suggestions: string[] };

const ERRORS: Record<string, string> = {
  sign_in: "Your sign-in expired. Sign in again to post.",
  banned: "This account can't post polls.",
  daily_limit: `That's ${DAILY_POLL_LIMIT} polls today. Come back tomorrow!`,
  question_length: "Questions need 3 to 140 characters.",
  answer_length: `Answers can be up to ${ANSWER_MAX} characters.`,
  answer_count: "Add 2 to 4 answers.",
  duplicate_answers: "Two answers are the same. Make each one different.",
  duration: "Pick when the poll closes.",
  blocked_words: "Let's keep it friendly: some of those words aren't allowed.",
  empty_circle: "No friends yet (or in those lists). Share your invite link from the Friends tab.",
  special_limit: "One hot take or mystery poll a day. Post a classic, or come back tomorrow!",
  teaser_length: "Mystery polls need a teaser of 3 to 60 characters.",
  demo: "Demo mode: polls can't be posted until Supabase is connected.",
};

const NAME_HINT: Record<Exclude<UsernameProblem, "ok">, string> = {
  format: "3 to 20 letters, numbers or _",
  reserved: "That one's reserved. How about:",
  blocked: "Let's pick something friendlier. How about:",
  taken: "Taken! These are free:",
};

function loadDraft(): Draft {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<Draft>) } : EMPTY_DRAFT;
  } catch {
    return EMPTY_DRAFT;
  }
}

const cleanName = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);

export function CreatePoll() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [status, setStatus] = useState<CreateStatus | null>(null);
  const [checked, setChecked] = useState<NameCheck | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restored = useRef(false);
  // Typing before the screen finishes loading must not be overwritten.
  const edited = useRef(false);
  // Your friends and their lists, for "Friends".
  const [circle, setCircle] = useState<MyCircle | null>(null);

  // Restore an unfinished draft (e.g. after signing in), then load who's posting.
  useEffect(() => {
    const saved = loadDraft();
    restored.current = true;
    (async () => {
      const user = await currentUser();
      const seed = (user?.user_metadata.full_name as string | undefined) ?? user?.email?.split("@")[0] ?? null;
      try {
        const s = await getCreateStatus(seed);
        setStatus(s);
        // Prefill a free username so posting stays one tap.
        setDraft((d) => {
          const base = edited.current ? d : saved;
          return { ...base, username: base.username || s.suggestions[0] || "" };
        });
      } catch (e) {
        console.error(e);
        if (!edited.current) setDraft(saved);
        setError("Couldn't load. Check your connection and try again.");
      }
    })();
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Draft just won't survive a reload.
    }
  }, [draft]);

  const needsName = !!status?.signedIn && status.username === null;

  useEffect(() => {
    if (!status?.signedIn || !isSupabaseConfigured) return;
    getMyCircle()
      .then(setCircle)
      .catch(() => {});
  }, [status?.signedIn]);

  const circleSize = circle?.members.length ?? 0;
  // People who'd see a circle poll with the current group choice.
  const audienceSize = !circle
    ? 0
    : draft.groups.length === 0
      ? circleSize
      : circle.members.filter((m) => m.groups.some((g) => draft.groups.includes(g))).length;

  // Check the username with the server as they type (debounced).
  useEffect(() => {
    const name = draft.username;
    if (!needsName || name.length < 3 || checked?.name === name) return;
    const timer = window.setTimeout(async () => {
      try {
        setChecked({ name, ...(await checkUsername(name)) });
      } catch {
        // Offline: the server checks again on Post.
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [draft.username, needsName, checked]);

  // null while waiting for the server.
  const nameCheck: Omit<NameCheck, "name"> | null = !needsName
    ? { problem: "ok", suggestions: [] }
    : draft.username.length < 3
      ? { problem: "format", suggestions: [] }
      : checked?.name === draft.username
        ? checked
        : null;

  const set = (patch: Partial<Draft>) => {
    edited.current = true;
    setError(null);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const setAnswer = (i: number, v: string) => set({ answers: draft.answers.map((a, j) => (j === i ? v : a)) });

  const kind = draft.kind;
  const isTake = kind === "hot_take";
  const isMystery = kind === "mystery";
  const question = draft.question.trim();
  const teaser = draft.teaser.trim();
  const answers = isTake ? ["Agree", "Disagree"] : draft.answers.map((a) => a.trim()).filter(Boolean);
  const dupes = new Set(answers.map((a) => a.toLowerCase())).size !== answers.length;
  const nameOk = nameCheck?.problem === "ok";
  const specialUsed = kind !== "classic" && status?.specialLeft === 0;
  const circleEmpty = draft.visibility === "circle" && circle !== null && audienceSize === 0;
  const missing = specialUsed
    ? "You've posted today's hot take or mystery poll. Classic polls are still open!"
    : isMystery && teaser.length < 3
      ? "Write the teaser people see first"
      : question.length < 3
        ? isTake
          ? "Write your hot take"
          : isMystery
            ? "Write the hidden question"
            : "Ask a question"
        : answers.length < 2
          ? "Add at least 2 answers"
          : dupes
            ? "Two answers are the same"
            : !nameOk
              ? "Pick a username"
              : circleEmpty
                ? "No friends yet (or in those lists)"
                : status && status.pollsLeft <= 0
                ? `That's ${DAILY_POLL_LIMIT} polls today. Come back tomorrow!`
                : null;

  async function post() {
    if (missing || posting) return;
    setPosting(true);
    setError(null);
    try {
      const id = await createPoll({
        question,
        answers,
        days: draft.days,
        username: needsName ? draft.username : null,
        kind,
        teaser: isMystery ? teaser : null,
        visibility: draft.visibility,
        groups: draft.groups,
      });
      sessionStorage.removeItem(DRAFT_KEY);
      router.push(`/?poll=${id}&created=1`);
    } catch (e) {
      setPosting(false);
      if (e instanceof CreatePollError) {
        if (e.code.startsWith("username_")) {
          // Someone grabbed it a moment ago: show fresh suggestions in place.
          const r = await checkUsername(draft.username).catch(() => null);
          if (r) setChecked({ name: draft.username, ...r });
          return;
        }
        setError(ERRORS[e.code] ?? "Couldn't post. Try again?");
      } else {
        console.error(e);
        setError("Couldn't post. Try again?");
      }
    }
  }

  async function signIn() {
    saveReturnTo("/create");
    try {
      await continueWithGoogle();
    } catch {
      setError("Google sign-in isn't available right now. Try again in a bit.");
    }
  }

  const author = needsName ? draft.username || "you" : (status?.username ?? "you");
  const daysLabel = `${draft.days} day${draft.days === 1 ? "" : "s"}`;

  return (
    <div className="create-screen">
      <header className="create-header">
        <Link href="/" aria-label="Close" className="icon-btn icon-btn-white press">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </Link>
        <h1 className="create-title">New poll</h1>
        <span className="create-spacer" />
      </header>

      <form
        className="create-form"
        onSubmit={(e) => {
          e.preventDefault();
          post();
        }}
      >
        <fieldset className="field">
          <legend className="field-label">Format</legend>
          <div className="formats" role="radiogroup" aria-label="Poll format">
            {FORMATS.map((f) => (
              <button
                key={f.kind}
                type="button"
                role="radio"
                aria-checked={kind === f.kind}
                className={`format press format-${f.kind}`}
                onClick={() => set({ kind: f.kind })}
              >
                {f.label}
              </button>
            ))}
          </div>
          <span className="format-blurb">
            {FORMATS.find((f) => f.kind === kind)?.blurb}
            {kind !== "classic" && " One a day."}
          </span>
        </fieldset>

        {isMystery && (
          <div className="field">
            <label htmlFor="teaser" className="field-label">
              What people see first
            </label>
            <input
              id="teaser"
              className="answer-input teaser-input"
              maxLength={TEASER_MAX}
              placeholder="Pick a colour"
              value={draft.teaser}
              onChange={(e) => set({ teaser: e.target.value })}
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="question" className="field-label">
            {isTake ? "Your hot take" : isMystery ? "The hidden question" : "Ask anything"}
          </label>
          <textarea
            id="question"
            className="question-input"
            rows={2}
            maxLength={QUESTION_MAX}
            placeholder={
              isTake
                ? "Pineapple belongs on pizza."
                : isMystery
                  ? "What colour is your dream car?"
                  : "Tea or coffee to start the day?"
            }
            value={draft.question}
            onChange={(e) => set({ question: e.target.value.replace(/\n/g, " ") })}
          />
          <span className={`counter${draft.question.length > 120 ? " counter-warn" : ""}`}>
            {draft.question.length} / {QUESTION_MAX}
          </span>
        </div>

        {!isTake && (
          <fieldset className="field">
            <legend className="field-label">Answers</legend>
            {draft.answers.map((a, i) => (
              <div key={i} className="answer-row">
                <span className="answer-letter" aria-hidden="true" style={{ background: ANSWER_COLORS[i] }}>
                  {"ABCD"[i]}
                </span>
                <input
                  className="answer-input"
                  aria-label={`Answer ${i + 1}`}
                  maxLength={ANSWER_MAX}
                  placeholder="Type an answer"
                  value={a}
                  onChange={(e) => setAnswer(i, e.target.value)}
                />
                {draft.answers.length > 2 && (
                  <button
                    type="button"
                    className="remove-answer"
                    aria-label={`Remove answer ${i + 1}`}
                    onClick={() => set({ answers: draft.answers.filter((_, j) => j !== i) })}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
            {draft.answers.length < 4 && (
              <button type="button" className="add-answer" onClick={() => set({ answers: [...draft.answers, ""] })}>
                <PlusIcon size={18} strokeWidth={2.6} />
                Add answer ({4 - draft.answers.length} left)
              </button>
            )}
          </fieldset>
        )}

        <fieldset className="field">
          <legend className="field-label">Closes after</legend>
          <div className="durations">
            {DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                className="duration press"
                aria-pressed={draft.days === d}
                onClick={() => set({ days: d })}
              >
                {d} day{d === 1 ? "" : "s"}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend className="field-label">Who can see it</legend>
          <div className="durations">
            {(
              [
                ["public", "Everyone"],
                ["circle", "Friends"],
                ["link", "Only with link"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                className="duration press"
                aria-pressed={draft.visibility === v}
                onClick={() => set({ visibility: v })}
              >
                {label}
              </button>
            ))}
          </div>
          {draft.visibility === "circle" && circle && circleSize > 0 && (
            <div className="audience-chips" role="group" aria-label="Which friends">
              <button
                type="button"
                className="member-group"
                aria-pressed={draft.groups.length === 0}
                onClick={() => set({ groups: [] })}
              >
                All friends ({circleSize})
              </button>
              {circle.groups.map((g) => {
                const on = draft.groups.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    className="member-group"
                    aria-pressed={on}
                    onClick={() =>
                      set({ groups: on ? draft.groups.filter((x) => x !== g.id) : [...draft.groups, g.id] })
                    }
                  >
                    {g.name} ({g.count})
                  </button>
                );
              })}
            </div>
          )}
          <span className="format-blurb">
            {draft.visibility === "public"
              ? "Shows up in everyone's feed."
              : draft.visibility === "circle"
                ? circle && circleSize === 0
                  ? "No friends yet. Share your invite link from the Friends tab."
                  : `Only ${audienceSize} ${audienceSize === 1 ? "friend" : "friends"} can see and vote. They'll see who picked what.`
                : "Not public. Whoever you send the link to can vote, and it shows in their feed after they open it."}
          </span>
        </fieldset>

        {needsName && (
          <div className="field">
            <label htmlFor="username" className="field-label">
              Post as
            </label>
            <div className="name-input-wrap">
              <span aria-hidden="true">@</span>
              <input
                id="username"
                className="name-input"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={draft.username}
                onChange={(e) => set({ username: cleanName(e.target.value) })}
                aria-describedby="username-status"
              />
            </div>
            <div id="username-status" className="name-status" aria-live="polite">
              {!nameCheck && <span className="muted">Checking…</span>}
              {nameCheck?.problem === "ok" && (
                <span className="name-ok">@{draft.username} is yours. This is how you&apos;ll show up on polls and the leaderboard.</span>
              )}
              {nameCheck && nameCheck.problem !== "ok" && (
                <>
                  <span className="name-bad">{NAME_HINT[nameCheck.problem]}</span>
                  {nameCheck.suggestions.length > 0 && (
                    <span className="name-chips">
                      {nameCheck.suggestions.map((s) => (
                        <button key={s} type="button" className="name-chip press" onClick={() => set({ username: s })}>
                          @{s}
                        </button>
                      ))}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div className="field">
          <span className="field-label muted">Live preview</span>
          <div className={`preview-card preview-${kind}`}>
            {isMystery && <span className="preview-blur" aria-hidden="true" />}
            <span className="preview-q">
              {isMystery
                ? teaser || "Your teaser shows up here"
                : question || (isTake ? "Your hot take shows up here" : "Your question shows up here")}
            </span>
            <div className="preview-answers">
              {(isTake ? ["Agree", "Disagree"] : draft.answers).map((a, i) => (
                <span
                  key={i}
                  className="preview-chip"
                  style={{ background: isTake ? (i ? "var(--ink)" : "var(--white)") : ANSWER_COLORS[i], color: isTake && i ? "var(--cream)" : undefined }}
                >
                  {a.trim() || `Answer ${"ABCD"[i]}`}
                </span>
              ))}
            </div>
            <span className="preview-by">
              by @{author} · closes in {daysLabel}
              {draft.visibility === "link" && " · link only"}
              {draft.visibility === "circle" && " · friends only"}
            </span>
          </div>
        </div>
      </form>

      <div className="create-footer">
        {error && (
          <p className="poll-error" role="alert">
            {error}
          </p>
        )}
        {isSupabaseConfigured && status && !status.signedIn ? (
          <button type="button" className="post-btn post-btn-dark press" onClick={signIn}>
            Sign in with Google to post
          </button>
        ) : (
          <button
            type="button"
            className="post-btn press"
            onClick={post}
            disabled={!!missing || posting || !status}
            aria-describedby="post-hint"
          >
            {posting ? "Posting…" : "Post poll"}
            {!posting && <ArrowIcon size={20} strokeWidth={2.6} />}
          </button>
        )}
        <p id="post-hint" className="create-note">
          {missing && status?.signedIn !== false ? (
            missing
          ) : (
            <>
              Keep it fun and kind (<Link href="/guidelines">guidelines</Link>). Up to {DAILY_POLL_LIMIT} polls a day
              {status?.signedIn ? ` · ${status.pollsLeft} left today` : ""}.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
