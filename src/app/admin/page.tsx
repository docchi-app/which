import type { Metadata } from "next";
import { AdminScreen } from "@/components/AdminScreen";

export const metadata: Metadata = { title: "Admin · Eithr", robots: { index: false } };

export default function AdminPage() {
  return <AdminScreen />;
}
