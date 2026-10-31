import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Feed } from "@/components/Feed";
import { parseLinkSlug } from "@/lib/groups";
import { sharedPollMetadata } from "@/lib/poll-metadata";
import { getLinkPoll } from "@/lib/server-poll";

type Props = { params: Promise<{ slug: string }> };

// A group link from WhatsApp: /v/<code> opens the poll; /v/<code><n> (a quick vote link) opens it
// and votes answer n. Opening the page never votes by itself (WhatsApp opens links to draw the
// preview): the vote is cast in the browser, after the page has loaded (PollCard).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const link = parseLinkSlug((await params).slug);
  const id = link ? await getLinkPoll(link.code) : null;
  if (!id) return { title: "Eithr? Pick a side.", robots: { index: false } };
  return { ...(await sharedPollMetadata(id, `/p/${id}/opengraph-image`)), robots: { index: false, follow: false } };
}

export default async function GroupLinkPage({ params }: Props) {
  const link = parseLinkSlug((await params).slug);
  const id = link ? await getLinkPoll(link.code) : null;
  if (!link || !id) notFound();
  return <Feed initialPollId={id} via={{ code: link.code, pick: link.pick }} />;
}
