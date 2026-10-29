import { NextResponse, type NextRequest } from "next/server";
import { checkTexts, rpc, textCheckConfigured, type TextItem } from "@/lib/text-moderation";
import { reportServerError } from "@/lib/server-errors";

// Right after posting a typed poll or a comment, the app asks for the AI check of
// what it just posted (it's already live). Only the author's own, unchecked posts
// are looked at; the verdict is recorded with PUSH_CRON_SECRET, so only this route
// (and the 2-minute job) can.

export async function POST(request: NextRequest) {
  if (!textCheckConfigured) return NextResponse.json({ checked: 0, skipped: "not_configured" });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const { poll } = (await request.json().catch(() => ({}))) as { poll?: string };
  if (!token || !poll || !/^[0-9a-f-]{36}$/i.test(poll)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  try {
    const items = await rpc<TextItem[]>("my_unchecked_texts", { poll }, token);
    return NextResponse.json({ checked: items?.length ? await checkTexts(items) : 0 });
  } catch (e) {
    console.error("moderate check:", e instanceof Error ? e.message : e);
    await reportServerError("/api/moderate/check", e);
    // The 2-minute job picks it up.
    return NextResponse.json({ checked: 0, error: "check_failed" }, { status: 500 });
  }
}
