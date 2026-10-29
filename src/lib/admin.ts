import { getSupabase } from "./supabase";
import { forgetPolls } from "./screen-cache";

export type QueueItem = {
  targetType: "poll" | "user" | "comment";
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
  /** comment reports: the comment, and the poll it's on (question/options above) */
  commentText: string | null;
};

export type LogItem = {
  id: string;
  action: "remove" | "restore" | "dismiss" | "ban" | "unban" | "schedule" | "reschedule" | "unschedule";
  targetType: "poll" | "user" | "comment";
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
    commentText: (r.comment_text as string | null) ?? null,
  }));
}

export async function moderate(targetType: "poll" | "user" | "comment", targetId: string, action: AdminAction): Promise<void> {
  await call("admin_act", { kind: targetType, target: targetId, act: action });
  // Removed: off this phone's feed now, not when the feed next asks.
  if (targetType === "poll" && action === "remove") forgetPolls([targetId]);
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

/** Views per day and votes per 100 views (counted since the live-feed migration ran). Null on an older database. */
export async function fetchViewStats(days: number): Promise<Map<string, { views: number; per100: number | null }> | null> {
  try {
    const rows = await call<Record<string, unknown>[]>("admin_view_stats", { days });
    return new Map(rows.map((r) => [r.day as string, { views: (r.views as number) ?? 0, per100: num(r.votes_per_100_views) }]));
  } catch {
    return null;
  }
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

// ─── Words (the word filter's list) ─────────────────────────────────────────

/** word: the whole word or phrase · root: the start of a word · part: anywhere · allow: never blocked */
export type WordKind = "word" | "root" | "part" | "allow";
export type BlockedWord = { term: string; kind: WordKind; lang: string | null; addedAt: string };

export async function fetchWords(): Promise<BlockedWord[]> {
  const rows = await call<Record<string, unknown>[]>("admin_words");
  return rows.map((r) => ({ term: r.term as string, kind: r.kind as WordKind, lang: (r.lang as string | null) ?? null, addedAt: r.added_at as string }));
}

/** Adds (or changes) a word; returns it as stored (cleaned: lower case, symbols out). */
export async function addWord(term: string, kind: WordKind, lang: string | null): Promise<string> {
  return call<string>("admin_add_word", { term, kind, lang });
}

export async function removeWord(term: string): Promise<void> {
  await call("admin_remove_word", { term });
}

/** The words that would block this text (empty: it would go through). */
export async function testWords(text: string): Promise<string[]> {
  return (await call<string[] | null>("admin_test_words", { input: text })) ?? [];
}

// ─── Test accounts (left out of Metrics, with the admin's own account) ──────

export type TestAccount = { username: string; avatarUrl: string | null; joined: string; votes: number };

export async function fetchTestAccounts(): Promise<TestAccount[]> {
  const rows = await call<Record<string, unknown>[]>("admin_test_accounts");
  return rows.map((r) => ({ username: r.username as string, avatarUrl: (r.avatar_url as string | null) ?? null, joined: r.joined as string, votes: Number(r.votes ?? 0) }));
}

/** Throws "not_found" (no such username) or "own_account" (yours is always left out). */
export async function setTestAccount(username: string, on: boolean): Promise<void> {
  await call("admin_set_test", { username: username.trim().replace(/^@/, ""), on_now: on });
}

// ─── Admin log: changes other than moderation ───────────────────────────────

export type AdminEvent = { at: string; action: string; detail: string | null; admin: string | null };

export async function fetchAdminEvents(max = 50): Promise<AdminEvent[]> {
  const rows = await call<Record<string, unknown>[]>("admin_events_list", { max_rows: max });
  return rows.map((r) => ({ at: r.at as string, action: r.action as string, detail: (r.detail as string | null) ?? null, admin: (r.admin as string | null) ?? null }));
}

// ─── Errors (see supabase/migrations/20261205000000_errors.sql) ──────────────

export type ErrorStatus = "new" | "open" | "fixed" | "ignored";
export type ErrorFilter = "look" | ErrorStatus | "all";
export type ErrorSource = "app" | "server" | "job";

export type ErrorRow = {
  id: number;
  source: ErrorSource;
  kind: string;
  message: string;
  place: string;
  status: ErrorStatus;
  cameBack: boolean;
  firstSeen: string;
  lastSeen: string;
  times: number;
  people: number;
  spike: boolean;
};

export type ErrorsSummary = {
  new: number;
  look: number;
  newest: string | null;
  newestPlace: string | null;
  newestSince: string | null;
  people: number;
  opened: number;
  times: number;
  kinds: number;
  jobLastRun: string | null;
  jobResult: Record<string, unknown> | null;
};

export type ErrorOccurrence = {
  at: string;
  who: "user" | "guest" | "visitor" | "server";
  username: string | null;
  device: string | null;
  browser: string | null;
  inApp: string | null;
  installed: boolean | null;
  appVersion: string | null;
  path: string | null;
  prevPath: string | null;
  stack: string | null;
};

export type ErrorDetail = Omit<ErrorRow, "times" | "people"> & {
  code: string | null;
  fixedAt: string | null;
  times: number;
  people: number;
  timesTotal: number;
  buckets: number[];
  devices: { label: string; people: number }[];
  who: { user: number; guest: number; visitor: number; names: string[] };
  versions: string[];
  latest: ErrorOccurrence[];
};

export async function fetchErrors(days: number, status: ErrorFilter, source: ErrorSource | null): Promise<ErrorRow[]> {
  const rows = await call<Record<string, unknown>[]>("admin_errors", { days, status_filter: status, source_filter: source });
  return rows.map((r) => ({
    id: Number(r.id),
    source: r.source as ErrorSource,
    kind: r.kind as string,
    message: r.message as string,
    place: (r.place as string) ?? "",
    status: r.status as ErrorStatus,
    cameBack: r.came_back === true,
    firstSeen: r.first_seen as string,
    lastSeen: r.last_seen as string,
    times: Number(r.times ?? 0),
    people: Number(r.people ?? 0),
    spike: r.spike === true,
  }));
}

export async function fetchErrorsSummary(days: number): Promise<ErrorsSummary> {
  const s = await call<Record<string, unknown>>("admin_errors_summary", { days });
  return {
    new: Number(s.new ?? 0),
    look: Number(s.look ?? 0),
    newest: (s.newest as string | null) ?? null,
    newestPlace: (s.newest_place as string | null) ?? null,
    newestSince: (s.newest_since as string | null) ?? null,
    people: Number(s.people ?? 0),
    opened: Number(s.opened ?? 0),
    times: Number(s.times ?? 0),
    kinds: Number(s.kinds ?? 0),
    jobLastRun: (s.job_last_run as string | null) ?? null,
    jobResult: (s.job_result as Record<string, unknown> | null) ?? null,
  };
}

export async function fetchErrorDetail(id: number, days: number): Promise<ErrorDetail> {
  const d = await call<Record<string, unknown>>("admin_error_detail", { err: id, days });
  const who = (d.who ?? {}) as Record<string, unknown>;
  return {
    id: Number(d.id),
    source: d.source as ErrorSource,
    kind: d.kind as string,
    message: d.message as string,
    place: (d.place as string) ?? "",
    code: (d.code as string | null) ?? null,
    status: d.status as ErrorStatus,
    cameBack: d.came_back === true,
    firstSeen: d.first_seen as string,
    lastSeen: d.last_seen as string,
    fixedAt: (d.fixed_at as string | null) ?? null,
    spike: d.spike === true,
    times: Number(d.times ?? 0),
    people: Number(d.people ?? 0),
    timesTotal: Number(d.times_total ?? 0),
    buckets: ((d.buckets as unknown[]) ?? []).map(Number),
    devices: ((d.devices as { label: string; people: number }[]) ?? []).map((x) => ({ label: x.label, people: Number(x.people) })),
    who: { user: Number(who.user ?? 0), guest: Number(who.guest ?? 0), visitor: Number(who.visitor ?? 0), names: (who.names as string[]) ?? [] },
    versions: (d.versions as string[]) ?? [],
    latest: ((d.latest as Record<string, unknown>[]) ?? []).map((l) => ({
      at: l.at as string,
      who: l.who as ErrorOccurrence["who"],
      username: (l.username as string | null) ?? null,
      device: (l.device as string | null) ?? null,
      browser: (l.browser as string | null) ?? null,
      inApp: (l.in_app as string | null) ?? null,
      installed: (l.installed as boolean | null) ?? null,
      appVersion: (l.app_version as string | null) ?? null,
      path: (l.path as string | null) ?? null,
      prevPath: (l.prev_path as string | null) ?? null,
      stack: (l.stack as string | null) ?? null,
    })),
  };
}

export async function setErrorStatus(id: number, status: "open" | "fixed" | "ignored"): Promise<ErrorStatus> {
  return call<ErrorStatus>("admin_error_status", { err: id, new_status: status });
}
