"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ACTIVITY_SEEN, fetchActivity } from "@/lib/activity";
import { isSignedIn, onUserChange } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase";
import { showTip } from "@/lib/tips";
import { BellIcon } from "./icons";
import { useFriendRequests } from "./NavBadge";

/** Top-right bell: friend requests and new votes or comments on your polls. */
export function Bell() {
  const requests = useFriendRequests();
  const [news, setNews] = useState(false);
  // Looking at Activity right now: nothing to point at.
  const here = usePathname() === "/activity";

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let signedIn = false;
    const check = () => {
      if (!signedIn) return setNews(false);
      fetchActivity()
        .then((a) => {
          const any = a.votes + a.comments > 0;
          setNews(any);
          if (any) showTip("activity");
        })
        .catch(() => {});
    };
    const stop = onUserChange((user) => {
      signedIn = isSignedIn(user);
      check();
    });
    const cleared = () => setNews(false);
    // Back in the app after a while: check again, so the dot is never stale.
    const back = () => document.visibilityState === "visible" && check();
    window.addEventListener(ACTIVITY_SEEN, cleared);
    document.addEventListener("visibilitychange", back);
    return () => {
      stop();
      window.removeEventListener(ACTIVITY_SEEN, cleared);
      document.removeEventListener("visibilitychange", back);
    };
  }, []);

  const count = here ? 0 : requests;
  const dot = !here && news;
  const label = count
    ? `Activity: ${count} friend ${count === 1 ? "request" : "requests"}`
    : dot
      ? "Activity: new votes on your polls"
      : "Activity";

  return (
    <Link href="/activity" aria-label={label} className="icon-btn press bell-btn" data-tip="bell">
      <BellIcon size={22} />
      {count > 0 ? <span className="nav-badge">{count > 9 ? "9+" : count}</span> : dot && <span className="nav-dot" />}
    </Link>
  );
}
