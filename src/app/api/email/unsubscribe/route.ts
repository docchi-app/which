import { checkUnsubscribe } from "@/lib/email-server";
import { cronSecret, rpc } from "@/lib/push-server";

// "Stop these emails": the link in every summary (GET), and Gmail / Apple Mail's
// one-click button (POST, from the List-Unsubscribe header). The link is signed per person.

async function stop(request: Request): Promise<boolean> {
  const params = new URL(request.url).searchParams;
  const user = params.get("u") ?? "";
  if (!checkUnsubscribe(user, params.get("t") ?? "")) return false;
  await rpc("email_unsubscribe", { secret: cronSecret, person: user });
  return true;
}

function page(title: string, text: string, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} · Eithr</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#fff7ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1b1530">
<main style="max-width:420px;margin:24px;padding:24px;background:#fff;border:2px solid #1b1530;border-radius:20px">
<h1 style="margin:0 0 8px;font-size:24px">${title}</h1><p style="margin:0 0 18px;line-height:1.5;color:#5a5370">${text}</p>
<a href="/" style="display:inline-block;background:#ff7a59;color:#1b1530;border:2px solid #1b1530;border-radius:14px;padding:10px 18px;font-weight:800;text-decoration:none">Open Eithr</a></main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  try {
    if (!(await stop(request))) return page("That link didn't work", "It may be cut short. You can also turn these emails off in Eithr: Settings → Email me what I missed.", 400);
    return page("Done, no more emails", "You won't get Eithr's evening summary any more. You can turn it back on in Settings.");
  } catch {
    return page("That didn't work", "Try again in a bit, or turn these emails off in Eithr: Settings → Email me what I missed.", 500);
  }
}

export async function POST(request: Request) {
  try {
    return new Response(null, { status: (await stop(request)) ? 200 : 400 });
  } catch {
    return new Response(null, { status: 500 });
  }
}
