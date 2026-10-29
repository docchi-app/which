import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Privacy · Eithr" };

export default function PrivacyPage() {
  return (
    <LegalPage
      path="/privacy"
      title="Privacy policy"
      intro="We collect as little as we can to run Eithr. We don't sell your data."
    >
      <h2>What we collect</h2>
      <ul>
        <li><strong>From Google, when you sign in:</strong> your name, email address and profile photo. Your name and photo help suggest a username; your email is never shown to anyone. We use it for one thing: if Eithr can&apos;t send notifications to your phone, an email of what you missed (votes, comments, props, friend requests), at most twice a day (at lunch and in the evening) and only when something new is waiting. Turn it off in Settings or from any of those emails.</li>
        <li><strong>What you do on Eithr:</strong> your username, the polls you post, your votes, shares, friends, friend requests and lists, link-only polls you&apos;ve opened, blocks and reports.</li>
        <li><strong>Snap photos:</strong> shrunk on your phone (location data removed) before upload. They&apos;re deleted after the snap&apos;s 24 hours, or when it&apos;s turned down.</li>
        <li><strong>Props:</strong> when you give a friend props, we store who you picked, for which question, and when. That&apos;s needed for the daily limit and for safety.</li>
        <li><strong>Visits:</strong> a random ID stored in your browser, which days you opened Eithr and how many times. We use it to count visitors and see whether people come back. It isn&apos;t shared with other sites.</li>
        <li><strong>Views:</strong> that you saw a poll (its card was on your screen for a second), so we can count how many people saw it. If you&apos;re not signed in, you&apos;re counted as a scrambled code made from your connection and browser, never your IP address itself. Nobody is shown who viewed a poll, only the total.</li>
        <li><strong>Your device and how you found us:</strong> the type of phone and browser (for example &ldquo;iPhone, Safari&rdquo;), whether Eithr is on your Home Screen, what you answered when asked about notifications, and where your first visit came from (for example a shared poll, an invite or Instagram; only the kind of place or a site&apos;s name, never the full address). We use it to see what&apos;s working.</li>
        <li><strong>App errors:</strong> to fix problems, when something breaks we record the error, which screen it was on, the type of phone and browser (for example &ldquo;iPhone, Safari&rdquo;), the app version and whether you were signed in. Never anything you typed, your photos or your IP address. Kept 30 days.</li>
        <li><strong>Technical logs</strong> kept by our hosting providers (like IP address and browser) for security, for a short time.</li>
      </ul>

      <h2>Who sees what</h2>
      <ul>
        <li><strong>Everyone:</strong> your username, photo and public polls. Votes on public polls are only shown as totals.</li>
        <li><strong>Your friends:</strong> your friends list, your friends-only polls and who picked what on them, and that you voted on a poll they also voted on (never your pick).</li>
        <li><strong>Props are anonymous:</strong> the friend you picked sees only that a friend gave them props for a question, and their own counts. Nobody, including them, is ever shown who picked them. Your counts are visible only to you, unless you share them.</li>
        <li><strong>Eithr&apos;s team:</strong> reports and the content they point to, to keep the app safe.</li>
        <li><strong>Service providers</strong> that run Eithr for us: Supabase (database, sign-in and snap photos), Vercel (hosting), Resend (sending those emails) and OpenAI (an automatic safety check of snap photos, typed polls and comments; it isn&apos;t used to train their models). They process data only to provide their service.</li>
        <li><strong>Authorities</strong>, only when Indian law requires it.</li>
      </ul>

      <h2>Cookies and storage</h2>
      <p>
        We use a sign-in cookie to keep you logged in, and your browser&apos;s storage for the visit ID, the polls you&apos;ve already seen (so each counts once) and small settings.
        No cross-site tracking cookies.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Your account and polls: until you delete them. Deleting your account (Settings → Delete account) removes your profile, polls, snaps, votes, comments and friends right away.</li>
        <li>Deleted or removed polls, reports and comments: kept for up to 180 days for safety reviews, then deleted.</li>
        <li>Visit records, and your device and how you found us: up to 2 years, then deleted.</li>
        <li>Who viewed a poll: deleted a day after the poll closes. Only its total stays.</li>
        <li>App errors: 30 days, then deleted.</li>
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
        Eithr isn&apos;t for children under 13. If you&apos;re under 18, use it only with a parent or guardian&apos;s
        permission. If you think a child is using Eithr without that, tell us and we&apos;ll remove the account.
      </p>
    </LegalPage>
  );
}
