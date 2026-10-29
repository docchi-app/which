import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

/** Browser Supabase client, or null when the env vars aren't set (demo mode). */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  // Through the current fetch at call time, so failed requests reach Admin → Errors (lib/errors.ts).
  client ??= createBrowserClient(url!, anonKey!, { global: { fetch: (...args) => globalThis.fetch(...args) } });
  return client;
}
