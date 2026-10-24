"use client";

import Link from "next/link";
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

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const stop = onUserChange((user) => {
      if (!isSignedIn(user)) return setNews(false);
      fetchActivity()
        .then((a) => {
          const any = a.votes + a.comments > 0;
          setNews(any);
          if (any) showTip("activity");
        })
        .catch(() => {});
    });
    const cleared = () => setNews(false);
    window.addEventListener(ACTIVITY_SEEN, cleared);
    return () => {
      stop();
      window.removeEventListener(ACTIVITY_SEEN, cleared);
    };
  }, []);

  const label = requests
    ? `Activity: ${requests} friend ${requests === 1 ? "request" : "requests"}`
    : news
      ? "Activity: new votes on your polls"
      : "Activity";

  return (
    <Link href="/activity" aria-label={label} className="icon-btn press bell-btn" data-tip="bell">
      <BellIcon size={22} />
      {requests > 0 ? <span className="nav-badge">{requests > 9 ? "9+" : requests}</span> : news && <span className="nav-dot" />}
    </Link>
  );
}
