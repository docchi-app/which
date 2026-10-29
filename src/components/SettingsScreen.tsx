"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isSignedIn, continueWithGoogle, onUserChange, saveReturnTo, signOut } from "@/lib/auth";
import { CREATE_PREVIEW_KEY } from "@/lib/create";
import { installPlatform, type InstallPlatform } from "@/lib/install";
import { adminMorning } from "@/lib/admin";
import { emailSummary, getMyProfile, sendTestEmail, type EmailTestResult, type Profile } from "@/lib/profile";
import { propsNoWait, propsState, setPropsOff } from "@/lib/props";
import { isSupabaseConfigured } from "@/lib/supabase";
import { BottomNav } from "./BottomNav";
import { DeleteAccountSheet } from "./DeleteAccountSheet";
import { InstallSheet } from "./InstallSheet";
import { NotificationSettings } from "./Notifications";
import { leaveScreen } from "@/lib/back";

/** Everything that isn't your polls: notifications, the app, account, policies. */
export function SettingsScreen() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(isSupabaseConfigured ? null : false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [platform, setPlatform] = useState<InstallPlatform | null>(null);
  const [installing, setInstalling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Admins: the live preview while typing a poll (this phone only).
  const [preview, setPreview] = useState(false);
  // "Include me in Props" (null until known).
  const [propsOn, setPropsOn] = useState<boolean | null>(null);
  // Admins, for testing: props picked for you arrive without the wait (null until known).
  const [noWait, setNoWait] = useState<boolean | null>(null);
  // Admins: yesterday's numbers in a 9 am push (null until known).
  const [morning, setMorning] = useState<boolean | null>(null);
  // The lunch and evening emails for when notifications can't reach you (null until known).
  const [email, setEmail] = useState<{ on: boolean; hasEmail: boolean } | null>(null);

  useEffect(() => {
    // The platform is only known in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlatform(installPlatform());
    try {
      setPreview(localStorage.getItem(CREATE_PREVIEW_KEY) === "1");
    } catch {
      // Storage blocked: off.
    }
    if (!isSupabaseConfigured) return;
    return onUserChange((user) => setSignedIn(isSignedIn(user)));
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    getMyProfile()
      .then((p) => {
        setProfile(p);
        if (!p?.isAdmin) return;
        propsNoWait().then(setNoWait).catch(() => {});
        adminMorning().then(setMorning).catch(() => {});
      })
      .catch(() => {});
    propsState()
      .then((s) => setPropsOn(!s.off))
      .catch(() => {});
    emailSummary()
      .then(setEmail)
      .catch(() => {});
  }, [signedIn]);

  const installable = platform === "android" || platform === "ios" || platform === "in-app";

  return (
    <div className="screen settings-screen">
      <header className="settings-top">
        <button type="button" className="icon-btn press" aria-label="Back" onClick={() => leaveScreen(router, "/profile")}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <h1 className="settings-title">Settings</h1>
      </header>

      {signedIn && <NotificationSettings />}

      {signedIn && email?.hasEmail && (
        <section className="settings-group" aria-labelledby="email-title">
          <h2 id="email-title" className="settings-heading">
            Email
          </h2>
          <label className="settings-row">
            <span>
              <strong>Email me what I missed</strong>
              <span className="notif-hint">At lunch and in the evening, only when something new is waiting and notifications can&apos;t reach you</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={email.on}
              onChange={(e) => {
                const on = e.target.checked;
                setEmail({ ...email, on });
                emailSummary(!on)
                  .then((r) => r && setEmail(r))
                  .catch(() => setEmail({ ...email, on: !on }));
              }}
            />
          </label>
          {profile?.isAdmin && <EmailTest />}
        </section>
      )}

      {installable && (
        <section className="settings-group" aria-labelledby="app-title">
          <h2 id="app-title" className="settings-heading">
            The app
          </h2>
          <button type="button" className="settings-row" onClick={() => setInstalling(true)}>
            <span>
              <strong>{platform === "in-app" ? "Open in your browser" : "Add Eithr to your Home Screen"}</strong>
              <span className="notif-hint">One tap to open, full screen</span>
            </span>
            <Chevron />
          </button>
          {installing && <InstallSheet reason="app" onClose={() => setInstalling(false)} />}
        </section>
      )}

      <section className="settings-group" aria-labelledby="account-title">
        <h2 id="account-title" className="settings-heading">
          Account
        </h2>
        {signedIn ? (
          <div className="settings-list">
            <div className="settings-row settings-row-static">
              <span>
                <strong>{profile?.username ? `@${profile.username}` : "Signed in"}</strong>
                <span className="notif-hint">Signed in with Google</span>
              </span>
            </div>
            {profile?.isAdmin && (
              <Link href="/admin" className="settings-row">
                <span>
                  <strong>Admin</strong>
                  <span className="notif-hint">Reports and metrics</span>
                </span>
                <Chevron />
              </Link>
            )}
            {profile?.isAdmin && (
              <label className="settings-row">
                <span>
                  <strong>Live preview</strong>
                  <span className="notif-hint">Admins: show the preview while typing a poll (this phone)</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={preview}
                  onChange={(e) => {
                    setPreview(e.target.checked);
                    try {
                      if (e.target.checked) localStorage.setItem(CREATE_PREVIEW_KEY, "1");
                      else localStorage.removeItem(CREATE_PREVIEW_KEY);
                    } catch {
                      // Storage blocked: not saved.
                    }
                  }}
                />
              </label>
            )}
            {profile?.isAdmin && noWait !== null && (
              <label className="settings-row">
                <span>
                  <strong>Props without the wait</strong>
                  <span className="notif-hint">Admins: props picked for you arrive at once, for testing (others still wait 5–30 min)</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={noWait}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setNoWait(on);
                    propsNoWait(on)
                      .then(setNoWait)
                      .catch(() => setNoWait(!on));
                  }}
                />
              </label>
            )}
            {profile?.isAdmin && morning !== null && (
              <label className="settings-row">
                <span>
                  <strong>Morning summary at 9 am</strong>
                  <span className="notif-hint">Admins: a push with yesterday&apos;s visitors, sign-ups, votes and anything waiting</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={morning}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setMorning(on);
                    adminMorning(on)
                      .then(setMorning)
                      .catch(() => setMorning(!on));
                  }}
                />
              </label>
            )}
            <label className="settings-row">
              <span>
                <strong>Include me in Props</strong>
                <span className="notif-hint">Friends can pick you in compliment questions. Always anonymous.</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={propsOn ?? true}
                disabled={propsOn === null}
                onChange={(e) => {
                  const on = e.target.checked;
                  setPropsOn(on);
                  setPropsOff(!on).catch(() => setPropsOn(!on));
                }}
              />
            </label>
            <button
              type="button"
              className="settings-row settings-row-danger"
              onClick={async () => {
                await signOut();
                router.replace("/profile");
              }}
            >
              <strong>Sign out</strong>
            </button>
            <button type="button" className="settings-row settings-row-danger" onClick={() => setDeleting(true)}>
              <span>
                <strong>Delete account</strong>
                <span className="notif-hint">Your polls, votes, comments and friends, for good</span>
              </span>
            </button>
          </div>
        ) : (
          signedIn === false &&
          isSupabaseConfigured && (
            <button
              type="button"
              className="settings-row"
              onClick={async () => {
                saveReturnTo("/settings");
                await continueWithGoogle().catch(() => {});
              }}
            >
              <strong>Sign in with Google</strong>
              <Chevron />
            </button>
          )
        )}
      </section>

      {/* Outside the signed-in part: it stays up to say "deleted" after the sign-out. */}
      {deleting && <DeleteAccountSheet username={profile?.username ?? null} onClose={() => setDeleting(false)} />}

      <section className="settings-group" aria-labelledby="about-title">
        <h2 id="about-title" className="settings-heading">
          About
        </h2>
        <div className="settings-list">
          {[
            ["/guidelines", "Community guidelines"],
            ["/terms", "Terms"],
            ["/privacy", "Privacy"],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="settings-row">
              <strong>{label}</strong>
              <Chevron />
            </Link>
          ))}
        </div>
      </section>

      <BottomNav current="profile" />
    </div>
  );
}

function Chevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

const EMAIL_VERSIONS: { id: string; label: string }[] = [
  { id: "props", label: "Props" },
  { id: "request", label: "Friend requests" },
  { id: "comments", label: "Comments" },
  { id: "first", label: "Votes: first vote" },
  { id: "tie", label: "Votes: a tie" },
  { id: "neck", label: "Votes: neck and neck" },
  { id: "ahead", label: "Votes: one answer ahead" },
  { id: "milestone", label: "Votes: passed 25 votes" },
  { id: "closed", label: "Votes: poll closed" },
];

const EMAIL_TEST_TEXT: Record<Exclude<EmailTestResult, "sent">, string> = {
  not_configured: "Email isn't set up: add RESEND_API_KEY in Vercel (and PUSH_CRON_SECRET), then redeploy.",
  not_admin: "Only the admin can send test emails.",
  too_many: "That's 10 test emails today. Try again tomorrow.",
  no_email: "Your account has no email address.",
  no_migration: "Run 20261204000000_email_test.sql in the Supabase SQL editor first.",
  send_failed: "Resend didn't send it",
  failed: "Couldn't send a test. Try again?",
};

/** Admin: send one sample email (any version) to your own address now, at any hour. */
function EmailTest() {
  const [version, setVersion] = useState("ahead");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setNote(null);
    const r = await sendTestEmail(version);
    if (r.result === "sent") setNote(`Sent to ${r.to}. Check your inbox (and spam).`);
    else setNote(EMAIL_TEST_TEXT[r.result] + (r.detail ? `: ${r.detail}` : "."));
    setBusy(false);
  }

  return (
    <div className="settings-card email-test">
      <p className="notif-text">
        <strong>Send me a test email</strong>
        <span className="notif-hint">Admins: one sample email to your own address, right now. Up to 10 a day.</span>
      </p>
      <div className="email-test-row">
        <select className="field-input" aria-label="Which email" value={version} onChange={(e) => setVersion(e.target.value)}>
          {EMAIL_VERSIONS.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
        <button type="button" className="mini-btn" onClick={send} disabled={busy}>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
      {note && (
        <p className="notif-note" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
