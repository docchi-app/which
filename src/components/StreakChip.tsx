"use client";

import { useEffect, useRef, useState } from "react";
import { onUserChange } from "@/lib/auth";
import { fetchStreak, MILESTONES, NO_STREAK, STREAK_CHANGED, type Streak } from "@/lib/streak";
import { isSupabaseConfigured } from "@/lib/supabase";

/** 🔥 N in the feed header: days in a row you've voted. Tap for what it means. */
export function StreakChip() {
  const [streak, setStreak] = useState<Streak>(NO_STREAK);
  const [open, setOpen] = useState(false);
  const [cheer, setCheer] = useState<number | null>(null);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let hasUser = false;
    const refresh = () => {
      if (!hasUser) return setStreak(NO_STREAK);
      fetchStreak()
        .then((s) => {
          // Just reached a milestone with today's vote: celebrate.
          if (last.current !== null && s.current > last.current && s.today && MILESTONES.includes(s.current)) setCheer(s.current);
          last.current = s.current;
          setStreak(s);
        })
        .catch(() => {});
    };
    const stop = onUserChange((user) => {
      hasUser = !!user;
      refresh();
    });
    window.addEventListener(STREAK_CHANGED, refresh);
    return () => {
      stop();
      window.removeEventListener(STREAK_CHANGED, refresh);
    };
  }, []);

  useEffect(() => {
    if (cheer === null) return;
    const t = window.setTimeout(() => setCheer(null), 4000);
    return () => window.clearTimeout(t);
  }, [cheer]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => setOpen(false), 5000);
    return () => window.clearTimeout(t);
  }, [open]);

  if (streak.current < 1) return null;
  const days = `${streak.current}-day streak`;

  return (
    <div className="streak">
      <button
        type="button"
        className={`streak-chip press${streak.today ? "" : " streak-chip-waiting"}`}
        aria-label={streak.today ? days : `${days}. Vote today to keep it.`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">🔥</span>
        {streak.current}
      </button>
      {(open || cheer !== null) && (
        <p className="streak-bubble" role="status">
          {cheer !== null ? (
            <>
              <strong>🔥 {cheer}-day streak!</strong> Keep it going tomorrow.
            </>
          ) : streak.today ? (
            <>
              <strong>{days}.</strong> You&apos;ve voted {streak.current} {streak.current === 1 ? "day" : "days"} in a row. Best:{" "}
              {streak.best}.
            </>
          ) : (
            <>
              <strong>{days}.</strong> Vote today to keep it alive.
            </>
          )}
        </p>
      )}
    </div>
  );
}
