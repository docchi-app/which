// Votes made without a connection: kept on this phone and sent as soon as it's back, so nobody has
// to remember to tap again. A vote waiting here shows on its card as "Waiting to send". Once sent,
// the card gets the results through an "eithr:vote-sent" event; if the poll closed meanwhile it gets
// "eithr:vote-dropped" instead. Votes older than a day are let go.

import { castVote } from "./polls";
import { isNetworkError } from "./failure";
import type { VoteResult } from "./types";

type Queued = { pollId: string; optionId: string; at: number };

const KEY = "eithr.outbox.votes";
const DAY = 864e5;
export const VOTE_SENT = "eithr:vote-sent";
export const VOTE_DROPPED = "eithr:vote-dropped";
export type VoteSentDetail = { pollId: string; result: VoteResult };
export type VoteDroppedDetail = { pollId: string; reason: "closed" | "failed" };

function read(): Queued[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Queued[];
    return Array.isArray(list) ? list.filter((q) => q && q.pollId && q.optionId && Date.now() - q.at < DAY) : [];
  } catch {
    return [];
  }
}

function write(list: Queued[]) {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
  } catch {}
}

/** Keeps a vote to send later (one per poll: the latest pick wins). */
export function queueVote(pollId: string, optionId: string) {
  write([...read().filter((q) => q.pollId !== pollId), { pollId, optionId, at: Date.now() }]);
}

/** The pick waiting to be sent for this poll, if any. */
export function queuedVote(pollId: string): string | null {
  return read().find((q) => q.pollId === pollId)?.optionId ?? null;
}

/** Drops this poll's waiting vote (it went through after all). */
export function unqueueVote(pollId: string) {
  write(read().filter((q) => q.pollId !== pollId));
}

export function forgetQueuedVotes() {
  write([]);
}

let flushing = false;

/** Sends the waiting votes, oldest first. Stops at the first one that can't reach us. */
export async function flushVotes(): Promise<void> {
  if (flushing || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
  flushing = true;
  try {
    for (const q of read()) {
      try {
        const result = await castVote(q.pollId, q.optionId);
        write(read().filter((x) => x.pollId !== q.pollId));
        window.dispatchEvent(new CustomEvent<VoteSentDetail>(VOTE_SENT, { detail: { pollId: q.pollId, result } }));
      } catch (e) {
        if (isNetworkError(e)) break; // still no connection: try again later
        write(read().filter((x) => x.pollId !== q.pollId));
        const closed = /closed or missing|docchi:closed/i.test(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
        window.dispatchEvent(new CustomEvent<VoteDroppedDetail>(VOTE_DROPPED, { detail: { pollId: q.pollId, reason: closed ? "closed" : "failed" } }));
      }
    }
  } finally {
    flushing = false;
  }
}

/** Sends waiting votes when the connection comes back, when the app is reopened, and now. Returns a stop. */
export function startOutbox(): () => void {
  const go = () => void flushVotes();
  const onVisible = () => document.visibilityState === "visible" && go();
  window.addEventListener("online", go);
  document.addEventListener("visibilitychange", onVisible);
  const t = setTimeout(go, 1500);
  return () => {
    clearTimeout(t);
    window.removeEventListener("online", go);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
