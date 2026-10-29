import { cronSecret, pushConfigured, rpc, sendAll, userFromToken, type PushTarget } from "@/lib/push-server";
import { reportServerError } from "@/lib/server-errors";

/** "Send me a test": pushes to the signed-in person's own devices right away. */
export async function POST(request: Request) {
  if (!pushConfigured) return Response.json({ error: "not_configured" }, { status: 503 });
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const user = token ? await userFromToken(token) : null;
  if (!user) return Response.json({ error: "sign_in" }, { status: 401 });

  let targets: PushTarget[];
  try {
    targets = await rpc<PushTarget[]>("push_test_targets", { secret: cronSecret, person: user });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("push test:", message);
    if (!message.includes("too_many")) await reportServerError("/api/push/test", e);
    if (message.includes("too_many")) return Response.json({ error: "too_many" }, { status: 429 });
    // The database doesn't know this secret: schedule_push() wasn't run, or with another value.
    if (message.includes("forbidden")) return Response.json({ error: "secret_mismatch" }, { status: 500 });
    if (message.includes("PGRST202")) return Response.json({ error: "no_migration" }, { status: 500 });
    return Response.json({ error: "failed" }, { status: 500 });
  }
  if (!targets.length) return Response.json({ error: "no_device" }, { status: 404 });
  const result = await sendAll(
    targets.map((target) => ({
      target,
      payload: { title: "Notifications are on 🎉", body: "This is how Eithr taps you on the shoulder.", url: "/profile", tag: "test" },
    })),
  );
  if (result.gone.length) await rpc("push_gone", { secret: cronSecret, endpoints: result.gone });
  if (!result.sent) {
    // Usually the VAPID keys in Vercel don't match each other (403 from the push service).
    return Response.json({ error: result.gone.length ? "no_device" : "send_failed", detail: result.firstError }, { status: 502 });
  }
  return Response.json({ sent: result.sent });
}
