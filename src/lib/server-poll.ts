import "server-only";

export type SharedPoll = {
  id: string;
  kind: "classic" | "hot_take" | "mystery";
  /** null for a mystery poll (it stays hidden until you vote). */
  question: string | null;
  teaser: string | null;
  verified: boolean;
  /** A circle poll: previews show only who it's from. */
  circle: boolean;
  creator: string;
  voteCount: number;
  options: string[];
  closed: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A poll as anyone sees it before voting (question, answers, total votes),
 * for link previews. Cached for a minute; null if missing or Supabase isn't set up.
 */
export async function getSharedPoll(id: string): Promise<SharedPoll | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !UUID.test(id)) return null;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/get_poll`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ poll: id }),
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const [row] = (await res.json()) as {
      id: string;
      kind?: SharedPoll["kind"] | "snap" | "brain";
      question: string | null;
      teaser?: string | null;
      is_system: boolean;
      visibility?: string;
      creator: string | null;
      vote_count: number;
      closes_at: string;
      options: { text: string }[];
    }[];
    if (!row) return null;
    return {
      id: row.id,
      // A snap's photo is private: its card is drawn like a classic poll.
      kind: !row.kind || row.kind === "snap" || row.kind === "brain" ? "classic" : row.kind,
      question: row.question,
      teaser: row.teaser ?? null,
      verified: row.is_system,
      circle: row.visibility === "circle",
      creator: row.creator ?? "someone",
      voteCount: row.vote_count,
      options: row.options.map((o) => o.text),
      closed: new Date(row.closes_at).getTime() <= Date.now(),
    };
  } catch {
    return null;
  }
}

/** Which poll a group link (/v/<code>) opens; null if the link or its poll is gone. Cached for a minute. */
export async function getLinkPoll(code: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !/^[0-9a-f]{10}$/.test(code)) return null;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/link_poll`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const id = (await res.json()) as string | null;
    return typeof id === "string" && UUID.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Absolute base URL for links and preview images. */
export function siteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return new URL(explicit ?? (vercel ? `https://${vercel}` : "http://localhost:3000"));
}

/** Someone's public profile basics, for link previews of /u/<name>. */
export async function getSharedProfile(name: string): Promise<{ username: string; publicPolls: number } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !/^[a-z0-9_]{3,20}$/i.test(name)) return null;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/get_profile`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { username: string; public_polls: number } | null;
    return data ? { username: data.username, publicPolls: data.public_polls } : null;
  } catch {
    return null;
  }
}
