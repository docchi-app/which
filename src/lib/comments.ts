import { askTextCheck } from "./moderation";
import { getSupabase } from "./supabase";

export type Comment = {
  id: string;
  text: string;
  createdAt: string;
  username: string;
  avatarUrl: string | null;
  /** The writer's pick on this poll (null for its creator, who may not have voted). */
  pick: string | null;
  pickIndex: number | null;
  isMine: boolean;
  isCreator: boolean;
  canDelete: boolean;
  /** Friends tagged in it (the @names that are real tags; others are plain text). */
  tags: string[];
  /** I'm one of them (I can remove my tag). */
  taggedMe: boolean;
};

export type Thread =
  | { canRead: false; why: "sign_in" | "vote_first" | "not_found" }
  | { canRead: true; canPost: boolean; closed: boolean; comments: Comment[] };

type RawComment = {
  id: string;
  text: string;
  created_at: string;
  username: string;
  avatar_url: string | null;
  pick: string | null;
  pick_index: number | null;
  is_mine: boolean;
  is_creator: boolean;
  can_delete: boolean;
  // Before 20261213000000_comment_tags.sql: missing.
  tags?: string[];
  tagged_me?: boolean;
};

const ERRORS: Record<string, string> = {
  sign_in: "Sign in with Google to comment.",
  banned: "Your account can't comment.",
  vote_first: "Vote first, then join the conversation.",
  closed: "This poll has closed.",
  comment_length: "Keep it to 200 characters.",
  blocked_words: "Let's keep it friendly. Try different words?",
  slow_down: "You're on a roll! Give it a minute before the next one.",
  not_found: "That comment's gone already.",
};

const fail = (message: string) => new Error(ERRORS[/docchi:(\w+)/.exec(message)?.[1] ?? ""] ?? "Couldn't do that. Try again?");

export async function fetchThread(pollId: string): Promise<Thread> {
  const supabase = getSupabase();
  if (!supabase) return { canRead: false, why: "not_found" };
  const { data, error } = await supabase.rpc("get_comments", { poll: pollId });
  if (error) throw error;
  const d = data as { can_read: boolean; why?: string; can_post?: boolean; closed?: boolean; comments?: RawComment[] };
  if (!d.can_read) return { canRead: false, why: (d.why as "sign_in" | "vote_first" | "not_found") ?? "not_found" };
  return {
    canRead: true,
    canPost: Boolean(d.can_post),
    closed: Boolean(d.closed),
    comments: (d.comments ?? []).map((c) => ({
      id: c.id,
      text: c.text,
      createdAt: c.created_at,
      username: c.username,
      avatarUrl: c.avatar_url,
      pick: c.pick,
      pickIndex: c.pick_index,
      isMine: c.is_mine,
      isCreator: c.is_creator,
      canDelete: c.can_delete,
      tags: c.tags ?? [],
      taggedMe: Boolean(c.tagged_me),
    })),
  };
}

/** Posts a comment; returns the friends it tagged. */
export async function postComment(pollId: string, text: string): Promise<string[]> {
  const { data, error } = (await getSupabase()?.rpc("post_comment", { poll: pollId, body: text })) ?? { data: null, error: null };
  if (error) throw fail(error.message);
  askTextCheck(pollId);
  return ((data as { tagged?: string[] } | null)?.tagged ?? []).filter((x) => typeof x === "string");
}

/** Friends who can see this poll and whose username starts with q, for the @ picker. */
export async function tagCandidates(pollId: string, q: string): Promise<{ username: string; avatarUrl: string | null }[]> {
  const { data, error } = (await getSupabase()?.rpc("tag_candidates", { poll: pollId, q })) ?? { data: null, error: null };
  if (error || !Array.isArray(data)) return [];
  return (data as { username: string; avatar_url: string | null }[]).map((f) => ({ username: f.username, avatarUrl: f.avatar_url }));
}

/** My @name in a comment back to plain text. */
export async function removeMyTag(commentId: string): Promise<void> {
  const { error } = (await getSupabase()?.rpc("remove_my_tag", { comment: commentId })) ?? { error: null };
  if (error) throw fail(error.message);
}

/** The @word being typed right before the caret ("" just after @), or null. */
export function tagQuery(text: string, caret: number): string | null {
  const m = /(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{0,20})$/.exec(text.slice(0, caret));
  return m ? m[1] : null;
}

/** The text with the @word before the caret replaced by @username and a space. */
export function insertTag(text: string, caret: number, username: string): { text: string; caret: number } {
  const before = text.slice(0, caret).replace(/@([a-zA-Z0-9_]{0,20})$/, `@${username} `);
  return { text: before + text.slice(caret).replace(/^ /, ""), caret: before.length };
}

/** A comment split into plain text and real tags (only names in `tags`), for highlighting. */
export function tagParts(text: string, tags: string[]): { text: string; tag?: string }[] {
  if (!tags.length) return [{ text }];
  const set = new Set(tags.map((t) => t.toLowerCase()));
  const out: { text: string; tag?: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(/(^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{3,20})(?![a-zA-Z0-9_])/g)) {
    const name = m[2].toLowerCase();
    if (!set.has(name)) continue;
    const at = (m.index ?? 0) + m[1].length;
    if (at > last) out.push({ text: text.slice(last, at) });
    out.push({ text: `@${m[2]}`, tag: name });
    last = at + 1 + m[2].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** An answer that asks to tag someone ("A friend (tag them)", "Tag karo"). */
export const asksForTag = (answer: string) => /\btag\b|@/i.test(answer);

export async function deleteComment(commentId: string): Promise<void> {
  const { error } = (await getSupabase()?.rpc("delete_comment", { comment: commentId })) ?? { error: null };
  if (error) throw fail(error.message);
}
