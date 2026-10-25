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

// How many waiting requests I've already seen (Activity or Friends): those stop
// counting on the badges but stay listed until I answer them.
const SEEN_KEY = "docchi.requestsSeen";
const REQUESTS_SEEN = "docchi:requests-seen";

function seenRequests() {
  try {
    return Number(localStorage.getItem(SEEN_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** I've just seen `count` waiting requests. */
export function markRequestsSeen(count: number) {
  try {
    localStorage.setItem(SEEN_KEY, String(count));
  } catch {
    // Not remembered; the badge shows again next time.
  }
  window.dispatchEvent(new Event(REQUESTS_SEEN));
}

/** Friend requests waiting for me that I haven't seen yet, kept fresh when anything changes. */
export function useFriendRequests() {
  const [waiting, setWaiting] = useState(0);
  const [seen, setSeen] = useState(0);
  const count = Math.max(0, waiting - seen);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let signedIn = false;
    const refresh = () => {
      setSeen(seenRequests());
      if (!signedIn) return setWaiting(0);
      getCircleBadge()
        .then((n) => {
          // Answered (or withdrawn) requests leave the seen count too.
          if (n < seenRequests()) markRequestsSeen(n);
          setWaiting(n);
        })
        .catch(() => {});
    };
    const onSeen = () => setSeen(seenRequests());
    const stop = onUserChange((user) => {
      signedIn = isSignedIn(user);
      refresh();
    });
    // Accepting or declining a request elsewhere updates the badge at once.
    window.addEventListener(CIRCLE_CHANGED, refresh);
    window.addEventListener(REQUESTS_SEEN, onSeen);
    return () => {
      stop();
      window.removeEventListener(CIRCLE_CHANGED, refresh);
      window.removeEventListener(REQUESTS_SEEN, onSeen);
    };
  }, []);

  return count;
}
