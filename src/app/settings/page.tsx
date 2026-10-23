import type { Metadata } from "next";
import { SettingsScreen } from "@/components/SettingsScreen";

export const metadata: Metadata = { title: "Settings · Docchi" };

export default function SettingsPage() {
  return <SettingsScreen />;
}
