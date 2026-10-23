"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { canVote, continueWithGoogle, onUserChange, saveReturnTo, signOut } from "@/lib/auth";
import { installPlatform, type InstallPlatform } from "@/lib/install";
import { getMyProfile, type Profile } from "@/lib/profile";
import { isSupabaseConfigured } from "@/lib/supabase";
import { BottomNav } from "./BottomNav";
import { InstallSheet } from "./InstallSheet";
import { NotificationSettings } from "./Notifications";

/** Everything that isn't your polls: notifications, the app, account, policies. */
export function SettingsScreen() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(isSupabaseConfigured ? null : false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [platform, setPlatform] = useState<InstallPlatform | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    // The platform is only known in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlatform(installPlatform());
    if (!isSupabaseConfigured) return;
    return onUserChange((user) => setSignedIn(canVote(user)));
  }, []);

  useEffect(() => {
    if (signedIn) getMyProfile().then(setProfile).catch(() => {});
  }, [signedIn]);

  const installable = platform === "android" || platform === "ios" || platform === "in-app";

  return (
    <div className="screen settings-screen">
      <header className="settings-top">
        <Link href="/profile" className="icon-btn press" aria-label="Back to profile">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>
        <h1 className="settings-title">Settings</h1>
      </header>

      {signedIn && <NotificationSettings />}

      {installable && (
        <section className="settings-group" aria-labelledby="app-title">
          <h2 id="app-title" className="settings-heading">
            The app
          </h2>
          <button type="button" className="settings-row" onClick={() => setInstalling(true)}>
            <span>
              <strong>{platform === "in-app" ? "Open in your browser" : "Add Docchi to your Home Screen"}</strong>
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
            <button
              type="button"
              className="settings-row settings-row-danger"
              onClick={async () => {
                await signOut();
                router.push("/profile");
              }}
            >
              <strong>Sign out</strong>
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
