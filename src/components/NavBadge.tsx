"use client";

import { useEffect, useState } from "react";
import { isSignedIn, onUserChange } from "@/lib/auth";
import { CIRCLE_CHANGED, getCircleBadge } from "@/lib/circle";
import { isSupabaseConfigured } from "@/lib/supabase";

/** On the Friends tab: a red count of friend requests waiting for you. */
export function NavBadge() {
  const count = useFriendRequests();
  if (!count) return null;
  return (
    <span className="nav-badge" aria-label={`${count} friend ${count === 1 ? "request" : "requests"}`}>
      {count > 9 ? "9+" : count}
    </span>
  );
}

/** Friend requests waiting for me, kept fresh when anything changes. */
export function useFriendRequests() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let signedIn = false;
    const refresh = () => {
      if (!signedIn) return setCount(0);
      getCircleBadge()
        .then(setCount)
        .catch(() => {});
    };
    const stop = onUserChange((user) => {
      signedIn = isSignedIn(user);
      refresh();
    });
    // Accepting or declining a request elsewhere updates the badge at once.
    window.addEventListener(CIRCLE_CHANGED, refresh);
    return () => {
      stop();
      window.removeEventListener(CIRCLE_CHANGED, refresh);
    };
  }, []);

  return count;
}
