import "server-only";
import { cookies } from "next/headers";

/**
 * Who's opening /admin, decided on the server before anything is sent:
 * "owner" (the one admin), "no" (anyone else, or nobody signed in: they get the
 * normal 404), or "unknown" when the sign-in has expired. The browser then
 * refreshes it and checks again; the server never refreshes a sign-in itself,
 * since it can't save the new one and the old one would stop working.
 */
export type AdminGate = "owner" | "no" | "unknown";

/** The signed-in session from the auth cookie (split into .0, .1… when long). */
function sessionFrom(all: { name: string; value: string }[]): { access_token?: string; expires_at?: number } | null {
  const parts = all
    .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => Number(a.name.split(".").pop()) - Number(b.name.split(".").pop()));
  if (!parts.length) return null;
  let raw = parts.map((c) => c.value).join("");
  try {
    if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice(7), "base64url").toString("utf8");
    const s = JSON.parse(raw);
    return s && typeof s === "object" ? s : null;
  } catch {
    return null;
  }
}

export async function adminGate(): Promise<AdminGate> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return "no";
  const session = sessionFrom((await cookies()).getAll());
  if (!session?.access_token) return "no";
  if (!session.expires_at || session.expires_at * 1000 < Date.now() + 10_000) return "unknown";
  try {
    const res = await fetch(`${url}/rest/v1/rpc/my_profile`, {
      method: "POST",
      headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    if (res.status === 401) return "unknown";
    if (!res.ok) return "unknown";
    const me = (await res.json()) as { is_admin?: boolean } | null;
    return me?.is_admin === true ? "owner" : "no";
  } catch {
    return "unknown";
  }
}
