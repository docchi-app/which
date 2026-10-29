import { NextResponse, type NextRequest } from "next/server";
import { moderate } from "@/lib/snap-moderation";
import { reportServerError } from "@/lib/server-errors";

// Runs the safety check on a snap that was just posted, as its creator, and
// records the verdict (signed with PUSH_CRON_SECRET so only this route can).

const env = (name: string) => process.env[name]?.trim() || undefined;
const url = env("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const secret = env("PUSH_CRON_SECRET");

const headers = (token: string) => ({ apikey: anonKey!, Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

async function rpc<T>(fn: string, args: Record<string, unknown>, token: string): Promise<T> {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers: headers(token), body: JSON.stringify(args), cache: "no-store" });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function POST(request: NextRequest) {
  if (!url || !anonKey) return NextResponse.json({ status: "pending", error: "not_configured" }, { status: 503 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const { poll } = (await request.json().catch(() => ({}))) as { poll?: string };
  if (!token || !poll) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  try {
    const [snap] = await rpc<{ photo_path: string; visibility: string; question: string }[]>("snap_for_check", { poll }, token);
    if (!snap) return NextResponse.json({ status: "done" }); // already checked, or not yours

    const img = await fetch(`${url}/storage/v1/object/authenticated/snaps/${snap.photo_path}`, { headers: headers(token), cache: "no-store" });
    if (!img.ok) throw new Error(`photo: ${img.status}`);
    const type = img.headers.get("content-type") ?? "image/jpeg";
    const dataUrl = `data:${type};base64,${Buffer.from(await img.arrayBuffer()).toString("base64")}`;

    const { verdict, scores } = await moderate(dataUrl, snap.question, snap.visibility);
    if (!secret) return NextResponse.json({ status: "pending", error: "no_secret" });
    const status = await rpc<string>("set_snap_verdict", { poll, verdict, scores, secret }, token);
    return NextResponse.json({ status });
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    await reportServerError("/api/snap/check", e);
    return NextResponse.json({ status: "pending", error: "check_failed" }, { status: 500 });
  }
}
