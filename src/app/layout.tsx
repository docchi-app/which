import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, DM_Sans } from "next/font/google";
import { siteUrl } from "@/lib/server-poll";
import { UsernameGate } from "@/components/UsernameGate";
import { VisitTracker } from "@/components/VisitTracker";
import { PushSync } from "@/components/PushSync";
import { OfflineBar } from "@/components/OfflineBar";
import { SignedOutSheet } from "@/components/SignedOutSheet";
import { MoveSheet } from "@/components/MoveSheet";
import { MovedWelcome } from "@/components/MovedWelcome";
import { InAppNotify } from "@/components/InAppNotify";
import { MomentAsk } from "@/components/MomentAsk";
import { TipLayer } from "@/components/TipLayer";
import { ErrorCatcher } from "@/components/ErrorCatcher";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["600", "800"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: "Eithr? Pick a side.",
  description: "Tap a side. See where everyone else landed.",
  applicationName: "Eithr",
  appleWebApp: { capable: true, title: "Eithr", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#FFF7EC",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Android: the keyboard shrinks the page instead of covering it, so Send / Post and the
  // box you're typing in stay above it.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bricolage.variable} ${dmSans.variable}`}>
      <head>
        {/* Chrome can offer "Install" before the app has loaded; keep it for the install sheet. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__docchiInstall=e});",
          }}
        />
      </head>
      <body>
        <ErrorCatcher />
        {children}
        <UsernameGate />
        <VisitTracker />
        <PushSync />
        <TipLayer />
        <OfflineBar />
        <SignedOutSheet />
        <MoveSheet />
        <MovedWelcome />
        <InAppNotify />
        <MomentAsk />
      </body>
    </html>
  );
}
