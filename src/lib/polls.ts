import { getSupabase } from "./supabase";
import type { FeedTab, Poll, PollOption, VoteResult } from "./types";

type FeedRow = {
  id: string;
  question: string;
  creator: string | null;
  is_system: boolean;
  featured_today: boolean;
  vote_count: number;
  comment_count: number;
  created_at: string;
  closes_at: string;
  my_option_id: string | null;
  options: PollOption[];
};

type VoteRow = { my_option_id: string; vote_count: number; options: PollOption[] };

export async function fetchFeed(tab: FeedTab): Promise<Poll[]> {
  const supabase = getSupabase();
  if (!supabase) return demoFeed(tab);

  const { data, error } = await supabase.rpc("get_feed", { tab, max_rows: 30 });
  if (error) throw error;
  return (data as FeedRow[]).map((r) => ({
    id: r.id,
    question: r.question,
    creator: r.creator ?? "someone",
    isSystem: r.is_system,
    featuredToday: r.featured_today,
    voteCount: r.vote_count,
    commentCount: r.comment_count,
    createdAt: r.created_at,
    closesAt: r.closes_at,
    myOptionId: r.my_option_id,
    options: r.options,
  }));
}

export async function castVote(pollId: string, optionId: string): Promise<VoteResult> {
  const supabase = getSupabase();
  if (!supabase) return demoVote(pollId, optionId);

  // Until Google sign-in lands, a first vote creates an anonymous account.
  // Linking Google later keeps the same user id, so these votes carry over.
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
  }

  const { data, error } = await supabase.rpc("cast_vote", {
    target_poll: pollId,
    target_option: optionId,
  });
  if (error) throw error;
  const row = (data as VoteRow[])[0];
  return { myOptionId: row.my_option_id, voteCount: row.vote_count, options: row.options };
}

// ─── Demo mode (no Supabase env vars) ─────────────────────────────────────
// Sample content from the design canvas so the UI can be tried without a
// backend. Never used once NEXT_PUBLIC_SUPABASE_URL is set.

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

const DEMO: Poll[] = [
  demo("d1", "Tea or coffee to start the day?", "docchi", true, -1, 18, 38, [
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
];

function demo(
  id: string, question: string, creator: string, featured: boolean,
  ageHours: number, closesInHours: number, comments: number, opts: [string, number][],
): Poll {
  return {
    id, question, creator, isSystem: creator === "docchi", featuredToday: featured,
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
    return { ...p, myOptionId: mine, options: p.options.map((o) => ({ ...o, votes: mine ? o.votes : null })) };
  });
  if (tab === "new") polls.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return polls;
}

async function demoVote(pollId: string, optionId: string): Promise<VoteResult> {
  await new Promise((r) => setTimeout(r, 150));
  const poll = DEMO.find((p) => p.id === pollId)!;
  if (!demoVotes.has(pollId)) {
    demoVotes.set(pollId, optionId);
    poll.voteCount += 1;
    poll.options = poll.options.map((o) => (o.id === optionId ? { ...o, votes: (o.votes ?? 0) + 1 } : o));
  }
  return { myOptionId: demoVotes.get(pollId)!, voteCount: poll.voteCount, options: poll.options };
}
