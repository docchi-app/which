import type { Metadata } from "next";
import { Feed } from "@/components/Feed";
import { sharedPollMetadata } from "@/lib/poll-metadata";

type Props = { params: Promise<{ id: string }> };

// A shared poll's own link: the feed opens on this poll, and the page tells
// WhatsApp, X and friends what to show (see opengraph-image.tsx).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return sharedPollMetadata(id);
}

export default async function PollPage({ params }: Props) {
  const { id } = await params;
  return <Feed initialPollId={id} />;
}
