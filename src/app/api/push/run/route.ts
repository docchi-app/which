import { cronSecret, pushConfigured, rpc, sendAll, type PushPayload } from "@/lib/push-server";
import { sweepTexts } from "@/lib/text-moderation";
import { sendSummaries } from "@/lib/email-server";

// Called by pg_cron (via pg_net) every 2 minutes; see supabase/migrations/20261105000000_push.sql.
export const maxDuration = 60;

type Row = { id: number; endpoint: string; p256dh: string; auth: string; payload: PushPayload };

export async function POST(request: Request) {
  if (!pushConfigured) return Response.json({ error: "push isn't configured" }, { status: 503 });
  if (request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() !== cronSecret) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const started = Date.now();
  const total: Record<string, unknown> & { sent: number; gone: number; failed: number } = { sent: 0, gone: 0, failed: 0 };
  // Typed polls and comments the app didn't send for the AI check (see /api/moderate/check).
  try {
    total.checked = await sweepTexts();
  } catch (e) {
    console.error("text sweep:", e instanceof Error ? e.message : e);
  }
  // A few batches per run, leaving time to finish before the limit.
  for (let batch = 0; batch < 10 && Date.now() - started < 40_000; batch++) {
    let rows: Row[];
    try {
      rows = await rpc<Row[]>("push_collect", { secret: cronSecret, max_rows: 300 });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("push run:", message);
      const error = message.includes("forbidden") ? "secret_mismatch" : "collect_failed";
      // Only the cron (which knows the secret) sees this; it lands in net._http_response.
      return Response.json({ error, detail: message.slice(0, 300), ...total }, { status: 500 });
    }
    if (!rows.length) break;
    const result = await sendAll(rows.map((r) => ({ target: r, payload: r.payload })));
    if (result.gone.length) await rpc("push_gone", { secret: cronSecret, endpoints: result.gone });
    total.sent += result.sent;
    total.gone += result.gone.length;
    total.failed += result.failed;
    if (result.firstError) Object.assign(total, { error: result.firstError });
    if (rows.length < 300) break;
  }
  // The evening email for people push can't reach (only 6–9 pm India time; off without RESEND_API_KEY).
  try {
    const mail = await sendSummaries();
    if (mail.sent || mail.failed) total.emails = mail;
  } catch (e) {
    console.error("email summaries:", e instanceof Error ? e.message : e);
  }
  return Response.json(total);
}
