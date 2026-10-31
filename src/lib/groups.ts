// Group links: a poll sent to a WhatsApp group. "Quick vote links" (the default) put one link per
// answer in the message, /v/<code><n>: one tap opens the poll and votes that answer. "Just the
// link" is /v/<code>. Votes made through a link count toward that chat's own split ("This chat's
// verdict"), with counts only, never names. See supabase/migrations/20261215000000_groups_friend_picks.sql.

import { getSupabase } from "./supabase";
import type { Poll } from "./types";

export type LinkStyle = "quick" | "link";

export type Verdict = {
  pollId: string;
  /** Who shared the link (null for a guest). */
  asker: string | null;
  /** It's my link. */
  mine: boolean;
  /** Votes made through this link. */
  total: number;
  /** I've voted on this poll. */
  voted: boolean;
  /** Votes per answer through this link, once I've voted (or it's mine, or it closed). */
  options: { id: string; votes: number }[] | null;
};

type RawVerdict = { poll_id: string; asker: string | null; mine: boolean; total: number; voted: boolean; options: { id: string; votes: number }[] | null };

const toVerdict = (r: RawVerdict | null): Verdict | null =>
  r ? { pollId: r.poll_id, asker: r.asker, mine: r.mine, total: r.total, voted: r.voted, options: r.options } : null;

/** A link's code and, for a quick vote link, the answer's place (1–4). */
export function parseLinkSlug(slug: string): { code: string; pick: number | null } | null {
  const m = /^([0-9a-f]{10})([1-4])?$/.exec(slug.toLowerCase());
  return m ? { code: m[1], pick: m[2] ? Number(m[2]) : null } : null;
}

export const linkUrl = (code: string, pick?: number) => `${window.location.origin}/v/${code}${pick ?? ""}`;

/** A new group link for this poll, or null (friends-only poll, demo mode, a limit or an error). */
export async function makeShareLink(pollId: string, style: LinkStyle): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("make_share_link", { poll: pollId, style });
  return error ? null : (data as string);
}

/** The share button was tapped with this link. Fire and forget. */
export function markLinkShared(code: string) {
  getSupabase()
    ?.rpc("mark_link_shared", { code })
    .then(
      () => {},
      () => {},
    );
}

/** After voting from a group link: my vote joins that chat's count. Returns the verdict. */
export async function linkVote(code: string): Promise<Verdict | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("link_vote", { code });
  if (error) throw error;
  return toVerdict(data as RawVerdict | null);
}

export async function linkVerdict(code: string): Promise<Verdict | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("link_verdict", { code });
  if (error) throw error;
  return toVerdict(data as RawVerdict | null);
}

/** Takes back a vote a quick vote link made (within 15 seconds), so I can pick again. Group links only. */
export async function undoVote(pollId: string, code: string): Promise<void> {
  const { error } = (await getSupabase()?.rpc("undo_vote", { poll: pollId, code })) ?? {};
  if (error) throw error;
}

/** Group links work for polls anyone with the link can vote on, while they're open. */
export const canUseGroupLinks = (poll: Poll) =>
  poll.visibility !== "circle" && !poll.locked && new Date(poll.closesAt).getTime() > Date.now();

/** The message with one link per answer. Never gives away a mystery poll's question. */
export function quickVoteText(poll: Poll, code: string): string {
  const head =
    poll.kind === "mystery"
      ? `Mystery poll: ${poll.teaser} Pick on gut, the question shows after.`
      : poll.kind === "hot_take"
        ? `Hot take: "${poll.question}"`
        : poll.kind === "snap"
          ? `📸 ${poll.question}`
          : poll.kind === "brain"
            ? `🧠 Dimaag lagao: ${poll.question}`
            : `${poll.question}`;
  const lines = poll.options.map((o, i) => `${poll.kind === "hot_take" ? (i === 0 ? "👍" : "👎") : `${"ABCD"[i]} ·`} ${o.text}: ${linkUrl(code, i + 1)}`);
  return `${head}\nTap your pick 👇\n${lines.join("\n")}`;
}

/** "This chat's verdict" as text for the chat, with little bars. */
export function verdictText(poll: Poll, v: Verdict, code: string): string {
  const counts = poll.options.map((o) => ({ text: o.text, n: v.options?.find((x) => x.id === o.id)?.votes ?? 0 }));
  const max = Math.max(1, ...counts.map((c) => c.n));
  const rows = [...counts]
    .sort((a, b) => b.n - a.n)
    .map((c) => `${c.text} ${c.n ? "▓".repeat(Math.max(1, Math.round((c.n / max) * 8))) : "·"} ${c.n}`);
  const about = poll.question ? ` on "${poll.question}"` : "";
  return `This chat's verdict${about}\n${rows.join("\n")}\n${v.total} voted · add yours: ${linkUrl(code)}`;
}
