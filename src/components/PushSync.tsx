"use client";

import { useEffect } from "react";
import { isSignedIn, onUserChange } from "@/lib/auth";
import { captureInstallPrompt } from "@/lib/install";
import { registerWorker, syncPush } from "@/lib/push";
import { isSupabaseConfigured } from "@/lib/supabase";

/** Registers the service worker, keeps Chrome's install prompt for later, and keeps this device's push subscription linked to whoever is signed in. */
export function PushSync() {
  useEffect(() => {
    // Chrome only offers "Install" to sites with a service worker, so it's registered even without push.
    captureInstallPrompt();
    registerWorker();
    if (!isSupabaseConfigured || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return;
    let synced: string | null = null;
    return onUserChange((user) => {
      if (user && isSignedIn(user) && synced !== user.id) {
        synced = user.id;
        syncPush();
      }
    });
  }, []);
  return null;
}
