import { getSupabase } from "./supabase";

export type ShareChannel = "native" | "whatsapp" | "x" | "copy";

/** The poll's own link, tagged with where it was shared (?src=…). */
export const pollUrl = (pollId: string, channel: ShareChannel) =>
  `${window.location.origin}/p/${pollId}?src=${channel}`;

/** Never gives away the result: friends vote to find out. */
export const shareText = (question: string, voted: boolean) =>
  voted ? `I picked my side on "${question}" Which one are you?` : `${question} Pick a side:`;

/** Counts toward the leaderboard (once per person per poll). Fire and forget. */
export function recordShare(pollId: string, channel: ShareChannel) {
  getSupabase()
    ?.rpc("record_share", { poll: pollId, channel })
    .then(
      () => {},
      () => {},
    );
}
