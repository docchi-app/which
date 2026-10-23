import { getSupabase } from "./supabase";

export type QueueItem = {
  targetType: "poll" | "user";
  targetId: string;
  reports: number;
  reasons: Record<string, number>;
  lastAt: string;
  question: string | null;
  teaser: string | null;
  kind: string | null;
  visibility: string | null;
  options: string[];
  createdAt: string | null;
  isHidden: boolean;
  hiddenReason: "reports" | "admin" | "ban" | null;
  username: string | null;
  avatarUrl: string | null;
  isBanned: boolean;
  userPolls: number;
  userReports: number;
};

export type LogItem = {
  id: string;
  action: "remove" | "restore" | "dismiss" | "ban" | "unban" | "schedule" | "reschedule" | "unschedule";
  targetType: "poll" | "user";
  targetId: string;
  at: string;
  undone: boolean;
  admin: string | null;
  question: string | null;
  username: string | null;
  userId: string | null;
};

export type DayMetrics = {
  day: string;
  visitors: number;
  newVisitors: number;
  signedIn: number;
  sessions: number;
  /** Sessions by signed-in visitors (votes per session divides by these). */
  signedSessions: number;
  voters: number;
  votes: number;
  shares: number;
  polls: number;
  signups: number;
  votePct: number | null;
  votesPerSession: number | null;
  shareRate: number | null;
  d1: number | null;
  d7: number | null;
};

export type AdminAction = "remove" | "restore" | "dismiss" | "ban" | "unban";

export type PollKind = "classic" | "hot_take" | "mystery";

export type ScheduleDay = {
  day: string;
  pollId: string | null;
  kind: PollKind | null;
  question: string | null;
  teaser: string | null;
  options: string[];
  voteCount: number;
  openDays: number | null;
  live: boolean;
};

export type ScheduleInput = {
  day: string;
  question: string;
  answers: string[];
  kind: PollKind;
  teaser: string;
  openDays: number;
  /** editing an existing (not yet live) poll */
  pollId?: string;
};

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("demo");
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(/docchi:(\w+)/.exec(error.message)?.[1] ?? "failed");
  return data as T;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function fetchQueue(status: "open" | "done"): Promise<QueueItem[]> {
  const rows = await call<Record<string, unknown>[]>("admin_reports", { status });
  return rows.map((r) => ({
    targetType: r.target_type as QueueItem["targetType"],
    targetId: r.target_id as string,
    reports: r.reports as number,
    reasons: (r.reasons as Record<string, number>) ?? {},
    lastAt: r.last_at as string,
    question: r.question as string | null,
    teaser: r.teaser as string | null,
    kind: r.kind as string | null,
    visibility: r.visibility as string | null,
    options: (r.options as string[]) ?? [],
    createdAt: r.created_at as string | null,
    isHidden: r.is_hidden as boolean,
    hiddenReason: r.hidden_reason as QueueItem["hiddenReason"],
    username: r.username as string | null,
    avatarUrl: r.avatar_url as string | null,
    isBanned: Boolean(r.is_banned),
    userPolls: (r.user_polls as number) ?? 0,
    userReports: (r.user_reports as number) ?? 0,
  }));
}

export async function moderate(targetType: "poll" | "user", targetId: string, action: AdminAction): Promise<void> {
  await call("admin_act", { kind: targetType, target: targetId, act: action });
}

export async function fetchLog(): Promise<LogItem[]> {
  const rows = await call<Record<string, unknown>[]>("admin_log", { max_rows: 50 });
  return rows.map((r) => ({
    id: r.id as string,
    action: r.action as LogItem["action"],
    targetType: r.target_type as LogItem["targetType"],
    targetId: r.target_id as string,
    at: r.created_at as string,
    undone: r.undone as boolean,
    admin: r.admin as string | null,
    question: r.question as string | null,
    username: r.username as string | null,
    userId: r.user_id as string | null,
  }));
}

export async function fetchMetrics(days: number): Promise<DayMetrics[]> {
  const rows = await call<Record<string, unknown>[]>("admin_metrics", { days });
  return rows.map((r) => ({
    day: r.day as string,
    visitors: r.visitors as number,
    newVisitors: r.new_visitors as number,
    signedIn: r.signed_in as number,
    sessions: r.sessions as number,
    signedSessions: r.signed_sessions as number,
    voters: r.voters as number,
    votes: r.votes as number,
    shares: r.shares as number,
    polls: r.polls as number,
    signups: r.signups as number,
    votePct: num(r.vote_pct),
    votesPerSession: num(r.votes_per_session),
    shareRate: num(r.share_rate),
    d1: num(r.d1),
    d7: num(r.d7),
  }));
}

export async function fetchSchedule(days = 21): Promise<ScheduleDay[]> {
  const rows = await call<Record<string, unknown>[]>("admin_schedule", { days });
  return rows.map((r) => ({
    day: r.day as string,
    pollId: r.poll_id as string | null,
    kind: r.kind as PollKind | null,
    question: r.question as string | null,
    teaser: r.teaser as string | null,
    options: (r.options as string[]) ?? [],
    voteCount: (r.vote_count as number) ?? 0,
    openDays: r.open_days as number | null,
    live: Boolean(r.live),
  }));
}

/** Throws an Error whose message is the reason code (day_taken, question_length, …). */
export async function schedulePoll(input: ScheduleInput): Promise<string> {
  return call<string>("admin_schedule_poll", {
    day: input.day,
    question: input.question,
    answers: input.kind === "hot_take" ? null : input.answers,
    kind: input.kind,
    teaser: input.kind === "mystery" ? input.teaser : null,
    open_days: input.openDays,
    poll: input.pollId ?? null,
  });
}

export async function unschedule(pollId: string): Promise<void> {
  await call("admin_unschedule", { poll: pollId });
}
