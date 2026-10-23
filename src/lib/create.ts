import { getSupabase } from "./supabase";

export type CreateStatus = {
  signedIn: boolean;
  /** null until the first poll sets one. */
  username: string | null;
  suggestions: string[];
  pollsLeft: number;
};

export type UsernameProblem = "ok" | "format" | "reserved" | "blocked" | "taken";

export const DAILY_POLL_LIMIT = 5;

export async function getCreateStatus(nameSeed: string | null): Promise<CreateStatus> {
  const supabase = getSupabase();
  if (!supabase) return { signedIn: true, username: "you", suggestions: [], pollsLeft: DAILY_POLL_LIMIT };
  const { data, error } = await supabase.rpc("create_poll_status", { name_seed: nameSeed });
  if (error) throw error;
  return {
    signedIn: data.signed_in,
    username: data.username ?? null,
    suggestions: data.suggestions ?? [],
    pollsLeft: data.polls_left ?? 0,
  };
}

export async function checkUsername(name: string): Promise<{ problem: UsernameProblem; suggestions: string[] }> {
  const supabase = getSupabase();
  if (!supabase) return { problem: "ok", suggestions: [] };
  const { data, error } = await supabase.rpc("check_username", { name });
  if (error) throw error;
  return { problem: data.problem, suggestions: data.suggestions ?? [] };
}

/** A create_poll failure the form can explain ("docchi:<code>" from the database). */
export class CreatePollError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export async function createPoll(input: {
  question: string;
  answers: string[];
  days: 1 | 3 | 7;
  username: string | null;
}): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new CreatePollError("demo");
  const { data, error } = await supabase.rpc("create_poll", {
    question: input.question,
    answers: input.answers,
    days: input.days,
    username: input.username,
  });
  if (error) {
    const code = /docchi:(\w+)/.exec(error.message)?.[1];
    throw code ? new CreatePollError(code) : error;
  }
  return data as string;
}
