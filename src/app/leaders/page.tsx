import type { Metadata } from "next";
import { LeadersScreen } from "@/components/LeadersScreen";

export const metadata: Metadata = { title: "Leaders · Eithr" };

export default function LeadersPage() {
  return <LeadersScreen />;
}
