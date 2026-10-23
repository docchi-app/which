export type SharedPoll = {
  id: string;
  question: string;
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
      question: string;
      creator: string | null;
      vote_count: number;
      closes_at: string;
      options: { text: string }[];
    }[];
    if (!row) return null;
    return {
      id: row.id,
      question: row.question,
      creator: row.creator ?? "someone",
      voteCount: row.vote_count,
      options: row.options.map((o) => o.text),
      closed: new Date(row.closes_at).getTime() <= Date.now(),
    };
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
