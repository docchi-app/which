import type { Metadata } from "next";
import { ActivityScreen } from "@/components/ActivityScreen";

export const metadata: Metadata = { title: "Activity · Eithr" };

export default function ActivityPage() {
  return <ActivityScreen />;
}
