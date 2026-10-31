// What went wrong, in words people can act on. Two cases cover most failures: no connection (their
// network: say so, and keep what they did) and our problem (say it's on us, offer a retry). Codes
// the database sends ("docchi:slow_down") get their own words where the caller knows them.

export type FailureKind = "offline" | "server" | "code";

/** A request that never reached us: no network, a dropped connection, or the phone is offline. */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e ?? "");
  return /Failed to fetch|NetworkError|Load failed|network (request|connection)|ERR_INTERNET|ERR_NETWORK|fetch failed|TypeError: Network/i.test(msg);
}

/** The database's code in an error ("docchi:slow_down" → "slow_down"), if any. */
export function failureCode(e: unknown): string | null {
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e ?? "");
  return /docchi:(\w+)/.exec(msg)?.[1] ?? null;
}

export const NO_CONNECTION = "No connection. Check your signal and try again.";
export const OUR_PROBLEM = "Eithr hiccuped. That's on us, not your phone. Try again.";

/**
 * The words for a failure: a known code's own text, else "no connection" or "our problem".
 * `known` maps database codes to text for this place.
 */
export function failureText(e: unknown, known: Record<string, string> = {}): string {
  const code = failureCode(e);
  if (code && known[code]) return known[code];
  if (e instanceof Error && known[e.message]) return known[e.message];
  return isNetworkError(e) ? NO_CONNECTION : OUR_PROBLEM;
}

export function failureKind(e: unknown, known: Record<string, string> = {}): FailureKind {
  const code = failureCode(e);
  if ((code && known[code]) || (e instanceof Error && known[e.message])) return "code";
  return isNetworkError(e) ? "offline" : "server";
}

/** Runs `onSlow` if `work` is still going after `ms` (default 3 s). Returns work's result. */
export async function withSlowSignal<T>(work: Promise<T>, onSlow: () => void, ms = 3000): Promise<T> {
  const t = setTimeout(onSlow, ms);
  try {
    return await work;
  } finally {
    clearTimeout(t);
  }
}
