import { emailConfigured, sendTest, TEST_VERSIONS, type TestVersion } from "@/lib/email-server";
import { rpc } from "@/lib/push-server";

/** Admin only: "Send me a test email" sends one sample email to the admin's own address now. */
export async function POST(request: Request) {
  if (!emailConfigured) return Response.json({ error: "not_configured" }, { status: 503 });
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return Response.json({ error: "sign_in" }, { status: 401 });
  const { version } = (await request.json().catch(() => ({}))) as { version?: string };
  if (!TEST_VERSIONS.includes(version as TestVersion)) return Response.json({ error: "version" }, { status: 400 });

  // As the signed-in person: the database checks they're the admin and gives their own address.
  let me: { user_id: string; email: string; username: string };
  try {
    me = await rpc("admin_test_email", { version }, token);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    for (const error of ["not_admin", "too_many", "no_email"]) {
      if (message.includes(error)) return Response.json({ error }, { status: error === "too_many" ? 429 : 403 });
    }
    if (message.includes("PGRST202")) return Response.json({ error: "no_migration" }, { status: 500 });
    if (message.includes(": 401")) return Response.json({ error: "sign_in" }, { status: 401 });
    console.error("email test:", message);
    return Response.json({ error: "failed" }, { status: 500 });
  }
  const sent = await sendTest(version as TestVersion, me).catch((e) => ({ ok: false, error: String(e) }));
  if (!sent.ok) return Response.json({ error: "send_failed", detail: sent.error }, { status: 502 });
  return Response.json({ sent: true, to: me.email });
}
