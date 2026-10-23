import { getSupabase } from "./supabase";

export const REPORT_REASONS = [
  { id: "hate", label: "Hate or harassment" },
  { id: "private_info", label: "Someone's private info or real name" },
  { id: "sexual", label: "Sexual content" },
  { id: "violence", label: "Violence, threats or self-harm" },
  { id: "spam", label: "Spam or scam" },
  { id: "illegal", label: "Illegal or misleading" },
  { id: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["id"];
export type ReportTarget =
  | { kind: "poll"; pollId: string }
  | { kind: "user"; username: string }
  | { kind: "comment"; commentId: string };

const ERRORS: Record<string, string> = {
  sign_in: "Sign in with Google to report.",
  banned: "Your account can't send reports.",
  report_limit: "That's a lot of reports today. We're on it; try again tomorrow.",
  own_poll: "You can't report your own poll, comment or yourself.",
  not_found: "That's gone already.",
};

/** Sends a report. Resolves to true when the poll got hidden by it. */
export async function sendReport(target: ReportTarget, reason: ReportReason): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const args =
    target.kind === "poll"
      ? { kind: "poll", reason, poll: target.pollId }
      : target.kind === "comment"
        ? { kind: "comment", reason, comment: target.commentId }
        : { kind: "user", reason, name: target.username };
  const { data, error } = await supabase.rpc("report", args);
  if (error) {
    const code = /docchi:(\w+)/.exec(error.message)?.[1];
    throw new Error((code && ERRORS[code]) || "Couldn't send that. Try again?");
  }
  return Boolean((data as { hidden?: boolean } | null)?.hidden);
}
