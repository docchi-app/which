"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ACTIVITY_SEEN, fetchActivity } from "@/lib/activity";
import { PROPS_CHANGED, propsNews } from "@/lib/props";
import { isSignedIn, onUserChange } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase";
import { showTip } from "@/lib/tips";
import { BellIcon } from "./icons";
import { useFriendRequests } from "./NavBadge";

// New votes, comments or props on my polls. One check shared by every bell on screen
// (the header's and the feed's slim bar), started by the first and stopped with the last.
let news = false;
const subscribers = new Set<(v: boolean) => void>();
let stopChecking: (() => void) | null = null;

function setNews(v: boolean) {
  news = v;
  subscribers.forEach((f) => f(v));
}

function startChecking(): () => void {
  if (!isSupabaseConfigured) return () => {};
  let signedIn = false;
  const check = () => {
    if (!signedIn) return setNews(false);
    Promise.all([fetchActivity(), propsNews().catch(() => 0)])
      .then(([a, props]) => {
        const any = a.votes + a.comments + props > 0;
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
  window.addEventListener(PROPS_CHANGED, check);
  document.addEventListener("visibilitychange", back);
  return () => {
    stop();
    window.removeEventListener(ACTIVITY_SEEN, cleared);
    window.removeEventListener(PROPS_CHANGED, check);
    document.removeEventListener("visibilitychange", back);
  };
}

function useNews() {
  const [v, setV] = useState(news);
  useEffect(() => {
    subscribers.add(setV);
    if (subscribers.size === 1) stopChecking = startChecking();
    return () => {
      subscribers.delete(setV);
      if (!subscribers.size) {
        stopChecking?.();
        stopChecking = null;
      }
    };
  }, []);
  return v;
}

/** Top-right bell: friend requests and new votes or comments on your polls. `mini`: the small one on the feed's slim bar. */
export function Bell({ mini = false, hidden = false }: { mini?: boolean; hidden?: boolean } = {}) {
  const requests = useFriendRequests();
  const hasNews = useNews();
  // Looking at Activity right now: nothing to point at.
  const here = usePathname() === "/activity";

  const count = here ? 0 : requests;
  const dot = !here && hasNews;
  const label = count
    ? `Activity: ${count} friend ${count === 1 ? "request" : "requests"}`
    : dot
      ? "Activity: new votes on your polls"
      : "Activity";

  return (
    <Link
      href="/activity"
      aria-label={label}
      className={mini ? "bell-mini press" : "icon-btn press bell-btn"}
      data-tip={mini ? undefined : "bell"}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
    >
      <BellIcon size={mini ? 18 : 22} />
      {count > 0 ? <span className="nav-badge">{count > 9 ? "9+" : count}</span> : dot && <span className="nav-dot" />}
    </Link>
  );
}
