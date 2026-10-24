import { timingSafeEqual } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, GOOGLE_STATE_COOKIE, googleRedirectUri, googleServerConfigured } from "@/lib/google-server";

/**
 * Step 2: Google sends the viewer back here with a one-time code. We swap it
 * for an ID token, hand that to Supabase, and write the session cookies the
 * browser client reads. /auth/callback then casts any pending pick.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const fail = (code: string) => {
    const response = NextResponse.redirect(new URL(`/auth/callback?error=google&error_code=${code}`, request.url));
    response.cookies.delete({ name: GOOGLE_STATE_COOKIE, path: "/auth/google" });
    return response;
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!googleServerConfigured || !url || !anonKey) return fail("not_configured");

  // Closed the picker or said no.
  if (params.get("error")) return fail(params.get("error") === "access_denied" ? "cancelled" : "google_error");

  const [state, nonce] = (request.cookies.get(GOOGLE_STATE_COOKIE)?.value ?? "").split(".");
  const code = params.get("code");
  if (!code || !state || !nonce || !sameText(params.get("state") ?? "", state)) return fail("bad_state");

  let tokens: { idToken: string; accessToken?: string };
  try {
    tokens = await exchangeCode(code, googleRedirectUri(request));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return fail("exchange_failed");
  }

  const response = NextResponse.redirect(new URL("/auth/callback", request.url));
  response.headers.set("Cache-Control", "no-store");
  response.cookies.delete({ name: GOOGLE_STATE_COOKIE, path: "/auth/google" });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
    },
  });
  const { error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: tokens.idToken,
    access_token: tokens.accessToken,
    nonce,
  });
  if (error) {
    console.error("supabase signInWithIdToken:", error.message);
    return fail("supabase_rejected");
  }
  return response;
}

function sameText(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
