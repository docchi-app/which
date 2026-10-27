import type { Metadata } from "next";
import { SnapScreen } from "@/components/SnapScreen";

export const metadata: Metadata = { title: "Quick snap · Eithr" };

export default function SnapPage() {
  return <SnapScreen />;
}
