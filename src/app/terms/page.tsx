import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Terms · Docchi" };

export default function TermsPage() {
  return (
    <LegalPage
      path="/terms"
      title="Terms of use"
      intro="These terms are the deal between you and Docchi when you use the app. By signing in or posting, you agree to them."
    >
      <h2>Who can use Docchi</h2>
      <p>
        You need to be at least 13. If you&apos;re under 18, use Docchi only with a parent or guardian&apos;s permission.
        One account per person, and keep your Google account safe: you&apos;re responsible for what&apos;s posted from it.
      </p>

      <h2>Your polls</h2>
      <ul>
        <li>You own what you post. You let Docchi show, share and make link previews of it, as the app does, for as long as it&apos;s on Docchi.</li>
        <li>What you pick is anonymous to other people. Your friends can see that you voted on a poll they also voted on, but not your pick. On a friends-only poll, the friends it&apos;s shared with can see who picked what.</li>
        <li>Follow the <Link href="/guidelines">Community guidelines</Link>. We can remove any poll and suspend any account that breaks them or the law, with or without notice.</li>
        <li>Deleting a poll hides it for everyone. We keep a copy for a while for safety reviews (see <Link href="/privacy">Privacy</Link>).</li>
      </ul>

      <h2>Don&apos;t</h2>
      <ul>
        <li>Use bots, scripts or many accounts to vote, post or report.</li>
        <li>Try to get around limits, bans, blocks or friends-only privacy.</li>
        <li>Copy Docchi&apos;s data in bulk, or attack or overload the service.</li>
      </ul>

      <h2>The service</h2>
      <p>
        Docchi is a free, early-stage app. Features may change or stop, and results are just what people picked, not
        facts or advice. We provide it “as is” and, as far as the law allows, aren&apos;t liable for indirect losses or
        for what other people post.
      </p>

      <h2>Ending things</h2>
      <p>
        You can delete your polls any time from your profile, or ask us to delete your account. We may suspend or close
        accounts that break these terms.
      </p>

      <h2>Changes and law</h2>
      <p>
        If we change these terms, we&apos;ll update the date above; big changes will be shown in the app. These terms are
        governed by the laws of India.
      </p>
    </LegalPage>
  );
}
