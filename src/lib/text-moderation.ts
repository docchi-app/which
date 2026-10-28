// Server only: the AI check on typed polls and comments (snaps are checked with their
// photo in snap-moderation.ts). OpenAI's moderation is free and reads English, Hindi,
// Hinglish and Marathi; the word filter in the database has already run by now.

const env = (name: string) => process.env[name]?.trim() || undefined;
const OPENAI_KEY = env("OPENAI_API_KEY");
const url = env("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const secret = env("PUSH_CRON_SECRET");

export const textCheckConfigured = Boolean(OPENAI_KEY && url && anonKey && secret);

export type TextVerdict = "ok" | "review" | "hide";
type Scores = Record<string, number>;

// Per category: [send to review at, hide at]. Polls ask about people, so harassment
// and hate are the ones to watch; a poll about a fight scene shouldn't trip "violence".
const LIMITS: Record<string, [number, number]> = {
  harassment: [0.4, 0.85],
  "harassment/threatening": [0.3, 0.6],
  hate: [0.35, 0.7],
  "hate/threatening": [0.25, 0.5],
  sexual: [0.5, 0.85],
  "sexual/minors": [0.05, 0.2],
  "self-harm": [0.3, 0.7],
  "self-harm/intent": [0.3, 0.6],
  "self-harm/instructions": [0.2, 0.5],
  violence: [0.6, 0.9],
  "violence/graphic": [0.5, 0.8],
  illicit: [0.6, 0.9],
  "illicit/violent": [0.4, 0.7],
};

/** The verdict for one set of scores, and the category that decided it. */
export function textVerdict(scores: Scores): { verdict: TextVerdict; reason: string | null } {
  // The highest level reached; among equals, the category furthest past its line.
  let best = { level: 0, over: 0, cat: null as string | null };
  for (const [cat, [review, hide]] of Object.entries(LIMITS)) {
    const s = scores[cat] ?? 0;
    const level = s >= hide ? 2 : s >= review ? 1 : 0;
    const over = s / review;
    if (level > best.level || (level > 0 && level === best.level && over > best.over)) best = { level, over, cat };
  }
  return { verdict: (["ok", "review", "hide"] as const)[best.level], reason: best.cat };
}

/** Scores for a piece of text, or null when the check can't run (no key, OpenAI down). */
export async function scoreText(text: string): Promise<Scores | null> {
  if (!OPENAI_KEY || !text.trim()) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "omni-moderation-latest", input: text.slice(0, 2000) }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`moderation ${res.status}`);
    const body = (await res.json()) as { results?: { category_scores?: Scores }[] };
    return body.results?.[0]?.category_scores ?? null;
  } catch (e) {
    console.error("text check:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function rpc<T>(fn: string, args: Record<string, unknown>, token?: string): Promise<T> {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anonKey!, Authorization: `Bearer ${token ?? anonKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export type TextItem = { target_type: "poll" | "comment"; target_id: string; body: string };

/** Checks each item and records the verdict. Returns how many were checked. */
export async function checkTexts(items: TextItem[]): Promise<number> {
  let done = 0;
  // A few at a time: OpenAI's free tier has a rate limit.
  for (let i = 0; i < items.length; i += 4) {
    await Promise.all(
      items.slice(i, i + 4).map(async (item) => {
        const scores = await scoreText(item.body);
        if (!scores) return; // stays unchecked; the job tries again
        const { verdict, reason } = textVerdict(scores);
        // Only what matters for the review, not all ~13 scores.
        const flags = Object.fromEntries(Object.entries(scores).filter(([, v]) => v >= 0.1).map(([k, v]) => [k, Math.round(v * 100) / 100]));
        await rpc("set_text_verdict", { target_type: item.target_type, target_id: item.target_id, verdict, flags, reason, secret });
        done++;
      }),
    );
  }
  return done;
}

/** For the 2-minute job: posts the app didn't send for checking. */
export async function sweepTexts(): Promise<number> {
  if (!textCheckConfigured) return 0;
  const items = await rpc<TextItem[]>("texts_to_check", { secret, max_rows: 20 });
  return items?.length ? checkTexts(items) : 0;
}
