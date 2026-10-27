import type { Metadata } from "next";
import { Feed } from "@/components/Feed";
import { getSharedPoll } from "@/lib/server-poll";

type Props = { params: Promise<{ id: string }> };

// A shared poll's own link: the feed opens on this poll, and the page tells
// WhatsApp, X and friends what to show (see opengraph-image.tsx).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
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
      openGraph: { title, description, type: "website", siteName: "Eithr", url: `/p/${poll.id}` },
      twitter: { card: "summary_large_image", title, description },
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
    openGraph: { title, description, type: "website", siteName: "Eithr", url: `/p/${poll.id}` },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PollPage({ params }: Props) {
  const { id } = await params;
  return <Feed initialPollId={id} />;
}
