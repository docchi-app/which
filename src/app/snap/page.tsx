import type { Metadata } from "next";
import { SnapScreen } from "@/components/SnapScreen";

export const metadata: Metadata = { title: "Quick snap · Docchi" };

export default function SnapPage() {
  return <SnapScreen />;
}
