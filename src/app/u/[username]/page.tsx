import type { Metadata } from "next";
import { PublicProfileScreen } from "@/components/PublicProfileScreen";
import { getSharedProfile } from "@/lib/server-poll";

type Props = { params: Promise<{ username: string }> };

// Someone's profile, and their circle link: people open it to ask to join.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const person = await getSharedProfile(username);
  if (!person) return { title: "Docchi. Which one?" };
  const title = `@${person.username} on Docchi`;
  const description = `Ask to join @${person.username}'s circle to vote on the polls they share with friends.`;
  return {
    title,
    description,
    alternates: { canonical: `/u/${person.username}` },
    openGraph: { title, description, type: "profile", siteName: "Docchi", url: `/u/${person.username}` },
    twitter: { card: "summary", title, description },
  };
}

export default async function UserPage({ params }: Props) {
  const { username } = await params;
  return <PublicProfileScreen username={decodeURIComponent(username).toLowerCase()} />;
}
