// Server only: the "what you missed" emails (lunch and evening), for people push can't reach
// (see supabase/migrations/20261201000000_email_summary.sql and 20261202000000_email_twice.sql).
// Sent with Resend's HTTP API; every email has a one-click "Stop these emails" link, signed so
// nobody can turn off someone else's.
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
  slot: "lunch" | "evening";
  votes: number;
  comments: number;
  props: number;
  requests: number;
  top_poll: string | null;
  top_question: string | null;
  top_votes: number;
  top_answers: string[] | null;
  commenters: string[] | null;
  commenter_count: number;
  requesters: string[] | null;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** "@a", "@a and @b", "@a, @b and 3 others". */
function names(list: string[] | null, total: number): string {
  const at = (list ?? []).slice(0, total > 3 ? 2 : 3).map((n) => `@${n}`);
  const rest = Math.max(total - at.length, 0);
  if (rest) return `${at.join(", ")} and ${plural(rest, "other", "others")}`;
  return at.length > 1 ? `${at.slice(0, -1).join(", ")} and ${at[at.length - 1]}` : (at[0] ?? "Someone");
}

type Item = { icon: string; text: string };

/** Subject, preview line, HTML and plain text for one person. Props never say who. */
export function composeSummary(row: SummaryRow, site: URL) {
  const quote = row.top_question ? `“${row.top_question}”` : null;
  const commenters = names(row.commenters, row.commenter_count || row.comments);
  const requesters = names(row.requesters, row.requests);
  const wantFriends = `${requesters} ${row.requests === 1 ? "wants" : "want"} to be friends`;
  const voteLine = quote ? `${plural(row.top_votes, "new vote", "new votes")} on ${quote}` : plural(row.votes, "new vote on your polls", "new votes on your polls");
  const otherVotes = quote ? row.votes - row.top_votes : 0;

  // The strongest thing leads: props, then friend requests, then votes, then comments.
  const lead: "props" | "requests" | "votes" | "comments" = row.props ? "props" : row.requests ? "requests" : row.votes ? "votes" : "comments";
  const subject = {
    props: row.props === 1 ? "💜 Someone picked you for props" : `💜 ${row.props} friends picked you for props`,
    requests: `${wantFriends} on Eithr`,
    votes: quote ? `${plural(row.top_votes, "person", "people")} voted on ${quote}` : `${plural(row.votes, "new vote", "new votes")} on your polls`,
    comments: `${commenters} commented on your poll`,
  }[lead];
  const path = { props: "/activity", requests: "/friends", votes: row.top_poll ? `/p/${row.top_poll}` : "/", comments: row.top_poll ? `/p/${row.top_poll}` : "/activity" }[lead];
  const cta = { props: "See your props →", requests: "See the request →", votes: "See who's winning →", comments: "Read the comments →" }[lead];

  const items: Item[] = [];
  if (lead !== "props" && row.props) items.push({ icon: "💜", text: `${plural(row.props, "friend", "friends")} picked you for props (never who)` });
  if (lead !== "requests" && row.requests) items.push({ icon: "👋", text: wantFriends });
  if (lead !== "votes" && row.votes) items.push({ icon: "🗳️", text: voteLine });
  if (otherVotes > 0) items.push({ icon: "🗳️", text: plural(otherVotes, "more vote on your other polls", "more votes on your other polls") });
  if (lead !== "comments" && row.comments) items.push({ icon: "💬", text: `${commenters} commented` });
  const preview = items.length ? `Plus ${items.map((i) => i.text).join(", ")}.` : lead === "votes" ? "See who's winning." : "Open Eithr to see.";

  const big = {
    props: { title: row.props === 1 ? "💜 You got props" : `💜 ${row.props} props for you`, sub: "A friend picked you. We'll never say who. Open Eithr to see what for.", bg: "#efe8ff" },
    requests: { title: `👋 ${wantFriends}`, sub: "Open Eithr to say yes.", bg: "#e3f1ff" },
    votes: { title: plural(quote ? row.top_votes : row.votes, "new vote", "new votes"), sub: quote ? `on ${quote}` : "on your polls", bg: "#fff3d1" },
    comments: { title: `💬 ${commenters} commented`, sub: quote ? `on ${quote}` : "on your poll", bg: "#e6f8f1" },
  }[lead];
  // The answers, with the result hidden: opening Eithr is the only way to see who's winning.
  const answers = lead === "votes" ? (row.top_answers ?? []).slice(0, 4) : [];

  const open = new URL(path, site);
  open.searchParams.set("utm_source", "email");
  open.searchParams.set("utm_campaign", `summary-${row.slot}`);
  const off = new URL("/api/email/unsubscribe", site);
  off.searchParams.set("u", row.user_id);
  off.searchParams.set("t", unsubscribeToken(row.user_id));
  const name = row.username ? `@${row.username}` : "there";
  const greeting = `Hi ${name}, here's your ${row.slot === "lunch" ? "morning" : "afternoon"} on Eithr:`;
  const why = "You're getting this because notifications aren't on for Eithr. Turn them on and you'll get these on your phone instead.";

  const text = [
    greeting,
    "",
    `${big.title} ${big.sub}`,
    ...items.map((i) => `• ${i.text}`),
    "",
    `${cta.replace(" →", "")}: ${open}`,
    "",
    why,
    `Stop these emails: ${off}`,
  ].join("\n");

  const answerCells = answers
    .map((a) => `<td width="${Math.floor(100 / answers.length)}%" style="padding:3px"><div style="border:2px solid #1b1530;border-radius:12px;padding:8px 10px;background:#ffffff;font-size:14px;font-weight:700">${esc(a)} <span style="color:#5a5370;letter-spacing:2px">???</span></div></td>`)
    .join("");
  const html = `<!doctype html><html><body style="margin:0;background:#fff7ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1b1530">
<div style="display:none;max-height:0;overflow:hidden">${esc(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ec;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:2px solid #1b1530;border-radius:20px;padding:22px">
<tr><td style="font-size:22px;font-weight:800;padding-bottom:4px">eithr<span style="color:#ff7a59">?</span></td></tr>
<tr><td style="font-size:16px;padding:10px 0 14px">${esc(greeting)}</td></tr>
<tr><td style="background:${big.bg};border:2px solid #1b1530;border-radius:16px;padding:14px 16px">
<div style="font-size:26px;font-weight:800;line-height:1.15">${esc(big.title)}</div>
<div style="font-size:15px;color:#5a5370;padding-top:6px">${esc(big.sub)}</div>
${answerCells ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;table-layout:fixed"><tr>${answerCells}</tr></table>` : ""}
</td></tr>
${items.map((i) => `<tr><td style="font-size:15px;padding:10px 0 0">${i.icon}&nbsp; ${esc(i.text)}</td></tr>`).join("\n")}
<tr><td style="padding:20px 0 6px"><a href="${esc(open.toString())}" style="display:inline-block;background:#ff7a59;color:#1b1530;border:2px solid #1b1530;border-radius:14px;padding:12px 22px;font-size:17px;font-weight:800;text-decoration:none">${esc(cta)}</a></td></tr>
<tr><td style="font-size:12.5px;color:#5a5370;padding-top:14px;line-height:1.5;border-top:1px solid #e3d9ca">${esc(why)}<br><a href="${esc(off.toString())}" style="color:#5a5370">Stop these emails</a></td></tr>
</table></td></tr></table></body></html>`;

  return { subject, preview, html, text, unsubscribe: off.toString() };
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

/** For the 2-minute job: sends whatever's due (12:30–2 pm and 6:30–9 pm India time). Returns how many went out. */
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
