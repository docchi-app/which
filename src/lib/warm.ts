import { getMyCircle, suggestFriends } from "./circle";
import { fetchLeaderboard } from "./leaders";
import { fetchMyPolls } from "./polls";
import { getMyProfile } from "./profile";
import { recall, remember } from "./screen-cache";
import { fetchRecentResults, fetchStreak } from "./streak";

/**
 * Loads Profile in the background (same cache keys ProfileScreen reads), so
 * the first tap on Profile is instant too. Quietly does nothing on failure.
 */
export function warmProfile() {
  if (recall("profile")) return;
  const run = () => {
    getMyProfile()
      .then((p) => p && remember("profile", p))
      .catch(() => {});
    fetchMyPolls("mine")
      .then((list) => remember("profile:polls:mine", list))
      .catch(() => {});
    fetchStreak()
      .then((s) => remember("profile:streak", s))
      .catch(() => {});
    getMyCircle()
      .then((c) => remember("profile:friends", c.members.length))
      .catch(() => {});
  };
  // After the feed has had the network to itself.
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}

/**
 * After Profile, the other tabs (Friends, Leaders, Activity), staggered so
 * they never compete with what's on screen. Same cache keys as each screen.
 */
export function warmTabs() {
  if (recall("friends:circle")) return;
  const run = () => {
    getMyCircle()
      .then((c) => {
        remember("friends:circle", c);
        remember("activity:circle", c);
      })
      .catch(() => {});
    suggestFriends()
      .then((list) => remember("friends:suggested", list))
      .catch(() => {});
    fetchRecentResults()
      .then((r) => remember("activity:results", r))
      .catch(() => {});
    // An empty week falls back to last week, as the screen itself would.
    fetchLeaderboard("creators", "this")
      .then(async (d) => {
        if (d?.rows.length) {
          remember("leaders:creators:this", d);
          remember("leaders:view", { board: "creators", which: "this", fellBack: false });
          return;
        }
        const last = await fetchLeaderboard("creators", "last");
        remember("leaders:creators:last", last);
        remember("leaders:view", { board: "creators", which: "last", fellBack: true });
      })
      .catch(() => {});
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(() => setTimeout(run, 1200), { timeout: 6000 });
  else setTimeout(run, 3000);
}
