import { getSupabase } from "./supabase";
import type { CardInput } from "./preview";
import type { Poll } from "./types";

export type ShareChannel = "native" | "whatsapp" | "x" | "copy";

/** The poll's own link, tagged with where it was shared (?src=…). */
export const pollUrl = (pollId: string, channel: ShareChannel) =>
  `${window.location.origin}/p/${pollId}?src=${channel}`;

/** Never gives away the result (or a mystery poll's question): friends vote to find out. */
export function shareText(poll: Poll): string {
  const voted = poll.myOptionId !== null;
  if (poll.visibility === "circle") return `A poll for my friends on Docchi:`;
  if (poll.kind === "mystery") return `Mystery poll: ${poll.teaser} Pick on gut, the question shows after:`;
  if (poll.kind === "hot_take") return `Hot take: "${poll.question}" Agree or disagree?`;
  if (poll.kind === "snap") return `📸 ${poll.question} Vote before it disappears:`;
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

/** The poll as the share card needs it (same shape the server image uses). */
export function cardInput(poll: Poll): CardInput {
  return {
    // A snap's photo is private, so its card is drawn like a classic poll.
    kind: poll.kind === "snap" ? "classic" : poll.kind,
    question: poll.question,
    teaser: poll.teaser,
    circle: poll.visibility === "circle",
    creator: poll.creator,
    verified: poll.isSystem,
    voteCount: poll.voteCount,
    options: poll.options.map((o) => o.text),
    closed: new Date(poll.closesAt).getTime() <= Date.now(),
  };
}

const warmed = new Set<string>();

/**
 * Asks the server to build this poll's link page and preview image now, in
 * the background, so they're cached by the time WhatsApp or X fetch the link.
 * Reads the page first and warms the exact image URL it lists. Once per poll
 * per visit.
 */
export function warmShareCard(pollId: string) {
  if (warmed.has(pollId)) return;
  warmed.add(pollId);
  const quiet = { priority: "low" } as RequestInit;
  fetch(`/p/${pollId}`, quiet)
    .then((r) => r.text())
    .then((html) => {
      const img = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/.exec(html)?.[1];
      const url = img ? new URL(img.replace(/&amp;/g, "&"), window.location.origin) : null;
      // Same site only; fall back to the plain image path.
      const path = url && url.origin === window.location.origin ? url.pathname + url.search : `/p/${pollId}/opengraph-image`;
      return fetch(path, quiet);
    })
    .catch(() => {});
}
