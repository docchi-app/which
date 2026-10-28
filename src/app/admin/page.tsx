import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminScreen } from "@/components/AdminScreen";
import { adminGate } from "@/lib/admin-gate";

export const metadata: Metadata = { title: "Admin · Eithr", robots: { index: false } };

/** Only the owner gets the admin; everyone else gets the app's normal "page not found". */
export default async function AdminPage() {
  if ((await adminGate()) === "no") notFound();
  return <AdminScreen />;
}
