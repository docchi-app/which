import { currentOrGuest, rememberGuestPick, SignInRequired } from "./auth";
import { getSupabase } from "./supabase";
import type { FeedTab, LiveCounts, Poll, PollKind, PollOption, Visibility, VoteResult } from "./types";

type FeedRow = {
  id: string;
  kind?: PollKind;
  question: string | null;
  teaser?: string | null;
  visibility?: Visibility;
  locked?: boolean;
  audience?: string | null;
  is_mine?: boolean;
  share_count?: number;
  view_count?: number;
  creator: string | null;
  is_system: boolean;
  featured_today: boolean;
  vote_count: number;
  comment_count: number;
  created_at: string;
  closes_at: string;
  my_option_id: string | null;
  options: PollOption[];
  cursor?: string | null;
};

type VoteRow = { my_option_id: string; vote_count: number; options: PollOption[]; question?: string };

export const FEED_PAGE_SIZE = 30;

const toPoll = (r: FeedRow): Poll => ({
  id: r.id,
  kind: r.kind ?? "classic",
  question: r.question,
  teaser: r.teaser ?? null,
  visibility: r.visibility ?? "public",
  locked: r.locked ?? false,
  audience: r.audience ?? null,
  isMine: r.is_mine ?? false,
  shareCount: r.share_count ?? 0,
  viewCount: r.view_count ?? 0,
  creator: r.creator ?? "someone",
  isSystem: r.is_system,
  featuredToday: r.featured_today,
  voteCount: r.vote_count,
  commentCount: r.comment_count,
  createdAt: r.created_at,
  closesAt: r.closes_at,
  myOptionId: r.my_option_id,
  options: r.options,
  cursor: r.cursor ?? undefined,
});

/**
 * One page of the feed: open polls you haven't voted on. For the next page,
 * pass the last poll's `cursor` as `after`.
 */
export async function fetchFeed(tab: FeedTab, after?: string, limit = FEED_PAGE_SIZE): Promise<Poll[]> {
  const supabase = getSupabase();
  if (!supabase) return after || tab === "circle" ? [] : demoFeed(tab).slice(0, limit);

  const args = after ? { tab, max_rows: limit, after } : { tab, max_rows: limit };
  const { data, error } = await supabase.rpc("get_feed", args);
  if (error) throw error;
  return (data as FeedRow[]).map(toPoll);
}

/** Polls you made ("mine") or voted on ("voted"), newest first. */
export async function fetchMyPolls(which: "mine" | "voted", after?: string): Promise<Poll[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const args = after ? { which, max_rows: FEED_PAGE_SIZE, after } : { which, max_rows: FEED_PAGE_SIZE };
  const { data, error } = await supabase.rpc("my_polls", args);
  if (error) throw error;
  return (data as FeedRow[]).map(toPoll);
}

/** Someone's public polls, newest first. */
export async function fetchProfilePolls(name: string, after?: string): Promise<Poll[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const args = after ? { name, max_rows: FEED_PAGE_SIZE, after } : { name, max_rows: FEED_PAGE_SIZE };
  const { data, error } = await supabase.rpc("profile_polls", args);
  if (error) throw error;
  return (data as FeedRow[]).map(toPoll);
}

export async function setPollVisibility(pollId: string, visibility: Visibility): Promise<void> {
  const { error } = (await getSupabase()?.rpc("set_poll_visibility", { poll: pollId, visibility })) ?? {};
  if (error) throw error;
}

/** Hidden for everyone (kept on the server for moderation). */
export async function deletePoll(pollId: string): Promise<void> {
  const { error } = (await getSupabase()?.rpc("delete_poll", { poll: pollId })) ?? {};
  if (error) throw error;
}

/** A single poll (for shared links), even if it has closed. */
export async function fetchPoll(id: string): Promise<Poll | null> {
  const supabase = getSupabase();
  if (!supabase) {
    demoTrickle(id);
    return demoFeed("trending").find((p) => p.id === id) ?? null;
  }

  const { data, error } = await supabase.rpc("get_poll", { poll: id });
  if (error) throw error;
  const row = (data as FeedRow[])[0];
  return row ? toPoll(row) : null;
}

// Before the live-feed migration, live_counts doesn't exist: ask for each poll instead.
let liveCountsMissing = false;

/** Votes, views and comments for the cards on screen (at most 12), in one small request. */
/**
 * Live numbers for these polls, and which of them are gone: asked for but not sent back
 * (removed, hidden or deleted since they were loaded). Only the database's answer says a
 * poll is gone; the fallback below can't tell gone from a failed request.
 */
export async function fetchLiveCounts(ids: string[]): Promise<{ rows: LiveCounts[]; gone: string[] }> {
  const supabase = getSupabase();
  const some = ids.slice(0, 12);
  if (!some.length) return { rows: [], gone: [] };
  if (supabase && !liveCountsMissing) {
    const { data, error } = await supabase.rpc("live_counts", { ids: some });
    if (!error) {
      type Row = { id: string; vote_count: number; view_count: number; comment_count: number; recent_votes: number; options: { id: string; votes: number | null }[] };
      const rows = (data as Row[]).map((r) => ({
        id: r.id,
        voteCount: r.vote_count,
        viewCount: r.view_count,
        commentCount: r.comment_count,
        recentVotes: r.recent_votes,
        votes: Object.fromEntries(r.options.map((o) => [o.id, o.votes])),
      }));
      const back = new Set(rows.map((r) => r.id));
      return { rows, gone: some.filter((id) => !back.has(id)) };
    }
    if (error.code !== "PGRST202") throw error;
    liveCountsMissing = true;
  }
  const polls = await Promise.all(some.map((id) => fetchPoll(id).catch(() => null)));
  const rows = polls.flatMap((p) =>
    p
      ? [{ id: p.id, voteCount: p.voteCount, viewCount: p.viewCount ?? 0, commentCount: p.commentCount, recentVotes: p.recentVotes ?? 0, votes: Object.fromEntries(p.options.map((o) => [o.id, o.votes])) }]
      : [],
  );
  return { rows, gone: [] };
}

/** Opened a link-only poll: it shows in my feed from now on. */
export async function recordOpen(pollId: string): Promise<void> {
  await getSupabase()?.rpc("record_open", { poll: pollId });
}

export async function castVote(pollId: string, optionId: string): Promise<VoteResult> {
  const supabase = getSupabase();
  if (!supabase) return demoVote(pollId, optionId);

  // No account yet: vote as a guest. If guests are switched off, ask for Google.
  const user = await currentOrGuest();
  if (!user) throw new SignInRequired();

  const { data, error } = await supabase.rpc("cast_vote", {
    target_poll: pollId,
    target_option: optionId,
  });
  if (error) throw error;
  const row = (data as VoteRow[])[0];
  if (user.is_anonymous) rememberGuestPick({ pollId, optionId: row.my_option_id });
  return { myOptionId: row.my_option_id, voteCount: row.vote_count, options: row.options, question: row.question ?? "" };
}

// ─── Demo mode (no Supabase env vars) ─────────────────────────────────────
// Sample content from the design canvas so the UI can be tried without a
// backend. Never used once NEXT_PUBLIC_SUPABASE_URL is set.

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

const DEMO: Poll[] = [
  demo("d1", "Tea or coffee to start the day?", "eithr", true, -1, 18, 38, [
    ["Coffee", 554], ["Tea", 385], ["Both, obviously", 181], ["Neither", 84],
  ]),
  demo("d2", "Pineapple on pizza: crime or genius?", "pizza_judge", false, -20, 48, 412, [
    ["Crime", 5806], ["Genius", 4034],
  ]),
  demo("d3", "Mountains or beaches for a long weekend?", "weekend_mood", false, -30, 48, 186, [
    ["Mountains", 3896], ["Beaches", 3319],
  ]),
  demo("d4", "Work from home or office?", "desk_life", false, -2, 144, 97, [
    ["Home, forever", 2677], ["Office", 965], ["Hybrid", 746],
  ]),
  {
    ...demo("d5", "Idli is boring. The chutney is doing all the work.", "eithr", false, -3, 60, 211, [
      ["Agree", 2597], ["Disagree", 3305],
    ]),
    kind: "hot_take",
  },
  {
    ...demo("d6", "Where would you go if you quit your job tomorrow?", "eithr", false, -4, 70, 64, [
      ["Mountains", 412], ["A beach shack", 240], ["A new city", 160], ["My bed", 519],
    ]),
    kind: "mystery",
    teaser: "Pick a place. Don't overthink it.",
  },
];

function demo(
  id: string, question: string, creator: string, featured: boolean,
  ageHours: number, closesInHours: number, comments: number, opts: [string, number][],
): Poll {
  return {
    id, kind: "classic", question, teaser: null, visibility: "public", locked: false, audience: null, isMine: false, shareCount: 0, creator, isSystem: creator === "eithr", featuredToday: featured,
    voteCount: opts.reduce((n, [, v]) => n + v, 0),
    commentCount: comments,
    createdAt: hoursFromNow(ageHours),
    closesAt: hoursFromNow(closesInHours),
    myOptionId: null,
    options: opts.map(([text, votes], i) => ({ id: `${id}-${i}`, text, votes })),
  };
}

const demoVotes = new Map<string, string>();

function demoFeed(tab: FeedTab): Poll[] {
  const polls = DEMO.map((p) => {
    const mine = demoVotes.get(p.id) ?? null;
    return {
      ...p,
      myOptionId: mine,
      question: p.kind === "mystery" && !mine ? null : p.question,
      options: p.options.map((o) => ({ ...o, votes: mine ? o.votes : null })),
    };
  });
  if (tab === "new") polls.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // Same rule as get_feed: polls you've voted on go to the end.
  return [...polls.filter((p) => !p.myOptionId), ...polls.filter((p) => p.myOptionId)];
}

async function demoVote(pollId: string, optionId: string): Promise<VoteResult> {
  await new Promise((r) => setTimeout(r, 150));
  const poll = DEMO.find((p) => p.id === pollId)!;
  if (!demoVotes.has(pollId)) {
    demoVotes.set(pollId, optionId);
    poll.voteCount += 1;
    poll.options = poll.options.map((o) => (o.id === optionId ? { ...o, votes: (o.votes ?? 0) + 1 } : o));
  }
  return {
    myOptionId: demoVotes.get(pollId)!,
    voteCount: poll.voteCount,
    options: poll.options,
    question: poll.question ?? "",
  };
}

/** Demo mode: now and then someone else votes, so live updates can be seen. */
function demoTrickle(pollId: string) {
  const poll = DEMO.find((p) => p.id === pollId);
  if (!poll || Math.random() < 0.4) return;
  const k = Math.floor(Math.random() * poll.options.length);
  const added = 1 + Math.floor(Math.random() * 3);
  poll.voteCount += added;
  poll.options = poll.options.map((o, i) => (i === k ? { ...o, votes: (o.votes ?? 0) + added } : o));
}
