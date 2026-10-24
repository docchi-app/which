import { getSupabase } from "./supabase";

// Friends. The database still calls them circles: an accepted friendship is
// stored both ways in circle_members, and "groups" are shown as lists.

/** One direction of a friendship row. none · pending: asked · member: accepted. */
export type CircleStatus = "none" | "pending" | "member";

/** Where I stand with someone. */
export type FriendStatus = "none" | "requested" | "incoming" | "friends";

/** theirCircle: my row in their list · myCircle: their row in mine. */
export function friendStatus(theirCircle: CircleStatus, myCircle: CircleStatus): FriendStatus {
  if (theirCircle === "member") return "friends";
  if (theirCircle === "pending") return "requested";
  if (myCircle === "pending") return "incoming";
  return "none";
}

/** The server labels a friends-only poll for all friends as "Whole circle". */
export const audienceLabel = (audience: string | null) => (!audience || audience === "Whole circle" ? "All friends" : audience);

export type PublicProfile = {
  username: string;
  avatarUrl: string | null;
  joined: string;
  isMe: boolean;
  publicPolls: number;
  votesReceived: number;
  /** How many friends they have. */
  circleSize: number;
  /** Am I their friend (or asking)? */
  theirCircle: CircleStatus;
  /** Are they mine (or asking)? */
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

/** Add a friend: 'member' if they'd already asked you (friends now), else 'pending'. */
export const addFriend = (name: string) => call<CircleStatus>("request_circle", { name });
/** Unfriend, or cancel / decline a request. */
export const unfriend = (name: string) => call<void>("leave_circle", { name });
export const respondRequest = (name: string, accept: boolean) => call<void>("respond_request", { name, accept });
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

export const getInviteCode = () => call<string>("my_invite_code");
/** Opened someone's invite link: friends straight away. */
export const acceptInvite = (name: string, code: string) => call<"member" | "self">("accept_invite", { name, code });

export type Suggestion = Person & { mutual: number; voted: number };

export async function suggestFriends(): Promise<Suggestion[]> {
  const rows = await call<(RawPerson & { mutual: number; voted: number })[]>("suggest_friends");
  return rows.map((r) => ({ ...person(r), mutual: r.mutual, voted: r.voted }));
}

export type FriendsVoted = { count: number; people: Person[] };

/** How many friends voted on a poll (never what they picked). */
export async function getFriendsVoted(pollId: string): Promise<FriendsVoted> {
  const d = await call<{ count: number; people: RawPerson[] }>("friends_voted", { poll: pollId });
  return { count: d.count, people: d.people.map(person) };
}

/** Window event fired after any circle change, so badges refresh. */
export const CIRCLE_CHANGED = "docchi:circle-changed";
export const announceCircleChange = () => window.dispatchEvent(new Event(CIRCLE_CHANGED));

/** Friend requests waiting for me (for the badges). */
export async function getCircleBadge(): Promise<number> {
  const d = await call<{ requests: number; accepted_recently: number }>("circle_badge");
  return d.requests;
}

export const CIRCLE_ERRORS: Record<string, string> = {
  sign_in: "Sign in first.",
  need_username: "Pick a username first.",
  empty_circle: "You don't have friends here yet (or in those lists).",
  circle_only: "This poll is only for their friends.",
  self: "That's you!",
  no_user: "Couldn't find that person.",
  blocked: "You can't do that with this person.",
  request_limit: "That's 50 requests today. Try again tomorrow.",
  circle_full: "That's the limit of 500 friends.",
  no_request: "That request isn't there anymore.",
  group_name: "List names are 1 to 24 characters.",
  group_exists: "You already have a list with that name.",
  group_limit: "You can have up to 10 lists.",
  not_in_circle: "Only friends can be in a list.",
  bad_invite: "That invite link doesn't work anymore.",
  blocked_words: "Let's pick a friendlier name.",
  slow_down: "That's a lot in a short time. Try again in a few minutes.",
};

export const circleErrorText = (e: unknown) =>
  (e instanceof CircleError && CIRCLE_ERRORS[e.code]) || "That didn't work. Try again?";

export type CirclePick = Person & { optionId: string; isMe: boolean };

/** Who picked what on a friends-only poll (after you've voted). */
export async function getCirclePicks(pollId: string): Promise<CirclePick[]> {
  const rows = await call<(RawPerson & { option_id: string; is_me: boolean })[]>("circle_picks", { poll: pollId });
  return rows.map((r) => ({ ...person(r), optionId: r.option_id, isMe: r.is_me }));
}
