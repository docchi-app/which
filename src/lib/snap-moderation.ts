// Server only: turns OpenAI moderation scores into a verdict for a snap.

import "server-only";

export type Verdict = "live" | "review" | "rejected";
export type Scores = Record<string, number>;

const OPENAI_KEY = process.env.OPENAI_API_KEY?.trim() || undefined;

/**
 * Clearly bad: rejected. Anything that might be: a person reviews it.
 * Snaps for Everyone get a stricter bar than snaps for Friends.
 */
export function verdictFor(scores: Scores, visibility: string): Verdict {
  const s = (k: string) => scores[k] ?? 0;
  if (s("sexual/minors") > 0.05) return "rejected";
  if (s("sexual") > 0.8 || s("violence/graphic") > 0.8 || s("self-harm/instructions") > 0.5) return "rejected";
  const strict = visibility === "public";
  const review = strict
    ? s("sexual") > 0.15 || s("violence") > 0.4 || s("violence/graphic") > 0.3 || s("self-harm") > 0.2 ||
      s("hate") > 0.4 || s("harassment/threatening") > 0.4 || s("illicit") > 0.5
    : s("sexual") > 0.4 || s("violence") > 0.6 || s("violence/graphic") > 0.5 || s("self-harm") > 0.4 ||
      s("hate") > 0.6 || s("harassment/threatening") > 0.6;
  return review ? "review" : "live";
}

/** Checks the photo (and its question) with OpenAI's free moderation. No key or an error: a person reviews it. */
export async function moderate(imageDataUrl: string, question: string, visibility: string): Promise<{ verdict: Verdict; scores: Scores }> {
  if (!OPENAI_KEY) return { verdict: "review", scores: { unchecked: 1 } };
  try {
    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "omni-moderation-latest",
        input: [
          { type: "text", text: question },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`moderation ${res.status}`);
    const body = (await res.json()) as { results?: { category_scores?: Scores }[] };
    const scores = body.results?.[0]?.category_scores;
    if (!scores) throw new Error("moderation: no scores");
    return { verdict: verdictFor(scores, visibility), scores };
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return { verdict: "review", scores: { error: 1 } };
  }
}
