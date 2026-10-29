// Server only: the evening "what you missed" email, for people push can't reach (see
// supabase/migrations/20261201000000_email_summary.sql). Sent with Resend's HTTP API; every
// email has a one-click "Stop these emails" link, signed so nobody can turn off someone else's.
import { createHmac, timingSafeEqual } from "node:crypto";
import { cronSecret, rpc } from "./push-server";
import { siteUrl } from "./server-poll";

const env = (name: string) => process.env[name]?.trim() || undefined;
const RESEND_KEY = env("RESEND_API_KEY");
const FROM = env("EMAIL_FROM") ?? "Eithr <hello@eithr.app>";

export const emailConfigured = Boolean(RESEND_KEY && cronSecret);

/** The signature on a person's "Stop these emails" link. */
export function unsubscribeToken(userId: string): string {
  return createHmac("sha256", cronSecret ?? "").update(`email-off:${userId}`).digest("base64url");
}

export function checkUnsubscribe(userId: string, token: string): boolean {
  if (!cronSecret || !/^[0-9a-f-]{36}$/i.test(userId)) return false;
  const want = Buffer.from(unsubscribeToken(userId));
  const got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got);
}

export type SummaryRow = {
  user_id: string;
  email: string;
  username: string;
  votes: number;
  comments: number;
  props: number;
  requests: number;
  top_poll: string | null;
  top_question: string | null;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Subject, HTML and plain text for one person. Props never say who. */
export function composeSummary(row: SummaryRow, site: URL) {
  const items: string[] = [];
  if (row.votes) items.push(plural(row.votes, "new vote on your polls", "new votes on your polls"));
  if (row.props) items.push(`💜 ${plural(row.props, "friend picked you for props", "friends picked you for props")} (never who)`);
  if (row.comments) items.push(plural(row.comments, "new comment on your polls", "new comments on your polls"));
  if (row.requests) items.push(plural(row.requests, "friend request", "friend requests"));
  const headline = [
    row.votes ? plural(row.votes, "vote", "votes") : null,
    row.props ? `💜 ${plural(row.props, "prop", "props")}` : null,
    row.comments ? plural(row.comments, "comment", "comments") : null,
    row.requests ? plural(row.requests, "friend request", "friend requests") : null,
  ]
    .filter(Boolean)
    .join(", ");
  const subject = `What you missed on Eithr: ${headline}`;
  const open = new URL(row.top_poll ? `/p/${row.top_poll}` : row.props || row.requests ? "/activity" : "/", site);
  open.searchParams.set("utm_source", "email");
  open.searchParams.set("utm_campaign", "summary");
  const off = new URL("/api/email/unsubscribe", site);
  off.searchParams.set("u", row.user_id);
  off.searchParams.set("t", unsubscribeToken(row.user_id));
  const name = row.username ? `@${row.username}` : "there";
  const quote = row.top_question ? `“${row.top_question}”` : null;

  const text = [
    `Hi ${name},`,
    "",
    "While you were away:",
    ...items.map((i) => `• ${i}`),
    ...(quote ? ["", `Your poll ${quote} is getting votes.`] : []),
    "",
    `See it: ${open}`,
    "",
    "You're getting this because Eithr can't send notifications to your phone. Add Eithr to your Home Screen and turn them on, and these emails stop by themselves.",
    `Stop these emails: ${off}`,
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;background:#fff7ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1b1530">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ec;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:2px solid #1b1530;border-radius:20px;padding:24px">
<tr><td style="font-size:22px;font-weight:800;padding-bottom:4px">eithr<span style="color:#ff7a59">?</span></td></tr>
<tr><td style="font-size:16px;padding:12px 0 6px">Hi ${esc(name)}, while you were away:</td></tr>
${items.map((i) => `<tr><td style="font-size:17px;font-weight:700;padding:6px 0">• ${esc(i)}</td></tr>`).join("\n")}
${quote ? `<tr><td style="font-size:15px;color:#5a5370;padding:10px 0 0">Your poll ${esc(quote)} is getting votes.</td></tr>` : ""}
<tr><td style="padding:20px 0 6px"><a href="${esc(open.toString())}" style="display:inline-block;background:#ff7a59;color:#1b1530;border:2px solid #1b1530;border-radius:14px;padding:12px 22px;font-size:17px;font-weight:800;text-decoration:none">See what's waiting →</a></td></tr>
<tr><td style="font-size:13px;color:#5a5370;padding-top:18px;line-height:1.5">You're getting this because Eithr can't send notifications to your phone. Add Eithr to your Home Screen and turn them on, and these emails stop by themselves.<br><a href="${esc(off.toString())}" style="color:#5a5370">Stop these emails</a></td></tr>
</table></td></tr></table></body></html>`;

  return { subject, html, text, unsubscribe: off.toString() };
}

async function sendOne(row: SummaryRow, site: URL): Promise<boolean> {
  const m = composeSummary(row, site);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [row.email],
      subject: m.subject,
      html: m.html,
      text: m.text,
      // One-click unsubscribe in Gmail and Apple Mail.
      headers: { "List-Unsubscribe": `<${m.unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      tags: [{ name: "kind", value: "summary" }],
    }),
    cache: "no-store",
  });
  if (!res.ok) console.error("email:", res.status, (await res.text()).slice(0, 200));
  return res.ok;
}

/** For the 2-minute job: sends whatever's due (6–9 pm India time). Returns how many went out. */
export async function sendSummaries(): Promise<{ sent: number; failed: number }> {
  const total = { sent: 0, failed: 0 };
  if (!emailConfigured) return total;
  const rows = await rpc<SummaryRow[]>("email_summary_collect", { secret: cronSecret, max_rows: 20 });
  const site = siteUrl();
  // One at a time: Resend's free plan allows 2 a second.
  for (const row of rows ?? []) {
    const ok = await sendOne(row, site).catch(() => false);
    total[ok ? "sent" : "failed"]++;
    await new Promise((r) => setTimeout(r, 550));
  }
  return total;
}
