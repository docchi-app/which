import { getMyCircle } from "./circle";
import { fetchMyPolls } from "./polls";
import { getMyProfile } from "./profile";
import { recall, remember } from "./screen-cache";
import { fetchStreak } from "./streak";

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
