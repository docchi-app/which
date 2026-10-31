import type { Metadata } from "next";
import { getSharedPoll } from "./server-poll";

/**
 * What WhatsApp, X and friends show for a shared poll's link (/p/<id>, and a group link /v/<code>
 * opening it). `image`: the preview image's path, for pages that don't have their own.
 */
export async function sharedPollMetadata(id: string, image?: string): Promise<Metadata> {
  const images = image ? [{ url: image, width: 1200, height: 630, alt: "A poll on Eithr. Tap to pick a side." }] : undefined;
  const poll = await getSharedPoll(id);
  if (!poll) return { title: "Eithr? Pick a side." };
  const votes = `${poll.voteCount.toLocaleString("en-US")} ${poll.voteCount === 1 ? "vote" : "votes"}`;
  // A mystery poll's question never goes into a preview: that's the surprise.
  if (poll.circle) {
    const title = `A poll for @${poll.creator}'s friends`;
    const description = "Only their friends can see it. Add them on Eithr.";
    return {
      title: `${title} · Eithr`,
      description,
      openGraph: { title, description, type: "website", siteName: "Eithr", url: `/p/${poll.id}`, images },
      twitter: { card: "summary_large_image", title, description, images },
    };
  }
  const title =
    poll.kind === "mystery"
      ? `Mystery poll: ${poll.teaser}`
      : poll.kind === "hot_take"
        ? `Hot take: ${poll.question}`
        : (poll.question ?? "Eithr");
  const description = poll.closed
    ? `${votes}. See where everyone landed on Eithr.`
    : poll.kind === "mystery"
      ? `${votes} so far. Pick on gut. The question shows up after you tap.`
      : poll.kind === "hot_take"
        ? `${votes} so far. Agree or disagree? See how spicy it is.`
        : `${votes} so far. Pick a side to see the results.`;
  return {
    title: `${title} · Eithr`,
    description,
    alternates: { canonical: `/p/${poll.id}` },
    openGraph: { title, description, type: "website", siteName: "Eithr", url: `/p/${poll.id}`, images },
    twitter: { card: "summary_large_image", title, description, images },
  };
}

