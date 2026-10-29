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
  top_before: number;
  top_closed: boolean;
  top_answers: string[] | null;
  top_counts: number[] | null;
  commenters: string[] | null;
  commenter_count: number;
  comment_question: string | null;
  requesters: string[] | null;
  lunch_sent: boolean;
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

/** One of a few wordings, the same all day for a person, so two emails don't read alike. */
function pick<T>(options: T[], seed: string): T {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return options[h % options.length];
}

const MILESTONES = [100, 50, 25, 10];

/** How the top poll's race looks, without ever saying which answer leads. */
export type Race = "closed" | "milestone" | "first" | "tie" | "neck" | "ahead" | "plain";
export function raceOf(row: Pick<SummaryRow, "top_closed" | "top_votes" | "top_before" | "top_counts">): { race: Race; total: number; milestone?: number } {
  const counts = [...(row.top_counts ?? [])].sort((a, b) => b - a);
  const total = counts.reduce((a, b) => a + b, 0);
  if (row.top_closed) return { race: "closed", total };
  const milestone = MILESTONES.find((m) => total >= m && total - row.top_votes < m);
  if (milestone) return { race: "milestone", total, milestone };
  if (row.top_before === 0 && row.top_votes > 0) return { race: "first", total };
  if (total < 2) return { race: "plain", total };
  if (counts[0] === counts[1]) return { race: "tie", total };
  if (total >= 4 && (counts[0] - counts[1]) / total <= 0.1) return { race: "neck", total };
  return { race: "ahead", total };
}

type Item = { icon: string; text: string };

/** Subject, preview line, HTML and plain text for one person. Props never say who. */
export function composeSummary(row: SummaryRow, site: URL) {
  const day = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const vary = <T,>(key: string, options: T[]) => pick(options, `${row.user_id}:${day}:${row.slot}:${key}`);
  const quote = row.top_question ? `“${row.top_question}”` : null;
  const commentQuote = row.comment_question ? `“${row.comment_question}”` : null;
  const commenters = names(row.commenters, row.commenter_count || row.comments);
  const requesters = names(row.requesters, row.requests);
  const wantFriends = `${requesters} ${row.requests === 1 ? "wants" : "want"} to be friends`;
  const { race, total, milestone } = raceOf(row);
  const newVotes = quote ? row.top_votes : row.votes;
  const otherVotes = quote ? row.votes - row.top_votes : 0;

  // The strongest thing leads: props, then friend requests, then votes (or a poll that just closed), then comments.
  const lead: "props" | "requests" | "votes" | "comments" = row.props
    ? "props"
    : row.requests
      ? "requests"
      : row.votes || row.top_closed
        ? "votes"
        : "comments";

  type Block = { subject: string; title: string; sub: string; cta: string; path: string; bg: string };
  const poll = row.top_poll ? `/p/${row.top_poll}` : "/";
  const votesOn = quote ? `${plural(newVotes, "new vote", "new votes")} on ${quote}` : plural(newVotes, "new vote on your polls", "new votes on your polls");
  const votes: Record<Race, Block> = {
    closed: {
      subject: vary("s", [`The final result is in for ${quote}`, `Your poll ${quote} has closed`]),
      title: "Your poll has closed",
      sub: `${quote} got ${plural(total, "vote", "votes")}. The final result is in.`,
      cta: "See the final result →",
      path: poll,
      bg: "#e6f8f1",
    },
    milestone: {
      subject: vary("s", [`${quote} just passed ${milestone} votes 🎉`, `${milestone} votes on ${quote} 🎉`]),
      title: `${milestone} votes and counting 🎉`,
      sub: `on ${quote}`,
      cta: "See the results →",
      path: poll,
      bg: "#ffe3da",
    },
    first: {
      subject: vary("s", [`Your first vote is in on ${quote}`, `Someone just voted on ${quote}`]),
      title: "Your first vote is in",
      sub: newVotes > 1 ? votesOn : `on ${quote}`,
      cta: "See what they picked →",
      path: poll,
      bg: "#fff3d1",
    },
    tie: {
      subject: vary("s", [`It's a tie on ${quote} 👀`, `${quote} is tied right now`]),
      title: vary("t", ["It's a tie right now", "Dead even, for now"]),
      sub: `${plural(total, "vote", "votes")} on ${quote}, split right down the middle`,
      cta: "See the tie →",
      path: poll,
      bg: "#fff3d1",
    },
    neck: {
      subject: vary("s", [`${quote} is neck and neck`, `It's close on ${quote} 👀`]),
      title: vary("t", ["It's neck and neck", "It's a close one"]),
      sub: votesOn,
      cta: "See who's ahead →",
      path: poll,
      bg: "#fff3d1",
    },
    ahead: {
      subject: vary("s", [`One answer is pulling ahead on ${quote}`, `There's a front-runner on ${quote}`]),
      title: vary("t", ["One answer is pulling ahead", "Someone's taking the lead", "There's a front-runner"]),
      sub: votesOn,
      cta: "See which one →",
      path: poll,
      bg: "#fff3d1",
    },
    plain: {
      subject: quote ? `${plural(newVotes, "person", "people")} voted on ${quote}` : `${plural(row.votes, "new vote", "new votes")} on your polls`,
      title: plural(newVotes, "new vote", "new votes"),
      sub: quote ? `on ${quote}` : "on your polls",
      cta: "See the votes →",
      path: poll,
      bg: "#fff3d1",
    },
  };
  const blocks: Record<typeof lead, Block> = {
    props: {
      subject: row.props === 1 ? vary("s", ["💜 Someone picked you for props", "💜 A friend picked you for something"]) : vary("s", [`💜 ${row.props} friends picked you for props`, `💜 You got ${row.props} props`]),
      title: row.props === 1 ? "💜 You got props" : `💜 ${row.props} props for you`,
      sub: `${row.props === 1 ? "A friend" : "Friends"} picked you. We'll never say who. Open Eithr to see what for.`,
      cta: "See your props →",
      path: "/activity",
      bg: "#efe8ff",
    },
    requests: {
      subject: row.requests === 1 ? vary("s", [`${wantFriends} on Eithr`, `${requesters} sent you a friend request`]) : vary("s", [`${wantFriends} on Eithr`, `${row.requests} friend requests waiting on Eithr`]),
      title: row.requests === 1 ? `👋 ${wantFriends}` : `👋 ${row.requests} friend requests`,
      sub: row.requests === 1 ? "Open Eithr to say yes." : `${wantFriends}.`,
      cta: row.requests === 1 ? "See the request →" : "See the requests →",
      path: "/friends",
      bg: "#e3f1ff",
    },
    votes: votes[race],
    comments: {
      subject: commentQuote ? vary("s", [`${commenters} commented on ${commentQuote}`, `New comments on ${commentQuote}`]) : `${commenters} commented on your poll`,
      title: row.commenter_count > 1 ? `💬 ${row.commenter_count} people commented` : `💬 ${commenters} commented`,
      sub: commentQuote ? `on ${commentQuote}. Join the conversation.` : "on your poll. Join the conversation.",
      cta: "Read the comments →",
      path: row.top_poll ? poll : "/activity",
      bg: "#e6f8f1",
    },
  };
  const big = blocks[lead];

  const items: Item[] = [];
  if (lead !== "props" && row.props) items.push({ icon: "💜", text: `${plural(row.props, "friend", "friends")} picked you for props (never who)` });
  if (lead !== "requests" && row.requests) items.push({ icon: "👋", text: wantFriends });
  if (lead !== "votes" && row.votes) items.push({ icon: "🗳️", text: votesOn });
  if (lead !== "votes" && row.top_closed) items.push({ icon: "🏁", text: `${quote} has closed. The final result is in` });
  if (otherVotes > 0) items.push({ icon: "🗳️", text: plural(otherVotes, "more vote on your other polls", "more votes on your other polls") });
  if (lead !== "comments" && row.comments) items.push({ icon: "💬", text: `${commenters} commented` });
  const preview = items.length ? `Plus ${items.map((i) => i.text).join(", ")}.` : "Open Eithr to see it.";
  // The answers, with the result hidden: opening Eithr is the only way to see who's winning.
  const answers = lead === "votes" && race !== "plain" ? (row.top_answers ?? []).slice(0, 4) : [];

  const open = new URL(big.path, site);
  open.searchParams.set("utm_source", "email");
  open.searchParams.set("utm_campaign", `summary-${row.slot}`);
  const off = new URL("/api/email/unsubscribe", site);
  off.searchParams.set("u", row.user_id);
  off.searchParams.set("t", unsubscribeToken(row.user_id));
  const name = row.username ? `@${row.username}` : "there";
  const greeting =
    row.slot === "lunch" ? `Hi ${name}, here's your morning on Eithr:` : row.lunch_sent ? `Hi ${name}, since lunch:` : `Hi ${name}, here's your day on Eithr:`;
  const why = "You're getting this because notifications aren't on for Eithr. Turn them on and you'll get these on your phone instead.";

  const text = [
    greeting,
    "",
    big.title,
    big.sub,
    ...items.map((i) => `• ${i.text}`),
    "",
    `${big.cta.replace(" →", "")}: ${open}`,
    "",
    why,
    `Stop these emails: ${off}`,
  ].join("\n");

  // Two to a row, so long answers and 4-answer polls still fit a small phone.
  const answerRows: string[] = [];
  for (let i = 0; i < answers.length; i += 2) {
    const pair = answers.slice(i, i + 2);
    answerRows.push(
      `<tr>${pair
        .map((a) => `<td width="50%" valign="top" style="border:2px solid #1b1530;border-radius:12px;padding:8px 10px;background:#ffffff;font-size:14px;font-weight:700;word-break:break-word">${esc(a)}<br><span style="color:#5a5370;letter-spacing:2px">???</span></td>`)
        .join("")}${pair.length === 1 ? '<td width="50%"></td>' : ""}</tr>`,
    );
  }
  const html = `<!doctype html><html><body style="margin:0;background:#fff7ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1b1530">
<div style="display:none;max-height:0;overflow:hidden">${esc(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ec;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:2px solid #1b1530;border-radius:20px;padding:22px">
<tr><td style="font-size:22px;font-weight:800;padding-bottom:4px">eithr<span style="color:#ff7a59">?</span></td></tr>
<tr><td style="font-size:16px;padding:10px 0 14px">${esc(greeting)}</td></tr>
<tr><td style="background:${big.bg};border:2px solid #1b1530;border-radius:16px;padding:14px 16px">
<div style="font-size:26px;font-weight:800;line-height:1.15">${esc(big.title)}</div>
<div style="font-size:15px;color:#5a5370;padding-top:6px">${esc(big.sub)}</div>
${answerRows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:6px -6px 0;table-layout:fixed;border-collapse:separate">${answerRows.join("")}</table>` : ""}
</td></tr>
${items.map((i) => `<tr><td style="font-size:15px;padding:10px 0 0">${i.icon}&nbsp; ${esc(i.text)}</td></tr>`).join("\n")}
<tr><td style="padding:20px 0 6px"><a href="${esc(open.toString())}" style="display:inline-block;background:#ff7a59;color:#1b1530;border:2px solid #1b1530;border-radius:14px;padding:12px 22px;font-size:17px;font-weight:800;text-decoration:none">${esc(big.cta)}</a></td></tr>
<tr><td style="font-size:12.5px;color:#5a5370;padding-top:14px;line-height:1.5;border-top:1px solid #e3d9ca">${esc(why)}<br><a href="${esc(off.toString())}" style="color:#5a5370">Stop these emails</a></td></tr>
</table></td></tr></table></body></html>`;

  return { subject: big.subject, preview, html, text, unsubscribe: off.toString() };
}

/** Sends one email with Resend. On failure, `error` is Resend's message. */
async function send(to: string, m: ReturnType<typeof composeSummary>, kind: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: m.subject,
      html: m.html,
      text: m.text,
      // One-click unsubscribe in Gmail and Apple Mail.
      headers: { "List-Unsubscribe": `<${m.unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      tags: [{ name: "kind", value: kind }],
    }),
    cache: "no-store",
  });
  if (res.ok) return { ok: true };
  const body = (await res.text()).slice(0, 300);
  console.error("email:", res.status, body);
  let error = body;
  try {
    error = (JSON.parse(body) as { message?: string }).message ?? body;
  } catch {
    // Not JSON: keep the text.
  }
  return { ok: false, error };
}

const sendOne = async (row: SummaryRow, site: URL) => (await send(row.email, composeSummary(row, site), "summary")).ok;

/** The versions the admin's "Send me a test email" can pick, with sample data. */
export const TEST_VERSIONS = ["props", "request", "comments", "first", "tie", "neck", "ahead", "milestone", "closed"] as const;
export type TestVersion = (typeof TEST_VERSIONS)[number];

export function sampleRow(version: TestVersion, me: { user_id: string; email: string; username: string }): SummaryRow {
  const poll = {
    top_poll: null,
    top_question: "Goa or Manali?",
    top_answers: ["🏖️ Goa", "🏔️ Manali"],
    top_votes: 0,
    top_before: 0,
    top_closed: false,
    top_counts: [0, 0],
  };
  const base: SummaryRow = {
    ...me,
    slot: "evening",
    votes: 0,
    comments: 0,
    props: 0,
    requests: 0,
    ...poll,
    commenters: [],
    commenter_count: 0,
    comment_question: null,
    requesters: [],
    lunch_sent: false,
  };
  const race = {
    first: { votes: 1, top_votes: 1, top_before: 0, top_counts: [1, 0] },
    tie: { votes: 2, top_votes: 2, top_before: 4, top_counts: [3, 3] },
    neck: { votes: 3, top_votes: 3, top_before: 28, top_counts: [16, 15] },
    ahead: { votes: 3, top_votes: 2, top_before: 7, top_counts: [7, 2] },
    milestone: { votes: 4, top_votes: 4, top_before: 22, top_counts: [14, 12] },
    closed: { top_closed: true, top_counts: [18, 13] },
  };
  switch (version) {
    case "props":
      return { ...base, props: 1, votes: 2, top_votes: 2, top_before: 7, top_counts: [7, 2], requests: 1, requesters: ["arjun"] };
    case "request":
      return { ...base, requests: 2, requesters: ["arjun", "riya"], comments: 1, commenters: ["kabir"], commenter_count: 1, comment_question: "Goa or Manali?" };
    case "comments":
      return { ...base, top_question: null, top_answers: [], comments: 4, commenters: ["kabir", "meera", "dev"], commenter_count: 3, comment_question: "Goa or Manali?" };
    default:
      return { ...base, ...race[version], comments: 1, commenters: ["kabir"], commenter_count: 1, comment_question: "Goa or Manali?" };
  }
}

/** The admin's test: one sample email to their own address, marked [Test]. */
export async function sendTest(version: TestVersion, me: { user_id: string; email: string; username: string }) {
  const m = composeSummary(sampleRow(version, me), siteUrl());
  return send(me.email, { ...m, subject: `[Test] ${m.subject}` }, "test");
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
