import type { Metadata } from "next";
import { AdminScreen } from "@/components/AdminScreen";

export const metadata: Metadata = { title: "Admin · Docchi", robots: { index: false } };

export default function AdminPage() {
  return <AdminScreen />;
}
