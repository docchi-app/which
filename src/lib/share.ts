import { getSupabase } from "./supabase";
import type { Poll } from "./types";

export type ShareChannel = "native" | "whatsapp" | "x" | "copy";

/** The poll's own link, tagged with where it was shared (?src=…). */
export const pollUrl = (pollId: string, channel: ShareChannel) =>
  `${window.location.origin}/p/${pollId}?src=${channel}`;

/** Never gives away the result (or a mystery poll's question): friends vote to find out. */
export function shareText(poll: Poll): string {
  const voted = poll.myOptionId !== null;
  if (poll.kind === "mystery") return `Mystery poll: ${poll.teaser} Pick on gut, the question shows after:`;
  if (poll.kind === "hot_take") return `Hot take: "${poll.question}" Agree or disagree?`;
  return voted ? `I picked my side on "${poll.question}" Which one are you?` : `${poll.question} Pick a side:`;
}

/** Counts toward the leaderboard (once per person per poll). Fire and forget. */
export function recordShare(pollId: string, channel: ShareChannel) {
  getSupabase()
    ?.rpc("record_share", { poll: pollId, channel })
    .then(
      () => {},
      () => {},
    );
}
