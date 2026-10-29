import { createHash } from "node:crypto";
import { cronSecret, rpc } from "@/lib/push-server";
import { reportServerError } from "@/lib/server-errors";

// Views from signed-out visitors (opened from a WhatsApp or X link). The visitor
// is a hash of their connection and browser plus our secret: nothing personal is
// stored, and a count can't be faked from the browser. See src/lib/views.ts.

const BOTS = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|discord|slack|preview|headless/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const done = () => new Response(null, { status: 204 });

export async function POST(request: Request) {
  const agent = request.headers.get("user-agent") ?? "";
  if (!cronSecret || !agent || BOTS.test(agent)) return done();
  let ids: string[] = [];
  try {
    const body = (await request.json()) as { ids?: unknown };
    if (Array.isArray(body.ids)) ids = body.ids.filter((x): x is string => typeof x === "string" && UUID.test(x)).slice(0, 50);
  } catch {}
  if (!ids.length) return done();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
  const key = createHash("sha256").update(`${ip}|${agent}|${cronSecret}`).digest("hex");
  try {
    await rpc<number>("record_views_anon", { secret: cronSecret, key, polls: ids });
  } catch (e) {
    console.error("views:", e instanceof Error ? e.message : e);
    await reportServerError("/api/views", e);
    return new Response(null, { status: 502 });
  }
  return done();
}
