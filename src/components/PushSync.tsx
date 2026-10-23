"use client";

import { useEffect } from "react";
import { canVote, onUserChange } from "@/lib/auth";
import { registerWorker, syncPush } from "@/lib/push";
import { isSupabaseConfigured } from "@/lib/supabase";

/** Registers the service worker and keeps this device's push subscription linked to whoever is signed in. */
export function PushSync() {
  useEffect(() => {
    if (!isSupabaseConfigured || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return;
    registerWorker();
    let synced: string | null = null;
    return onUserChange((user) => {
      if (user && canVote(user) && synced !== user.id) {
        synced = user.id;
        syncPush();
      }
    });
  }, []);
  return null;
}
