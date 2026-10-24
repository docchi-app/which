"use client";

import { useEffect, useState } from "react";
import { ACTIVITY_SEEN, fetchActivity } from "@/lib/activity";
import { isSignedIn, onUserChange } from "@/lib/auth";
import { CIRCLE_CHANGED, getCircleBadge } from "@/lib/circle";
import { isSupabaseConfigured } from "@/lib/supabase";
import { showTip } from "@/lib/tips";

/**
 * On the Profile tab: a red count for circle requests waiting for you, or
 * (with none) a small dot when your polls have new votes or comments.
 */
export function NavBadge() {
  const [count, setCount] = useState(0);
  const [news, setNews] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let signedIn = false;
    const refresh = () => {
      if (!signedIn) {
        setCount(0);
        setNews(false);
        return;
      }
      getCircleBadge()
        .then(setCount)
        .catch(() => {});
      fetchActivity()
        .then((a) => {
          const any = a.votes + a.comments > 0;
          setNews(any);
          if (any && window.location.pathname !== "/profile") showTip("activity");
        })
        .catch(() => {});
    };
    const stop = onUserChange((user) => {
      signedIn = isSignedIn(user);
      refresh();
    });
    const cleared = () => setNews(false);
    // Accepting or declining a request elsewhere updates the badge at once.
    window.addEventListener(CIRCLE_CHANGED, refresh);
    window.addEventListener(ACTIVITY_SEEN, cleared);
    return () => {
      stop();
      window.removeEventListener(CIRCLE_CHANGED, refresh);
      window.removeEventListener(ACTIVITY_SEEN, cleared);
    };
  }, []);

  if (count) {
    return (
      <span className="nav-badge" aria-label={`${count} circle ${count === 1 ? "request" : "requests"}`}>
        {count > 9 ? "9+" : count}
      </span>
    );
  }
  return news ? <span className="nav-dot" aria-label="New activity on your polls" /> : null;
}
