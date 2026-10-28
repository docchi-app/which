import { getSupabase } from "./supabase";

/**
 * Just posted a typed poll or a comment (it's live already): ask for the AI check
 * of it now. Fire and forget; if it doesn't get through, the 2-minute job checks it.
 */
export function askTextCheck(pollId: string) {
  void (async () => {
    try {
      const token = (await getSupabase()?.auth.getSession())?.data.session?.access_token;
      if (!token) return;
      await fetch("/api/moderate/check", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ poll: pollId }),
        // Keeps going while the app moves on to the feed.
        keepalive: true,
      });
    } catch {
      // Offline or blocked: the job picks it up.
    }
  })();
}
