import { cronSecret, pushConfigured, rpc, sendAll, tagUrl, type PushPayload } from "@/lib/push-server";
import { sweepTexts } from "@/lib/text-moderation";
import { sweepTags } from "@/lib/poll-tags";
import { postDueDrafts, runAgentIfDue } from "@/lib/content-agent";
import { after } from "next/server";
import { sendSummaries } from "@/lib/email-server";
import { reportServerError } from "@/lib/server-errors";

// Called by pg_cron (via pg_net) every 2 minutes; see supabase/migrations/20261105000000_push.sql.
export const maxDuration = 60;

type Row = { id: number; endpoint: string; p256dh: string; auth: string; payload: PushPayload };
type Alert = { alert: PushPayload | null; targets?: { endpoint: string; p256dh: string; auth: string }[] };

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
    await reportServerError("Background job · AI text check", e, "job");
  }
  // A few batches per run, leaving time to finish before the limit.
  for (let batch = 0; batch < 10 && Date.now() - started < 40_000; batch++) {
    let rows: Row[];
    try {
      rows = await rpc<Row[]>("push_collect", { secret: cronSecret, max_rows: 300 });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("push run:", message);
      await reportServerError("Background job · push collect", e, "job");
      const error = message.includes("forbidden") ? "secret_mismatch" : "collect_failed";
      // Only the cron (which knows the secret) sees this; it lands in net._http_response.
      return Response.json({ error, detail: message.slice(0, 300), ...total }, { status: 500 });
    }
    if (!rows.length) break;
    const result = await sendAll(rows.map((r) => ({ target: r, payload: { ...r.payload, url: tagUrl(r.payload.url ?? "/", r.id) } })));
    if (result.gone.length) await rpc("push_gone", { secret: cronSecret, endpoints: result.gone });
    total.sent += result.sent;
    total.gone += result.gone.length;
    total.failed += result.failed;
    if (result.firstError) Object.assign(total, { error: result.firstError });
    if (result.failed) await reportServerError("Background job · push send", result.firstError ?? `${result.failed} pushes failed`, "job", result.firstDetail);
    if (rows.length < 300) break;
  }
  // The lunch and evening emails for people push can't reach (12:30–2 pm and 6:30–9 pm India time;
  // off without RESEND_API_KEY).
  try {
    const mail = await sendSummaries();
    if (mail.sent || mail.failed) total.emails = mail;
    if (mail.failed) await reportServerError("Background job · email", `${mail.failed} emails failed to send`, "job");
  } catch (e) {
    console.error("email summaries:", e instanceof Error ? e.message : e);
    await reportServerError("Background job · email", e, "job");
  }
  // Approved drafts whose time has come go live (Admin → Drafts).
  try {
    const posted = await postDueDrafts();
    if (posted) total.posted = posted;
  } catch (e) {
    console.error("drafts:", e instanceof Error ? e.message : e);
    await reportServerError("Background job · post drafts", e, "job");
  }
  // Tags for Admin → What people like (up to 20 polls, newest first), when there's time left.
  if (Date.now() - started < 30_000) {
    try {
      const tagged = await sweepTags();
      if (tagged) total.tagged = tagged;
    } catch (e) {
      console.error("poll tags:", e instanceof Error ? e.message : e);
      await reportServerError("Background job · poll tags", e, "job");
    }
  }
  // Errors: note this run, clear what's over 30 days, and tell the admin's phone about a new
  // error, a spike or one back after a fix (at most one an hour).
  try {
    const tick = await rpc<Alert>("errors_tick", { secret: cronSecret, run: total });
    if (tick.alert && tick.targets?.length) {
      const sent = await sendAll(tick.targets.map((target) => ({ target, payload: tick.alert! })));
      total.alerted = sent.sent;
    }
  } catch (e) {
    // Before the errors migration ran: nothing to do.
    console.error("errors tick:", e instanceof Error ? e.message : e);
  }
  // The admin's 9 am summary of yesterday (only when switched on in Settings), then the day's
  // tally of pushes sent, expired and failed for Admin → Notifications.
  try {
    const morning = await rpc<Alert>("morning_summary", { secret: cronSecret });
    if (morning.alert && morning.targets?.length) {
      const sent = await sendAll(morning.targets.map((target) => ({ target, payload: morning.alert! })));
      total.morning = sent.sent;
    }
  } catch (e) {
    console.error("morning summary:", e instanceof Error ? e.message : e);
  }
  try {
    await rpc("push_tally", { secret: cronSecret, sent: total.sent, expired: total.gone, failed: total.failed });
  } catch (e) {
    // Before the growth migration ran: nothing to do.
    console.error("push tally:", e instanceof Error ? e.message : e);
  }
  // The content agent (6:30 am India time, or "Write drafts now"), after this answer is sent:
  // it waits on OpenAI, so it shouldn't hold up the rest of the run.
  after(async () => {
    try {
      await runAgentIfDue();
    } catch (e) {
      console.error("content agent:", e instanceof Error ? e.message : e);
      await reportServerError("Background job · content agent", e, "job");
    }
  });
  return Response.json(total);
}
