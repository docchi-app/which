// Server only: our API routes and the 2-minute job report their errors to Admin → Errors
// (with the job's secret; without PUSH_CRON_SECRET nothing is reported).
import { cronSecret, rpc } from "./push-server";

/** Records a server or job error. Never throws. */
export async function reportServerError(place: string, e: unknown, source: "server" | "job" = "server"): Promise<void> {
  if (!cronSecret) return;
  const err = e instanceof Error ? e : null;
  const message = (err?.message ?? (typeof e === "string" ? e : JSON.stringify(e) ?? String(e))).slice(0, 300);
  try {
    await rpc("report_server_error", {
      secret: cronSecret,
      source,
      kind: err?.name ?? "Error",
      message,
      place,
      code: null,
      stack: err?.stack?.split("\n").slice(0, 8).join("\n").slice(0, 800) ?? null,
    });
  } catch {
    // The database is down too: the server log still has it.
  }
}
