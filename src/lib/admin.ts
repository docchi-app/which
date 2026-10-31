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

// ─── People (see supabase/migrations/20261206000000_people.sql) ──────────────

export type UserFilter = "all" | "week" | "novote" | "push_off" | "banned" | "test";
export type UserSort = "new" | "active" | "votes" | "friends";
export type PushState = "on" | "off" | "never" | "blocked" | "unsupported" | "unknown";

export type UserRow = {
  id: string;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  joined: string;
  wasGuest: boolean;
  guestSince: string | null;
  source: string | null;
  sourceBy: string | null;
  site: string | null;
  device: string | null;
  browser: string | null;
  inApp: string | null;
  installed: boolean | null;
  lastActive: string | null;
  votes: number;
  polls: number;
  snaps: number;
  friends: number;
  push: PushState;
  isTest: boolean;
  isBanned: boolean;
  isAdmin: boolean;
};

export type UserDetail = UserRow & {
  emailHint: string | null;
  comments: number;
  propsGiven: number;
  propsReceived: number;
  daysActive: number;
  streak: number;
  reports: number;
  timeline: { at: string; kind: string; text: string }[];
  pollList: { id: string; question: string; kind: string; visibility: string; createdAt: string; closesAt: string; votes: number; hidden: boolean; deleted: boolean }[];
};

export type UsersSummary = { total: number; newWeek: number; activeWeek: number; pushOn: number; pushNever: number; noVote: number };

export type GuestsSummary = {
  opened: number;
  voted: number;
  signedUp: number;
  buckets: { visit: number; day: number; days3: number; later: number };
  medianMinutes: number | null;
  votes: number;
  guestVotes: number;
  oneVote: number;
  avgVotes: number | null;
  medianVotes: number | null;
};

export type GuestRow = {
  id: string;
  code: string;
  started: string;
  source: string | null;
  sourceBy: string | null;
  site: string | null;
  device: string | null;
  browser: string | null;
  inApp: string | null;
  votes: number;
  lastSeen: string | null;
  signedUp: boolean;
  username: string | null;
};

const toUser = (r: Record<string, unknown>): UserRow => ({
  id: r.id as string,
  username: r.username as string,
  name: (r.name as string | null) ?? null,
  avatarUrl: (r.avatar_url as string | null) ?? null,
  joined: r.joined as string,
  wasGuest: r.was_guest === true,
  guestSince: (r.guest_since as string | null) ?? null,
  source: (r.source as string | null) ?? null,
  sourceBy: (r.source_by as string | null) ?? null,
  site: (r.site as string | null) ?? null,
  device: (r.device as string | null) ?? null,
  browser: (r.browser as string | null) ?? null,
  inApp: (r.in_app as string | null) ?? null,
  installed: (r.installed as boolean | null) ?? null,
  lastActive: (r.last_active as string | null) ?? null,
  votes: Number(r.votes ?? 0),
  polls: Number(r.polls ?? 0),
  snaps: Number(r.snaps ?? 0),
  friends: Number(r.friends ?? 0),
  push: ((r.push as string) ?? "unknown") as PushState,
  isTest: r.is_test === true,
  isBanned: r.is_banned === true,
  isAdmin: r.is_admin === true,
});

export async function fetchUsers(filter: UserFilter, search: string, sort: UserSort, max = 50, skip = 0): Promise<{ total: number; rows: UserRow[] }> {
  const d = await call<{ total: number; rows: Record<string, unknown>[] }>("admin_users", { filter, search: search.trim() || null, sort, max_rows: max, skip });
  return { total: Number(d.total ?? 0), rows: (d.rows ?? []).map(toUser) };
}

export async function fetchUsersSummary(): Promise<UsersSummary> {
  const s = await call<Record<string, unknown>>("admin_users_summary");
  return { total: Number(s.total ?? 0), newWeek: Number(s.new_week ?? 0), activeWeek: Number(s.active_week ?? 0), pushOn: Number(s.push_on ?? 0), pushNever: Number(s.push_never ?? 0), noVote: Number(s.no_vote ?? 0) };
}

export async function fetchUserDetail(id: string): Promise<UserDetail> {
  const d = await call<Record<string, unknown>>("admin_user_detail", { person: id });
  return {
    ...toUser(d),
    emailHint: (d.email_hint as string | null) ?? null,
    comments: Number(d.comments ?? 0),
    propsGiven: Number(d.props_given ?? 0),
    propsReceived: Number(d.props_received ?? 0),
    daysActive: Number(d.days_active ?? 0),
    streak: Number(d.streak ?? 0),
    reports: Number(d.reports ?? 0),
    timeline: ((d.timeline as { at: string; kind: string; text: string }[]) ?? []).map((t) => ({ at: t.at, kind: t.kind, text: t.text })),
    pollList: ((d.poll_list as Record<string, unknown>[]) ?? []).map((p) => ({
      id: p.id as string,
      question: p.question as string,
      kind: p.kind as string,
      visibility: p.visibility as string,
      createdAt: p.created_at as string,
      closesAt: p.closes_at as string,
      votes: Number(p.votes ?? 0),
      hidden: p.hidden === true,
      deleted: p.deleted === true,
    })),
  };
}

/** Shows one person's email (the database writes it in the admin log). */
export const fetchUserEmail = (id: string) => call<string | null>("admin_user_email", { person: id });
export const resetUsername = (id: string) => call<string>("admin_reset_username", { person: id });

export async function fetchGuests(days: number): Promise<GuestsSummary> {
  const g = await call<Record<string, unknown>>("admin_guests", { days });
  const b = (g.buckets ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    opened: Number(g.opened ?? 0),
    voted: Number(g.voted ?? 0),
    signedUp: Number(g.signed_up ?? 0),
    buckets: { visit: Number(b.visit ?? 0), day: Number(b.day ?? 0), days3: Number(b.days3 ?? 0), later: Number(b.later ?? 0) },
    medianMinutes: n(g.median_minutes),
    votes: Number(g.votes ?? 0),
    guestVotes: Number(g.guest_votes ?? 0),
    oneVote: Number(g.one_vote ?? 0),
    avgVotes: n(g.avg_votes),
    medianVotes: n(g.median_votes),
  };
}

export async function fetchGuestList(days: number, filter: "still" | "signed" | "all"): Promise<GuestRow[]> {
  const rows = await call<Record<string, unknown>[]>("admin_guest_list", { days, filter });
  return (rows ?? []).map((r) => ({
    id: r.id as string,
    code: r.code as string,
    started: r.started as string,
    source: (r.source as string | null) ?? null,
    sourceBy: (r.source_by as string | null) ?? null,
    site: (r.site as string | null) ?? null,
    device: (r.device as string | null) ?? null,
    browser: (r.browser as string | null) ?? null,
    inApp: (r.in_app as string | null) ?? null,
    votes: Number(r.votes ?? 0),
    lastSeen: (r.last_seen as string | null) ?? null,
    signedUp: r.signed_up === true,
    username: (r.username as string | null) ?? null,
  }));
}

// ─── Growth: Overview, Funnel & retention, Sources, Polls & snaps, Notifications ───

export type DaySnapshot = { visitors: number; signups: number; guests: number; votes: number; polls: number; snaps: number; shares: number };
export type Overview = {
  today: DaySnapshot;
  yesterday: DaySnapshot;
  lastWeek: DaySnapshot;
  series: { day: string; visitors: number; voters: number }[];
  voteRate: number | null;
  voteRateBefore: number | null;
  backRate: number | null;
  backRateBefore: number | null;
  sharesPerPoll: number | null;
  pushOn: number | null;
  signups24h: number;
  signupsWeekAvg: number;
  visitors24h: number;
  reportsWaiting: number;
  reportsOldest: string | null;
  errorsNew: number;
  errorsNewest: { id: number; message: string; place: string | null; since: string; people: number } | null;
  jobLastRun: string | null;
  jobResult: Record<string, unknown> | null;
  emailLast: { at: string | null; count: number };
  morning: boolean;
};
export type Funnel = {
  steps: { visited: number; voted: number; signed: number; polled: number; shared: number; friended: number };
  dau: number | null;
  wau: number;
  mau: number;
  cohorts: { week: string; n: number; d1: number | null; d7: number | null; d30: number | null }[];
  d1: { pushOn: number | null; pushOff: number | null; invited: number | null; found: number | null; signed: number | null; guest: number | null };
};
export type Sources = {
  total: number;
  sources: { source: string; n: number }[];
  bringers: { username: string; visitors: number; voted: number; signed: number; polls: number; invites: number }[];
  topPolls: { id: string; question: string; kind: string; visibility: string; author: string | null; visitors: number }[];
  phones: { label: string; visitors: number; voted: number; signed: number; errors: number }[];
};
export type ContentStats = {
  polls: number;
  snaps: number;
  medianVotes: number | null;
  p90Votes: number | null;
  noVotes: number;
  noVotesOpen: number;
  comments: number;
  byDay: { day: string; classic: number; snap: number; hot_take: number; mystery: number }[];
  top: { id: string; question: string; kind: string; visibility: string; author: string | null; votes: number; comments: number }[];
  snapLive: number;
  snapReview: number;
  snapRejected: number;
  aiFlags: number;
  reports: number;
  blocked: number;
  props: { label: string; emoji: string; n: number }[];
};
export type NotifStats = {
  kinds: { kind: string; made: number; sent: number; opened: number }[];
  sent: number;
  opened: number;
  expired: number;
  failed: number;
  runsToday: number | null;
  emails: number;
  emailsLunch: number;
  emailsEvening: number;
  emailOpens: number;
  turnedOff: number;
  phones: { label: string; people: number; on: number; cant: number }[];
  jobLastRun: string | null;
  jobProblem: { message: string; place: string | null; at: string; status: string } | null;
};

const ints = <K extends string>(o: Record<string, unknown> | null | undefined, keys: K[]) =>
  Object.fromEntries(keys.map((k) => [k, Number(o?.[k] ?? 0)])) as Record<K, number>;
const snap = (o: unknown) => ints(o as Record<string, unknown>, ["visitors", "signups", "guests", "votes", "polls", "snaps", "shares"]);
const list = <T>(v: unknown) => (v as T[] | null) ?? [];

export async function fetchOverview(): Promise<Overview> {
  const o = await call<Record<string, unknown>>("admin_overview");
  const e = o.errors_newest as Record<string, unknown> | null;
  const m = (o.email_last ?? {}) as Record<string, unknown>;
  return {
    today: snap(o.today),
    yesterday: snap(o.yesterday),
    lastWeek: snap(o.last_week),
    series: list<Record<string, unknown>>(o.series).map((r) => ({ day: r.day as string, visitors: Number(r.visitors ?? 0), voters: Number(r.voters ?? 0) })),
    voteRate: num(o.vote_rate),
    voteRateBefore: num(o.vote_rate_before),
    backRate: num(o.back_rate),
    backRateBefore: num(o.back_rate_before),
    sharesPerPoll: num(o.shares_per_poll),
    pushOn: num(o.push_on),
    signups24h: Number(o.signups_24h ?? 0),
    signupsWeekAvg: Number(o.signups_week_avg ?? 0),
    visitors24h: Number(o.visitors_24h ?? 0),
    reportsWaiting: Number(o.reports_waiting ?? 0),
    reportsOldest: (o.reports_oldest as string | null) ?? null,
    errorsNew: Number(o.errors_new ?? 0),
    errorsNewest: e ? { id: Number(e.id), message: String(e.message ?? ""), place: (e.place as string | null) ?? null, since: e.since as string, people: Number(e.people ?? 0) } : null,
    jobLastRun: (o.job_last_run as string | null) ?? null,
    jobResult: (o.job_result as Record<string, unknown> | null) ?? null,
    emailLast: { at: (m.at as string | null) ?? null, count: Number(m.count ?? 0) },
    morning: o.morning === true,
  };
}

export async function fetchFunnel(days: number): Promise<Funnel> {
  const f = await call<Record<string, unknown>>("admin_funnel", { days });
  return {
    steps: ints(f, ["visited", "voted", "signed", "polled", "shared", "friended"]),
    dau: num(f.dau),
    wau: Number(f.wau ?? 0),
    mau: Number(f.mau ?? 0),
    cohorts: list<Record<string, unknown>>(f.cohorts).map((c) => ({ week: c.week as string, n: Number(c.n ?? 0), d1: num(c.d1), d7: num(c.d7), d30: num(c.d30) })),
    d1: { pushOn: num(f.d1_push_on), pushOff: num(f.d1_push_off), invited: num(f.d1_invited), found: num(f.d1_found), signed: num(f.d1_signed), guest: num(f.d1_guest) },
  };
}

export async function fetchSources(days: number): Promise<Sources> {
  const s = await call<Record<string, unknown>>("admin_sources", { days });
  return {
    total: Number(s.total ?? 0),
    sources: list<Record<string, unknown>>(s.sources).map((r) => ({ source: String(r.source), n: Number(r.n ?? 0) })),
    bringers: list<Record<string, unknown>>(s.bringers).map((r) => ({ username: String(r.username), ...ints(r, ["visitors", "voted", "signed", "polls", "invites"]) })),
    topPolls: list<Record<string, unknown>>(s.top_polls).map((r) => ({
      id: r.id as string,
      question: String(r.question ?? ""),
      kind: String(r.kind ?? ""),
      visibility: String(r.visibility ?? ""),
      author: (r.author as string | null) ?? null,
      visitors: Number(r.visitors ?? 0),
    })),
    phones: list<Record<string, unknown>>(s.phones).map((r) => ({ label: String(r.label), ...ints(r, ["visitors", "voted", "signed", "errors"]) })),
  };
}

export async function fetchContent(days: number): Promise<ContentStats> {
  const c = await call<Record<string, unknown>>("admin_content", { days });
  return {
    polls: Number(c.polls ?? 0),
    snaps: Number(c.snaps ?? 0),
    medianVotes: num(c.median_votes),
    p90Votes: num(c.p90_votes),
    noVotes: Number(c.no_votes ?? 0),
    noVotesOpen: Number(c.no_votes_open ?? 0),
    comments: Number(c.comments ?? 0),
    byDay: list<Record<string, unknown>>(c.by_day).map((r) => ({ day: r.day as string, ...ints(r, ["classic", "snap", "hot_take", "mystery"]) })),
    top: list<Record<string, unknown>>(c.top).map((r) => ({
      id: r.id as string,
      question: String(r.question ?? ""),
      kind: String(r.kind ?? ""),
      visibility: String(r.visibility ?? ""),
      author: (r.author as string | null) ?? null,
      votes: Number(r.votes ?? 0),
      comments: Number(r.comments ?? 0),
    })),
    snapLive: Number(c.snap_live ?? 0),
    snapReview: Number(c.snap_review ?? 0),
    snapRejected: Number(c.snap_rejected ?? 0),
    aiFlags: Number(c.ai_flags ?? 0),
    reports: Number(c.reports ?? 0),
    blocked: Number(c.blocked ?? 0),
    props: list<Record<string, unknown>>(c.props).map((r) => ({ label: String(r.label ?? ""), emoji: String(r.emoji ?? ""), n: Number(r.n ?? 0) })),
  };
}

export async function fetchNotifStats(days: number): Promise<NotifStats> {
  const n = await call<Record<string, unknown>>("admin_notifications", { days });
  const p = n.job_problem as Record<string, unknown> | null;
  return {
    kinds: list<Record<string, unknown>>(n.kinds).map((r) => ({ kind: String(r.kind), ...ints(r, ["made", "sent", "opened"]) })),
    sent: Number(n.sent ?? 0),
    opened: Number(n.opened ?? 0),
    expired: Number(n.expired ?? 0),
    failed: Number(n.failed ?? 0),
    runsToday: num(n.runs_today),
    emails: Number(n.emails ?? 0),
    emailsLunch: Number(n.emails_lunch ?? 0),
    emailsEvening: Number(n.emails_evening ?? 0),
    emailOpens: Number(n.email_opens ?? 0),
    turnedOff: Number(n.turned_off ?? 0),
    phones: list<Record<string, unknown>>(n.phones).map((r) => ({ label: String(r.label), ...ints(r, ["people", "on", "cant"]) })),
    jobLastRun: (n.job_last_run as string | null) ?? null,
    jobProblem: p ? { message: String(p.message ?? ""), place: (p.place as string | null) ?? null, at: p.at as string, status: String(p.status ?? "") } : null,
  };
}

/** The admin's 9 am summary push: read it, or switch it on or off (written in the admin log). */
export const adminMorning = (on?: boolean) => call<boolean>("admin_morning", on === undefined ? {} : { on_now: on });

// ─── Limits (Admin → Run → Limits) ───

export type Limits = { polls: number; snaps: number; changes: { at: string; detail: string }[] };

/** Reads the daily limits, or saves new ones (each change goes in the admin log). */
export async function adminLimits(next?: { polls: number; snaps: number }): Promise<Limits> {
  const d = await call<Record<string, unknown>>("admin_limits", next ? { polls: next.polls, snaps: next.snaps } : {});
  return {
    polls: Number(d.polls ?? 10),
    snaps: Number(d.snaps ?? 3),
    changes: ((d.changes as { at: string; detail: string }[] | null) ?? []).map((c) => ({ at: c.at, detail: c.detail })),
  };
}

// ─── What people like ─────────────────────────────────────────────────────

export type LikeRow = { key: string; n: number; spark: number; prev: number | null; prevN: number; votes: number | null };
export type LikeCell = { topic: string; feel: string; n: number; spark: number };
export type PollTags = { topic: string | null; feel: string | null; timely: boolean | null; lang: string | null };
export type LikedPoll = PollTags & {
  id: string;
  question: string;
  kind: string;
  who: "eithr" | "you" | "people";
  author: string | null;
  spark: number;
  votes: number;
  shares: number;
  comments: number;
  split: string | null;
};
export type TaggedPoll = PollTags & { id: string; question: string; kind: string; source: "ai" | "admin" | null; spark: number | null };
export type Likes = {
  days: number;
  polls: number;
  scored: number;
  tagged: number;
  voters: number;
  untaggedAll: number;
  lastTagged: string | null;
  topics: LikeRow[];
  feels: LikeRow[];
  grid: LikeCell[];
  langs: LikeRow[];
  times: LikeRow[];
  timing: LikeRow[];
  who: LikeRow[];
  best: LikedPoll[];
  recent: TaggedPoll[];
};

const likeRows = (v: unknown): LikeRow[] =>
  list<Record<string, unknown>>(v).map((r) => ({
    key: String(r.key),
    n: Number(r.n ?? 0),
    spark: Number(r.spark ?? 0),
    prev: num(r.prev),
    prevN: Number(r.prev_n ?? 0),
    votes: num(r.votes),
  }));
const tagsOf = (r: Record<string, unknown>): PollTags => ({
  topic: (r.topic as string | null) ?? null,
  feel: (r.feel as string | null) ?? null,
  timely: (r.timely as boolean | null) ?? null,
  lang: (r.lang as string | null) ?? null,
});

export async function fetchLikes(days: number): Promise<Likes> {
  const c = await call<Record<string, unknown>>("admin_likes", { days });
  return {
    days: Number(c.days ?? days),
    polls: Number(c.polls ?? 0),
    scored: Number(c.scored ?? 0),
    tagged: Number(c.tagged ?? 0),
    voters: Number(c.voters ?? 0),
    untaggedAll: Number(c.untagged_all ?? 0),
    lastTagged: (c.last_tagged as string | null) ?? null,
    topics: likeRows(c.topics),
    feels: likeRows(c.feels),
    grid: list<Record<string, unknown>>(c.grid).map((r) => ({ topic: String(r.topic), feel: String(r.feel), n: Number(r.n ?? 0), spark: Number(r.spark ?? 0) })),
    langs: likeRows(c.langs),
    times: likeRows(c.times),
    timing: likeRows(c.timing),
    who: likeRows(c.who),
    best: list<Record<string, unknown>>(c.best).map((r) => ({
      ...tagsOf(r),
      id: r.id as string,
      question: String(r.question ?? ""),
      kind: String(r.kind ?? ""),
      who: (r.who as LikedPoll["who"]) ?? "people",
      author: (r.author as string | null) ?? null,
      spark: Number(r.spark ?? 0),
      votes: Number(r.votes ?? 0),
      shares: Number(r.shares ?? 0),
      comments: Number(r.comments ?? 0),
      split: (r.split as string | null) ?? null,
    })),
    recent: list<Record<string, unknown>>(c.recent).map((r) => ({
      ...tagsOf(r),
      id: r.id as string,
      question: String(r.question ?? ""),
      kind: String(r.kind ?? ""),
      source: (r.source as TaggedPoll["source"]) ?? null,
      spark: num(r.spark),
    })),
  };
}

export async function setPollTags(poll: string, tags: PollTags): Promise<void> {
  await call("admin_set_poll_tags", { poll, topic: tags.topic, feel: tags.feel, timely: tags.timely ?? false, lang: tags.lang });
}

// ─── The content agent: Drafts and Trending now ───────────────────────────

export type DraftStatus = "new" | "scheduled" | "posted" | "skipped" | "expired" | "failed";
export type Draft = PollTags & {
  id: string;
  question: string;
  answers: string[];
  slot: "timely" | "emotional" | "best" | "experiment" | "trend" | "manual" | "brain";
  why: string | null;
  source: string | null;
  postAs: "eithr" | "you";
  publishAt: string;
  openDays: 1 | 3 | 7;
  pollOfDay: boolean;
  notify: boolean;
  status: DraftStatus;
  pollId: string | null;
  postedAt: string | null;
  error: string | null;
  votes: number | null;
  spark: number | null;
  /** A timely draft not approved by then expires. */
  expiresAt: string | null;
  /** When its headline was published. */
  sourceAt: string | null;
  /** The run that wrote it: the morning set, the 1 pm or 6 pm refresh, or Write drafts now. */
  runSlot: RunSlot | null;
  runModel: string | null;
  /** Brain breaks: the kind, the right answer's position, the why shown after voting, and whether the second AI agreed. */
  brainSort: string | null;
  correct: number | null;
  explain: string | null;
  checked: boolean;
  /** Once posted: how many got it right, and "Wrong answer?" flags. */
  rightPct: number | null;
  flags: number;
};
export type RunSlot = "morning" | "13" | "18" | "manual";
export type AgentSettings = {
  paused: boolean;
  draftsPerDay: number;
  postsPerDay: number;
  postAs: "eithr" | "you";
  hinglish: number;
  topicsOff: string[];
  refresh1pm: boolean;
  refresh6pm: boolean;
  refreshDrafts: number;
  timelyHours: number;
  /** Null before 20261214000000_brain_breaks.sql. */
  brainPerWeek: number | null;
  brainHour: number;
  brainSortsOff: string[];
};
export type BrainOut = { pollId: string; question: string; sort: string; votes: number; rightPct: number | null; flags: number; createdAt: string };
export type AgentRun = {
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "done" | "failed";
  drafts: number;
  trends: number;
  error: string | null;
  manual: boolean;
  slot: RunSlot | null;
  model: string | null;
};
export type DraftsData = {
  fresh: Draft[];
  scheduled: Draft[];
  posted: Draft[];
  settings: AgentSettings;
  lastRun: AgentRun | null;
  requestedAt: string | null;
  todayPosts: number;
  tomorrowPosts: number;
  adminUsername: string | null;
  expiredToday: { question: string; expiresAt: string }[];
  brainDropped: { question: string; sort: string | null; error: string | null }[];
  brainOut: BrainOut[];
};
export type Trend = PollTags & {
  id: number;
  source: string;
  title: string;
  url: string | null;
  ideaQuestion: string | null;
  ideaAnswers: string[];
  skipReason: string | null;
  drafted: boolean;
  publishedAt: string | null;
  region: string | null;
  gloss: string | null;
  runSlot: RunSlot | null;
  readAt: string | null;
};
export type CalendarDay = { id: number; day: string; label: string; addedBy: "seed" | "admin" };
export type TrendsData = { readAt: string | null; items: Trend[]; calendar: CalendarDay[] };

const draftOf = (r: Record<string, unknown>): Draft => ({
  ...tagsOf(r),
  id: r.id as string,
  question: String(r.question ?? ""),
  answers: list<string>(r.answers),
  slot: (r.slot as Draft["slot"]) ?? "manual",
  why: (r.why as string | null) ?? null,
  source: (r.source as string | null) ?? null,
  postAs: r.post_as === "you" ? "you" : "eithr",
  publishAt: String(r.publish_at),
  openDays: ([1, 3, 7].includes(Number(r.open_days)) ? Number(r.open_days) : 1) as Draft["openDays"],
  pollOfDay: Boolean(r.poll_of_day),
  notify: Boolean(r.notify),
  status: (r.status as DraftStatus) ?? "new",
  pollId: (r.poll_id as string | null) ?? null,
  postedAt: (r.posted_at as string | null) ?? null,
  error: (r.error as string | null) ?? null,
  votes: num(r.votes),
  spark: num(r.spark),
  expiresAt: (r.expires_at as string | null) ?? null,
  sourceAt: (r.source_at as string | null) ?? null,
  runSlot: (r.run_slot as RunSlot | null) ?? null,
  runModel: (r.run_model as string | null) ?? null,
  brainSort: (r.brain_sort as string | null) ?? null,
  correct: num(r.correct),
  explain: (r.explain as string | null) ?? null,
  checked: r.checked === true,
  rightPct: num(r.right_pct),
  flags: Number(r.flags ?? 0),
});
const settingsOf = (s: Record<string, unknown> | null | undefined): AgentSettings => ({
  paused: Boolean(s?.paused),
  draftsPerDay: Number(s?.drafts_per_day ?? 8),
  postsPerDay: Number(s?.posts_per_day ?? 4),
  postAs: s?.post_as === "you" ? "you" : "eithr",
  hinglish: Number(s?.hinglish ?? 50),
  topicsOff: list<string>(s?.topics_off),
  refresh1pm: s?.refresh_1pm !== false,
  refresh6pm: s?.refresh_6pm !== false,
  refreshDrafts: Number(s?.refresh_drafts ?? 3),
  timelyHours: Number(s?.timely_hours ?? 12),
  brainPerWeek: s?.brain_per_week == null ? null : Number(s.brain_per_week),
  brainHour: Number(s?.brain_hour ?? 13),
  brainSortsOff: list<string>(s?.brain_sorts_off),
});

export async function fetchDrafts(): Promise<DraftsData> {
  const c = await call<Record<string, unknown>>("admin_drafts");
  const run = c.last_run as Record<string, unknown> | null;
  return {
    fresh: list<Record<string, unknown>>(c.new).map(draftOf),
    scheduled: list<Record<string, unknown>>(c.scheduled).map(draftOf),
    posted: list<Record<string, unknown>>(c.posted).map(draftOf),
    settings: settingsOf(c.settings as Record<string, unknown>),
    lastRun: run
      ? {
          startedAt: String(run.started_at),
          finishedAt: (run.finished_at as string | null) ?? null,
          status: (run.status as AgentRun["status"]) ?? "done",
          drafts: Number(run.drafts ?? 0),
          trends: Number(run.trends ?? 0),
          error: (run.error as string | null) ?? null,
          manual: Boolean(run.manual),
          slot: (run.slot as RunSlot | null) ?? null,
          model: (run.model as string | null) ?? null,
        }
      : null,
    requestedAt: (c.requested_at as string | null) ?? null,
    todayPosts: Number(c.today_posts ?? 0),
    tomorrowPosts: Number(c.tomorrow_posts ?? 0),
    adminUsername: (c.admin_username as string | null) ?? null,
    expiredToday: list<Record<string, unknown>>(c.expired_today).map((x) => ({ question: String(x.question ?? ""), expiresAt: String(x.expires_at) })),
    brainDropped: list<Record<string, unknown>>(c.brain_dropped).map((x) => ({ question: String(x.question ?? ""), sort: (x.brain_sort as string | null) ?? null, error: (x.error as string | null) ?? null })),
    brainOut: list<Record<string, unknown>>(c.brain_out).map((x) => ({
      pollId: String(x.poll_id),
      question: String(x.question ?? ""),
      sort: String(x.sort ?? ""),
      votes: Number(x.votes ?? 0),
      rightPct: num(x.right_pct),
      flags: Number(x.flags ?? 0),
      createdAt: String(x.created_at),
    })),
  };
}

export type DraftInput = PollTags & {
  question: string;
  answers: string[];
  postAs: "eithr" | "you";
  publishAt: string;
  openDays: 1 | 3 | 7;
  pollOfDay: boolean;
  notify: boolean;
  /** Brain breaks only. */
  correct?: number | null;
  explain?: string | null;
};

export async function saveDraft(id: string, d: DraftInput): Promise<Draft> {
  const r = await call<Record<string, unknown>>("admin_draft_save", {
    draft: id,
    question: d.question,
    answers: d.answers,
    topic: d.topic,
    feel: d.feel,
    timely: d.timely ?? false,
    lang: d.lang,
    post_as: d.postAs,
    publish_at: d.publishAt,
    open_days: d.openDays,
    poll_of_day: d.pollOfDay,
    notify: d.notify,
    // Only Brain breaks send these (before their migration there are none, and the old function takes neither).
    ...(d.correct != null ? { correct: d.correct, answer_why: d.explain ?? "" } : {}),
  });
  return draftOf(r);
}

export async function approveDrafts(ids: string[]): Promise<{ approved: number; problems: { id: string; error: string }[] }> {
  const r = await call<{ approved: number; problems: { id: string; error: string }[] }>("admin_drafts_approve", { ids });
  return { approved: Number(r.approved ?? 0), problems: list(r.problems) };
}
export const skipDrafts = (ids: string[]) => call<number>("admin_drafts_skip", { ids });
export const unscheduleDraft = (id: string) => call<null>("admin_draft_unschedule", { draft: id });
export const requestAgentRun = () => call<string>("admin_agent_request");

export async function saveAgentSettings(s: AgentSettings): Promise<AgentSettings> {
  const r = await call<Record<string, unknown>>("admin_agent_settings", {
    paused: s.paused,
    drafts_per_day: s.draftsPerDay,
    posts_per_day: s.postsPerDay,
    post_as: s.postAs,
    hinglish: s.hinglish,
    topics_off: s.topicsOff,
    refresh_1pm: s.refresh1pm,
    refresh_6pm: s.refresh6pm,
    refresh_drafts: s.refreshDrafts,
    timely_hours: s.timelyHours,
    // Before 20261214000000_brain_breaks.sql the function takes none of these.
    ...(s.brainPerWeek != null ? { brain_per_week: s.brainPerWeek, brain_hour: s.brainHour, brain_sorts_off: s.brainSortsOff } : {}),
  });
  return settingsOf(r);
}

export async function fetchTrends(): Promise<TrendsData> {
  const c = await call<Record<string, unknown>>("admin_trends");
  return {
    readAt: (c.read_at as string | null) ?? null,
    items: list<Record<string, unknown>>(c.items).map((r) => ({
      ...tagsOf(r),
      id: Number(r.id),
      source: String(r.source ?? ""),
      title: String(r.title ?? ""),
      url: (r.url as string | null) ?? null,
      ideaQuestion: (r.idea_question as string | null) ?? null,
      ideaAnswers: list<string>(r.idea_answers),
      skipReason: (r.skip_reason as string | null) ?? null,
      drafted: Boolean(r.drafted),
      publishedAt: (r.published_at as string | null) ?? null,
      region: (r.region as string | null) ?? null,
      gloss: (r.gloss as string | null) ?? null,
      runSlot: (r.run_slot as RunSlot | null) ?? null,
      readAt: (r.read_at as string | null) ?? null,
    })),
    calendar: list<Record<string, unknown>>(c.calendar).map((r) => ({
      id: Number(r.id),
      day: String(r.day),
      label: String(r.label ?? ""),
      addedBy: r.added_by === "seed" ? "seed" : "admin",
    })),
  };
}
export const draftFromTrend = (id: number) => call<string>("admin_draft_from_trend", { trend: id });
export const addCalendarDay = (day: string, label: string) => call<number | null>("admin_calendar_add", { on_day: day, label_text: label });
export const removeCalendarDay = (id: number) => call<null>("admin_calendar_remove", { entry: id });
