import type { Metadata } from "next";
import { ActivityScreen } from "@/components/ActivityScreen";

export const metadata: Metadata = { title: "Activity · Docchi" };

export default function ActivityPage() {
  return <ActivityScreen />;
}
