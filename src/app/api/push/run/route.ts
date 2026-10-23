import { cronSecret, pushConfigured, rpc, sendAll, type PushPayload } from "@/lib/push-server";

// Called by pg_cron (via pg_net) every 2 minutes; see supabase/migrations/20261105000000_push.sql.
export const maxDuration = 60;

type Row = { id: number; endpoint: string; p256dh: string; auth: string; payload: PushPayload };

export async function POST(request: Request) {
  if (!pushConfigured) return Response.json({ error: "push isn't configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const started = Date.now();
  const total = { sent: 0, gone: 0, failed: 0 };
  // A few batches per run, leaving time to finish before the limit.
  for (let batch = 0; batch < 10 && Date.now() - started < 40_000; batch++) {
    const rows = await rpc<Row[]>("push_collect", { secret: cronSecret, max_rows: 300 });
    if (!rows.length) break;
    const result = await sendAll(rows.map((r) => ({ target: r, payload: r.payload })));
    if (result.gone.length) await rpc("push_gone", { secret: cronSecret, endpoints: result.gone });
    total.sent += result.sent;
    total.gone += result.gone.length;
    total.failed += result.failed;
    if (rows.length < 300) break;
  }
  return Response.json(total);
}
