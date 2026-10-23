import type { Metadata } from "next";
import { Feed } from "@/components/Feed";
import { getSharedPoll } from "@/lib/server-poll";

type Props = { params: Promise<{ id: string }> };

// A shared poll's own link: the feed opens on this poll, and the page tells
// WhatsApp, X and friends what to show (see opengraph-image.tsx).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const poll = await getSharedPoll(id);
  if (!poll) return { title: "Docchi. Which one?" };
  const votes = `${poll.voteCount.toLocaleString("en-US")} ${poll.voteCount === 1 ? "vote" : "votes"}`;
  const description = poll.closed
    ? `${votes}. See where everyone landed on Docchi.`
    : `${votes} so far. Pick a side to see the results.`;
  return {
    title: `${poll.question} · Docchi`,
    description,
    alternates: { canonical: `/p/${poll.id}` },
    openGraph: { title: poll.question, description, type: "website", siteName: "Docchi", url: `/p/${poll.id}` },
    twitter: { card: "summary_large_image", title: poll.question, description },
  };
}

export default async function PollPage({ params }: Props) {
  const { id } = await params;
  return <Feed initialPollId={id} />;
}
