import { getSupabase } from "./supabase";

/** none: not in it · pending: requested · member: accepted. */
export type CircleStatus = "none" | "pending" | "member";

export type PublicProfile = {
  username: string;
  avatarUrl: string | null;
  joined: string;
  isMe: boolean;
  publicPolls: number;
  votesReceived: number;
  circleSize: number;
  /** Am I in their circle? */
  theirCircle: CircleStatus;
  /** Are they in mine (or asking to be)? */
  myCircle: CircleStatus;
  blockedByMe: boolean;
};

export type Person = { username: string; avatarUrl: string | null };
export type CircleGroup = { id: string; name: string; count: number };
export type CircleMember = Person & { since: string; groups: string[] };
export type MyCircle = {
  requests: (Person & { at: string })[];
  members: CircleMember[];
  groups: CircleGroup[];
  joined: (Person & { status: CircleStatus; at: string })[];
};

/** Turns a Supabase error into the 'docchi:<code>' code, if it has one. */
export class CircleError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const supabase = getSupabase();
  if (!supabase) throw new CircleError("demo");
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new CircleError(/docchi:(\w+)/.exec(error.message)?.[1] ?? "failed");
  return data as T;
}

type RawPerson = { username: string; avatar_url: string | null };
const person = (p: RawPerson): Person => ({ username: p.username, avatarUrl: p.avatar_url });

export async function getPublicProfile(name: string): Promise<PublicProfile | null> {
  const d = await call<Record<string, unknown> | null>("get_profile", { name });
  if (!d) return null;
  return {
    username: d.username as string,
    avatarUrl: (d.avatar_url as string) ?? null,
    joined: d.joined as string,
    isMe: d.is_me as boolean,
    publicPolls: d.public_polls as number,
    votesReceived: d.votes_received as number,
    circleSize: d.circle_size as number,
    theirCircle: d.their_circle as CircleStatus,
    myCircle: d.my_circle as CircleStatus,
    blockedByMe: d.blocked_by_me as boolean,
  };
}

export async function searchPeople(q: string) {
  const rows = await call<(RawPerson & { their_circle: CircleStatus; my_circle: CircleStatus })[]>("search_people", { q });
  return rows.map((r) => ({ ...person(r), theirCircle: r.their_circle, myCircle: r.my_circle }));
}

export const requestCircle = (name: string) => call<CircleStatus>("request_circle", { name });
export const leaveCircle = (name: string) => call<void>("leave_circle", { name });
export const respondRequest = (name: string, accept: boolean) => call<void>("respond_request", { name, accept });
export const removeFromCircle = (name: string) => call<void>("remove_from_circle", { name });
export const blockUser = (name: string) => call<void>("block_user", { name });
export const unblockUser = (name: string) => call<void>("unblock_user", { name });
export const createGroup = (name: string) => call<string>("create_group", { name });
export const renameGroup = (groupId: string, name: string) => call<void>("rename_group", { group_id: groupId, name });
export const deleteGroup = (groupId: string) => call<void>("delete_group", { group_id: groupId });
export const setGroupMember = (groupId: string, name: string, include: boolean) =>
  call<void>("set_group_member", { group_id: groupId, name, include });

export async function getMyCircle(): Promise<MyCircle> {
  const d = await call<{
    requests: (RawPerson & { at: string })[];
    members: (RawPerson & { since: string; groups: string[] })[];
    groups: CircleGroup[];
    joined: (RawPerson & { status: CircleStatus; at: string })[];
  }>("my_circle");
  return {
    requests: d.requests.map((r) => ({ ...person(r), at: r.at })),
    members: d.members.map((m) => ({ ...person(m), since: m.since, groups: m.groups })),
    groups: d.groups,
    joined: d.joined.map((j) => ({ ...person(j), status: j.status, at: j.at })),
  };
}

/** Window event fired after any circle change, so badges refresh. */
export const CIRCLE_CHANGED = "docchi:circle-changed";
export const announceCircleChange = () => window.dispatchEvent(new Event(CIRCLE_CHANGED));

/** Requests waiting for me + people who accepted me lately (for the Profile tab badge). */
export async function getCircleBadge(): Promise<number> {
  const d = await call<{ requests: number; accepted_recently: number }>("circle_badge");
  return d.requests;
}

export const CIRCLE_ERRORS: Record<string, string> = {
  sign_in: "Sign in first.",
  need_username: "Pick a username first.",
  self: "That's you!",
  no_user: "Couldn't find that person.",
  blocked: "You can't do that with this person.",
  request_limit: "That's 50 requests today. Try again tomorrow.",
  circle_full: "Your circle is full (500 people).",
  no_request: "That request isn't there anymore.",
  group_name: "Group names are 1 to 24 characters.",
  group_exists: "You already have a group with that name.",
  group_limit: "You can have up to 10 groups.",
  not_in_circle: "Only people in your circle can be in a group.",
  blocked_words: "Let's pick a friendlier name.",
};

export const circleErrorText = (e: unknown) =>
  (e instanceof CircleError && CIRCLE_ERRORS[e.code]) || "That didn't work. Try again?";
