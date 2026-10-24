import type { NextRequest } from "next/server";

/** Same Google OAuth client as the one in Supabase → Authentication → Providers → Google. */
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || null;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || null;

export const googleServerConfigured = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

export const GOOGLE_STATE_COOKIE = "docchi-google";

/** Must be listed under the OAuth client's "Authorised redirect URIs" in Google Cloud. */
export const googleRedirectUri = (request: NextRequest) => `${request.nextUrl.origin}/auth/google/callback`;

/** Swaps the one-time code from Google for its ID token (and the access token it's bound to). */
export async function exchangeCode(code: string, redirectUri: string): Promise<{ idToken: string; accessToken?: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID!,
      client_secret: GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; access_token?: string; error?: string };
  if (!res.ok || !body.id_token) throw new Error(`google token exchange: ${res.status} ${body.error ?? ""}`.trim());
  return { idToken: body.id_token, accessToken: body.access_token };
}
