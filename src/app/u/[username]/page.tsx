import type { Metadata } from "next";
import { PublicProfileScreen } from "@/components/PublicProfileScreen";
import { getSharedProfile } from "@/lib/server-poll";

type Props = { params: Promise<{ username: string }> };

// Someone's profile (and, with ?invite=…, their invite link).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const person = await getSharedProfile(username);
  if (!person) return { title: "Eithr? Pick a side." };
  const title = `@${person.username} on Eithr`;
  const description = `Add @${person.username} as a friend on Eithr and vote on the polls they share with friends.`;
  return {
    title,
    description,
    alternates: { canonical: `/u/${person.username}` },
    openGraph: { title, description, type: "profile", siteName: "Eithr", url: `/u/${person.username}` },
    twitter: { card: "summary", title, description },
  };
}

export default async function UserPage({ params }: Props) {
  const { username } = await params;
  return <PublicProfileScreen username={decodeURIComponent(username).toLowerCase()} />;
}
