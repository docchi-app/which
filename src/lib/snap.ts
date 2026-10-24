import { getSupabase } from "./supabase";

// Quick snap: a photo poll that disappears after 24 hours. Photos are made on
// the phone as exact 3:4 images (1080 × 1440, see snap-photo.ts), uploaded to
// the private "snaps" bucket, and the poll only goes live once
// /api/snap/check has passed the photo.

export type SnapTemplate = "rate" | "buy" | "go" | "own";
export type SnapAudience = "circle" | "public";
export type SnapStatus = "pending" | "live" | "review" | "rejected";

export const SNAP_TEMPLATES: { id: SnapTemplate; label: string; question: string; answers: string[] }[] = [
  { id: "rate", label: "Rate my fit", question: "Rate my fit", answers: ["🔥", "😍", "😐", "🙅"] },
  { id: "buy", label: "Buy or skip?", question: "Buy it or skip it?", answers: ["🛒 Buy", "🙅 Skip"] },
  { id: "go", label: "Should I go?", question: "Should I go?", answers: ["🙌 Go", "🛋️ Stay home"] },
  { id: "own", label: "✏️ Your own", question: "", answers: ["👍 Yes", "👎 No"] },
];

export class SnapError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/** Uploads and posts a snap (`photo` is already a 3:4 snap photo). Returns the new poll's id (still waiting for its check). */
export async function postSnap(input: {
  photo: Blob;
  template: SnapTemplate;
  question?: string;
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
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage.from("snaps").upload(path, blob, { contentType: blob.type, cacheControl: "86400", upsert: false });
  if (up.error) {
    console.error("snap upload:", up.error.message);
    // The bucket comes with the Quick snap migration; without it nothing can upload.
    throw new SnapError(/bucket not found/i.test(up.error.message) ? "not_set_up" : "upload");
  }

  const { data: id, error } = await supabase.rpc("create_snap", {
    photo_path: path,
    template: input.template,
    question: input.question ?? null,
    visibility: input.audience,
    live: input.live,
  });
  if (error) {
    await supabase.storage.from("snaps").remove([path]);
    throw new SnapError(/docchi:(\w+)/.exec(error.message)?.[1] ?? "failed");
  }
  return id as string;
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
  return row ? { path: row.photo_path, status: row.photo_status, live: row.photo_live } : null;
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
  snap_limit: "That's 3 snaps today. Come back tomorrow!",
  snap_too_new: "New accounts can send snaps to friends for the first day. Everyone opens up tomorrow.",
  empty_circle: "Add a friend first, or send it to Everyone.",
  question_length: "Questions need 3 to 80 characters.",
  blocked_words: "Let's keep it friendly: some of those words aren't allowed.",
  too_big: "That photo is too big. Try another one.",
  not_set_up: "Snaps aren't set up yet. (Whoever runs Docchi: run the Quick snap migrations.)",
  upload: "Couldn't upload the photo. Check your connection and try again.",
  no_photo: "The photo didn't upload. Try again.",
  demo: "Demo mode: snaps need Supabase.",
};
export const snapErrorText = (e: unknown) => (e instanceof SnapError && SNAP_ERRORS[e.code]) || "Couldn't post your snap. Try again?";

// The last question and audience, so the next snap is one tap shorter.
const PREFS_KEY = "docchi.snapPrefs";

export function snapPrefs(): { template: SnapTemplate; audience: SnapAudience } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as { template?: SnapTemplate; audience?: SnapAudience };
    return {
      template: SNAP_TEMPLATES.some((t) => t.id === p.template) ? p.template! : "rate",
      audience: p.audience === "public" ? "public" : "circle",
    };
  } catch {
    return { template: "rate", audience: "circle" };
  }
}

export function saveSnapPrefs(template: SnapTemplate, audience: SnapAudience) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ template, audience }));
  } catch {
    // Not remembered this time.
  }
}
