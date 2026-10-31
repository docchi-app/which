// Brain breaks: polls with a right answer. The answer and the why stay on the server until you've
// answered (brain_reveal checks your vote, or for a guest the pick they made).
import { getSupabase } from "./supabase";

export type BrainReveal = { optionId: string; why: string; sort: string; right: boolean | null; rightPct: number | null; flagged: boolean };

/** The right answer once you've answered, or null (not yet, not a Brain break, or before the migration). */
export async function brainReveal(pollId: string, pick: string | null): Promise<BrainReveal | null> {
  const { data, error } = (await getSupabase()?.rpc("brain_reveal", { poll: pollId, pick })) ?? { data: null, error: null };
  if (error || !data || typeof data !== "object") return null;
  const r = data as Record<string, unknown>;
  return {
    optionId: String(r.option_id),
    why: String(r.why ?? ""),
    sort: String(r.sort ?? ""),
    right: typeof r.right === "boolean" ? r.right : null,
    rightPct: typeof r.right_pct === "number" ? r.right_pct : null,
    flagged: r.flagged === true,
  };
}

/** "Wrong answer?": tells the admin. */
export async function flagBrain(pollId: string): Promise<void> {
  const { error } = (await getSupabase()?.rpc("brain_flag", { poll: pollId })) ?? { error: null };
  if (error) throw new Error(error.message);
}

/** Your right answers so far (for your own profile), or null before the migration. */
export async function myBrainScore(): Promise<{ right: number; tried: number } | null> {
  const { data, error } = (await getSupabase()?.rpc("my_brain_score")) ?? { data: null, error: null };
  if (error || !data || typeof data !== "object") return null;
  const r = data as Record<string, unknown>;
  return { right: Number(r.right ?? 0), tried: Number(r.tried ?? 0) };
}

/** The line after answering: never "Wrong!", always "you're not alone". */
export function brainLine(right: boolean, rightPct: number | null) {
  if (right) {
    if (rightPct === null || rightPct >= 70) return "Big brain energy 🧠✨ You got it.";
    return `Big brain energy 🧠✨ Only ${rightPct}% got this.`;
  }
  const fell = rightPct === null ? null : 100 - rightPct;
  return fell && fell > 1 ? `Arre yaar 😅 ${fell}% fell for it too. Not just you.` : "Arre yaar 😅 So close. Next one's yours.";
}

/** The heading over the why. */
export const brainWhyTitle = (sort: string) => (sort === "twister" ? "Here's the twist" : sort === "teaser" ? "Here's the trick" : sort === "myth" ? "The real story" : "Here's why");
