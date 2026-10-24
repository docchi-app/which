import type { Metadata } from "next";
import { FriendsScreen } from "@/components/FriendsScreen";

export const metadata: Metadata = { title: "Friends · Docchi" };

export default function FriendsPage() {
  return <FriendsScreen />;
}
