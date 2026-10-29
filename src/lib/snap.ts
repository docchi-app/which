import { getSupabase } from "./supabase";
import { averageColor } from "./snap-photo";

// Quick snap: a photo poll that disappears after 24 hours. Photos are made on
// the phone as exact 3:4 images (1080 × 1440, see snap-photo.ts), uploaded to
// the private "snaps" bucket, and the poll only goes live once
// /api/snap/check has passed the photo.

export type SnapAudience = "circle" | "public" | "link";
export type SnapStatus = "pending" | "live" | "review" | "rejected";

/** Ready-made questions: tap one and its question and answers fill in (all still editable). */
export const SNAP_IDEAS = [
  { id: "buy", label: "🛒 Buy or skip?", question: "Buy it or skip it?", answers: ["🛒 Buy", "🙅 Skip"] },
  { id: "rate", label: "🔥 Rate my fit", question: "Rate my fit", answers: ["🔥", "😍", "😐", "🙅"] },
  { id: "go", label: "🙌 Should I go?", question: "Should I go?", answers: ["🙌 Go", "🛋️ Stay home"] },
  { id: "that", label: "⚖️ This or that?", question: "This or that?", answers: ["👈 This", "👉 That"] },
  { id: "food", label: "🍽️ Rate my food", question: "Rate my food", answers: ["🤤", "😋", "😐", "🤢"] },
  { id: "much", label: "🤔 Too much?", question: "Too much?", answers: ["😍 Love it", "😬 Too much"] },
] as const;
export type SnapIdea = (typeof SNAP_IDEAS)[number]["id"];

export const YES_NO = ["👍 Yes", "👎 No"];
export const MAX_ANSWERS = 4;
export const QUESTION_MAX = 80;
export const ANSWER_MAX = 24;

/** "Wedding or office party?" → ["Wedding", "Office party"]: the two sides, as answers. */
export function eitherOr(question: string): string[] | null {
  const m = /^(?:[\w\s']*?:\s*)?(.+?)\s+or\s+(.+?)[?!.\s]*$/i.exec(question.trim());
  if (!m) return null;
  const side = (t: string) => {
    const s = t.trim().replace(/^(a|an|the)\s+/i, "");
    return (s.charAt(0).toUpperCase() + s.slice(1)).slice(0, ANSWER_MAX).trim();
  };
  // "Should I go to Goa or Manali?": a long first half is mostly the question; keep its end.
  const left = m[1].trim().split(/\s+/);
  const keep = Math.min(3, Math.max(1, m[2].trim().split(/\s+/).length));
  const [a, b] = [side((left.length > 3 ? left.slice(-keep) : left).join(" ")), side(m[2])];
  return a && b && a.toLowerCase() !== b.toLowerCase() ? [a, b] : null;
}

/** Answers short enough to be emoji only (🔥 😍 😐 🙅) show as round, big tap targets. */
export const isEmojiAnswers = (answers: readonly string[]) => answers.length > 2 && answers.every((a) => [...a.trim()].length <= 2);

export class SnapError extends Error {
  /** snap_limit: the snaps-a-day limit (Admin → Limits), when it could be read. */
  limit?: number;
  constructor(public code: string) {
    super(code);
  }
}

/** Uploads and posts a snap (`photo` is already a 3:4 snap photo). Returns the new poll's id (still waiting for its check). */
export async function postSnap(input: {
  photo: Blob;
  question: string;
  answers: string[];
  audience: SnapAudience;
  live: boolean;
}): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new SnapError("demo");
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user || user.is_anonymous) throw new SnapError("sign_in");

  const blob = input.photo;
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  // The photo's average colour rides in its name, so the feed can paint it while the photo loads.
  const tint = await averageColor(blob).catch(() => null);
  const path = `${user.id}/${crypto.randomUUID()}${tint ? `-c${tint}` : ""}.${ext}`;
  const up = await supabase.storage.from("snaps").upload(path, blob, { contentType: blob.type, cacheControl: "86400", upsert: false });
  if (up.error) {
    console.error("snap upload:", up.error.message);
    // The bucket comes with the Quick snap migration; without it nothing can upload.
    throw new SnapError(/bucket not found/i.test(up.error.message) ? "not_set_up" : "upload");
  }

  const { data: id, error } = await supabase.rpc("create_snap", {
    photo_path: path,
    question: input.question,
    answers: input.answers,
    visibility: input.audience,
    live: input.live,
  });
  if (error) {
    await supabase.storage.from("snaps").remove([path]);
    const fail = new SnapError(/docchi:(\w+)/.exec(error.message)?.[1] ?? "failed");
    if (fail.code === "snap_limit") {
      const { data: st } = await supabase.rpc("create_poll_status", { name_seed: null });
      if (typeof st?.snap_limit === "number") fail.limit = st.snap_limit;
    }
    throw fail;
  }
  return id as string;
}

/** The colour saved in a snap photo's name ("…-c3a6ea5.webp" → "#3a6ea5"), if any. */
export function photoTint(path: string | null | undefined): string | null {
  const m = /-c([0-9a-f]{6})\.(?:webp|jpg)$/.exec(path ?? "");
  return m ? `#${m[1]}` : null;
}

/** Deletes my snap for everyone, and its photo straight away (the daily clean-up catches it otherwise). */
export async function deleteSnap(pollId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new SnapError("demo");
  const info = await snapInfo(pollId).catch(() => null);
  const { error } = await supabase.rpc("delete_poll", { poll: pollId });
  if (error) throw new SnapError(/docchi:(\w+)/.exec(error.message)?.[1] ?? "failed");
  if (info?.path) {
    const { error: rm } = await supabase.storage.from("snaps").remove([info.path]);
    if (!rm) await supabase.rpc("mark_snap_photos_deleted", { paths: [info.path] });
  }
}

/** Runs the safety check for a snap I just posted. */
export async function checkSnap(pollId: string): Promise<SnapStatus> {
  const supabase = getSupabase();
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  if (!token) return "pending";
  try {
    await fetch("/api/snap/check", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ poll: pollId }),
    });
  } catch {
    // Offline: the status below says it's still waiting.
  }
  return (await snapInfo(pollId))?.status ?? "pending";
}

export type SnapInfo = { path: string | null; status: SnapStatus; live: boolean };

export async function snapInfo(pollId: string): Promise<SnapInfo | null> {
  const { data } = (await getSupabase()?.rpc("snap_info", { ids: [pollId] })) ?? {};
  const row = (data as { photo_path: string | null; photo_status: SnapStatus; photo_live: boolean }[] | null)?.[0];
  const info = row ? { path: row.photo_path, status: row.photo_status, live: row.photo_live } : null;
  if (info) infos.set(pollId, info);
  return info;
}

// What each snap card last showed, so a card coming back on screen (back to the feed,
// another tab) shows its photo at once instead of loading it again.
const infos = new Map<string, SnapInfo>();

/** The photo a snap card already showed, while its signed link is still good. */
export function knownSnapPhoto(pollId: string): { src: string | null; tint: string | null; live: boolean } | null {
  const info = infos.get(pollId);
  if (!info) return null;
  if (!info.path) return { src: null, tint: null, live: false };
  const hit = urls.get(info.path);
  return hit && hit.until > Date.now() ? { src: hit.url, tint: photoTint(info.path), live: info.live } : null;
}

// Signed photo links last an hour; reuse them so the browser can cache the photo.
const urls = new Map<string, { url: string; until: number }>();

export async function snapPhotoUrl(path: string): Promise<string | null> {
  const hit = urls.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data } = (await getSupabase()?.storage.from("snaps").createSignedUrl(path, 3600)) ?? {};
  if (!data?.signedUrl) return null;
  urls.set(path, { url: data.signedUrl, until: Date.now() + 50 * 60_000 });
  return data.signedUrl;
}

const CLEANED_KEY = "docchi.snapsCleaned";

/**
 * Deletes photos of my snaps that have closed (or were turned down), at most
 * once a day. Admins can pass everyone=true to sweep all of them.
 */
export async function cleanUpSnapPhotos(everyone = false): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) return 0;
  if (!everyone) {
    try {
      if (Number(localStorage.getItem(CLEANED_KEY) ?? 0) > Date.now() - 864e5) return 0;
      localStorage.setItem(CLEANED_KEY, String(Date.now()));
    } catch {
      // Storage blocked: clean up now.
    }
  }
  const { data } = await supabase.rpc("expired_snap_photos", { everyone });
  const paths = (data as string[] | null) ?? [];
  if (paths.length === 0) return 0;
  const { error } = await supabase.storage.from("snaps").remove(paths);
  if (error) return 0;
  await supabase.rpc("mark_snap_photos_deleted", { paths });
  return paths.length;
}

export const SNAP_ERRORS: Record<string, string> = {
  sign_in: "Sign in to post a snap.",
  need_username: "Pick a username first.",
  banned: "This account can't post.",
  snap_limit: "That's today's snaps. You can snap again after midnight.",
  snap_too_new: "New accounts can send snaps to friends for the first day. Everyone opens up tomorrow.",
  empty_circle: "No friends yet. Pick Link only and send it to someone.",
  question_length: "Questions need 3 to 80 characters.",
  answer_count: "Give it 2 to 4 answers.",
  answer_length: "Answers need 1 to 24 characters.",
  duplicate_answers: "Two answers are the same. Change one.",
  not_yours: "You can only delete your own snap.",
  blocked_words: "Let's keep it friendly: some of those words aren't allowed.",
  too_big: "That photo is too big. Try another one.",
  not_set_up: "Snaps aren't set up yet. (Whoever runs Eithr: run the Quick snap migrations.)",
  upload: "Couldn't upload the photo. Check your connection and try again.",
  no_photo: "The photo didn't upload. Try again.",
  demo: "Demo mode: snaps need Supabase.",
};
export const snapErrorText = (e: unknown) =>
  e instanceof SnapError && e.code === "snap_limit" && e.limit
    ? `That's ${e.limit} ${e.limit === 1 ? "snap" : "snaps"} today. You can snap again after midnight.`
    : (e instanceof SnapError && SNAP_ERRORS[e.code]) || "Couldn't post your snap. Try again?";

// The last idea and audience, so the next snap is one tap shorter.
const PREFS_KEY = "docchi.snapPrefs";

export function snapPrefs(): { idea: SnapIdea; audience: SnapAudience } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as { idea?: SnapIdea; audience?: SnapAudience };
    return {
      idea: SNAP_IDEAS.some((t) => t.id === p.idea) ? p.idea! : "buy",
      audience: p.audience === "public" || p.audience === "link" ? p.audience : "circle",
    };
  } catch {
    return { idea: "buy", audience: "circle" };
  }
}

export function saveSnapPrefs(prefs: { idea?: SnapIdea; audience?: SnapAudience }) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...snapPrefs(), ...prefs }));
  } catch {
    // Not remembered this time.
  }
}
