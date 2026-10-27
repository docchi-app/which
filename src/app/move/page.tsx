import type { Metadata } from "next";
import { MoveArrival } from "@/components/MoveArrival";

export const metadata: Metadata = { title: "Welcome · Eithr", robots: { index: false } };

export default function MovePage() {
  return <MoveArrival />;
}
