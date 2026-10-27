import type { Metadata } from "next";
import { LogoMark } from "@/components/Logo";

export const metadata: Metadata = { title: "Offline · Eithr" };

// Kept by the service worker and shown when a page can't load without a connection.
export default function OfflinePage() {
  return (
    <main className="offline-screen">
      <LogoMark size={72} />
      <h1 className="offline-title">You&apos;re offline</h1>
      <p className="offline-text">Eithr needs a connection to load polls and votes. Check your Wi-Fi or data, then try again.</p>
      {/* A plain link (a full load), so it works even before the app's scripts load. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="btn btn-coral press">
        Try again
      </a>
    </main>
  );
}
