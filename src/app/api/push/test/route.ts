import { cronSecret, pushConfigured, rpc, sendAll, userFromToken, type PushTarget } from "@/lib/push-server";

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
    const tooMany = e instanceof Error && e.message.includes("too_many");
    return Response.json({ error: tooMany ? "too_many" : "failed" }, { status: tooMany ? 429 : 500 });
  }
  const result = await sendAll(
    targets.map((target) => ({
      target,
      payload: { title: "Notifications are on 🎉", body: "This is how Docchi taps you on the shoulder.", url: "/profile", tag: "test" },
    })),
  );
  if (result.gone.length) await rpc("push_gone", { secret: cronSecret, endpoints: result.gone });
  return Response.json({ sent: result.sent });
}
