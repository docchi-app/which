import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { GOOGLE_CLIENT_ID, GOOGLE_STATE_COOKIE, googleRedirectUri, googleServerConfigured } from "@/lib/google-server";

/**
 * Step 1 of signing in with Google on our own domain: off to Google's account
 * picker. Google returns to /auth/google/callback, so the consent screen names
 * this site rather than the Supabase project.
 */
export async function GET(request: NextRequest) {
  if (!googleServerConfigured) {
    return NextResponse.redirect(new URL("/auth/callback?error=google&error_code=not_configured", request.url));
  }

  // state stops a forged callback; the nonce ties Google's ID token to this attempt.
  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");

  const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  google.search = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(request),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce: createHash("sha256").update(nonce).digest("hex"),
    prompt: "select_account",
  }).toString();

  const response = NextResponse.redirect(google);
  response.cookies.set(GOOGLE_STATE_COOKIE, `${state}.${nonce}`, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/auth/google",
    maxAge: 600,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
