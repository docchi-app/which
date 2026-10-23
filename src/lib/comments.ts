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
    })),
  };
}

export async function postComment(pollId: string, text: string): Promise<void> {
  const { error } = (await getSupabase()?.rpc("post_comment", { poll: pollId, body: text })) ?? { error: null };
  if (error) throw fail(error.message);
}

export async function deleteComment(commentId: string): Promise<void> {
  const { error } = (await getSupabase()?.rpc("delete_comment", { comment: commentId })) ?? { error: null };
  if (error) throw fail(error.message);
}
