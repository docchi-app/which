import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Privacy · Docchi" };

export default function PrivacyPage() {
  return (
    <LegalPage
      path="/privacy"
      title="Privacy policy"
      intro="We collect as little as we can to run Docchi. We don't sell your data and there are no ads."
    >
      <h2>What we collect</h2>
      <ul>
        <li><strong>From Google, when you sign in:</strong> your name, email address and profile photo. Your name and photo help suggest a username; your email is never shown to anyone.</li>
        <li><strong>What you do on Docchi:</strong> your username, the polls you post, your votes, shares, friends, friend requests and lists, link-only polls you&apos;ve opened, blocks and reports.</li>
        <li><strong>Snap photos:</strong> shrunk on your phone (location data removed) before upload. They&apos;re deleted after the snap&apos;s 24 hours, or when it&apos;s turned down.</li>
        <li><strong>Props:</strong> when you give a friend props, we store who you picked, for which question, and when. That&apos;s needed for the daily limit and for safety.</li>
        <li><strong>Visits:</strong> a random ID stored in your browser, which days you opened Docchi and how many times. We use it to count visitors and see whether people come back. It isn&apos;t linked to ads or other sites.</li>
        <li><strong>Technical logs</strong> kept by our hosting providers (like IP address and browser) for security, for a short time.</li>
      </ul>

      <h2>Who sees what</h2>
      <ul>
        <li><strong>Everyone:</strong> your username, photo and public polls. Votes on public polls are only shown as totals.</li>
        <li><strong>Your friends:</strong> your friends list, your friends-only polls and who picked what on them, and that you voted on a poll they also voted on (never your pick).</li>
        <li><strong>Props are anonymous:</strong> the friend you picked sees only that a friend gave them props for a question, and their own counts. Nobody, including them, is ever shown who picked them. Your counts are visible only to you, unless you share them.</li>
        <li><strong>Docchi&apos;s team:</strong> reports and the content they point to, to keep the app safe.</li>
        <li><strong>Service providers</strong> that run Docchi for us: Supabase (database, sign-in and snap photos), Vercel (hosting) and OpenAI (an automatic safety check of snap photos before they go live; it isn&apos;t used to train their models). They process data only to provide their service.</li>
        <li><strong>Authorities</strong>, only when Indian law requires it.</li>
      </ul>

      <h2>Cookies and storage</h2>
      <p>
        We use a sign-in cookie to keep you logged in, and your browser&apos;s storage for the visit ID and small settings.
        No advertising or cross-site tracking cookies.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Your account and polls: until you delete them. Deleting your account (Settings → Delete account) removes your profile, polls, snaps, votes, comments and friends right away.</li>
        <li>Deleted or removed polls, reports and comments: kept for up to 180 days for safety reviews, then deleted.</li>
        <li>Visit records: up to 2 years, then deleted.</li>
      </ul>

      <h2>Your choices</h2>
      <ul>
        <li>Change your username, delete polls or make them link-only from your profile.</li>
        <li>Turn off &ldquo;Include me in Props&rdquo; in Settings so friends can&apos;t pick you.</li>
        <li>Delete your account any time from Settings → Delete account.</li>
        <li>Ask us for a copy of your data or to correct it (write to us below).</li>
        <li>Clearing your browser&apos;s site data resets your visit ID.</li>
      </ul>

      <h2>Kids</h2>
      <p>
        Docchi isn&apos;t for children under 13. If you&apos;re under 18, use it only with a parent or guardian&apos;s
        permission. If you think a child is using Docchi without that, tell us and we&apos;ll remove the account.
      </p>
    </LegalPage>
  );
}
