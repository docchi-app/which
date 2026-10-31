import { getSupabase } from "./supabase";
import { failureText } from "./failure";

// Props: compliment polls about your friends. Eithr writes the questions,
// the server picks the 4 friends, and who picked whom never reaches the app.

export type PropsState = {
  state: "ready" | "locked" | "done" | "sign_in";
  /** Questions left today (out of 10). */
  left?: number;
  /** Friends who can be picked (4 needed). */
  friends?: number;
  /** "Include me in Props" switched off. */
  off?: boolean;
};

export type PropOffer = {
  state: "ready";
  offer: string;
  emoji: string;
  label: string;
  question: string;
  shufflesLeft: number;
  left: number;
  options: { username: string; avatarUrl: string | null }[];
};

export type MyProps = { total: number; fresh: number; items: { emoji: string; label: string; count: number; fresh: number }[] };

export const PROPS_PER_DAY = 10;
export const PROPS_FRIENDS_NEEDED = 4;
/** Fired after a prop is given or skipped, so badges and counts can refresh. */
export const PROPS_CHANGED = "docchi:props-changed";

export class PropsError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const supabase = getSupabase();
  if (!supabase) throw new PropsError("demo");
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new PropsError(/docchi:(\w+)/.exec(error.message)?.[1] ?? "failed");
  return data as T;
}

type RawOffer = {
  state: string;
  offer: string;
  emoji: string;
  label: string;
  question: string;
  shuffles_left: number;
  left: number;
  options: { username: string; avatar_url: string | null }[];
};

function offer(d: RawOffer | PropsState): PropOffer | PropsState {
  if (d.state !== "ready" || !("offer" in d)) return d as PropsState;
  return {
    state: "ready",
    offer: d.offer,
    emoji: d.emoji,
    label: d.label,
    question: d.question,
    shufflesLeft: d.shuffles_left,
    left: d.left,
    options: d.options.map((o) => ({ username: o.username, avatarUrl: o.avatar_url })),
  };
}

export const isOffer = (x: PropOffer | PropsState | null): x is PropOffer => !!x && "offer" in x;

export const propsState = () => call<PropsState>("props_state");
export const nextProp = async () => offer(await call<RawOffer | PropsState>("next_prop"));
export const shuffleProp = async (id: string) => offer(await call<RawOffer>("shuffle_prop", { offer: id }));

export async function giveProp(id: string, username: string): Promise<PropsState> {
  const s = await call<PropsState>("give_prop", { offer: id, username });
  window.dispatchEvent(new Event(PROPS_CHANGED));
  return s;
}

export async function skipProp(id: string): Promise<PropsState> {
  const s = await call<PropsState>("skip_prop", { offer: id });
  window.dispatchEvent(new Event(PROPS_CHANGED));
  return s;
}

export async function myProps(): Promise<MyProps> {
  const d = await call<{ total: number; new: number; items: { emoji: string; label: string; count: number; new: number }[] }>("my_props");
  return { total: d.total, fresh: d.new, items: d.items.map((i) => ({ emoji: i.emoji, label: i.label, count: i.count, fresh: i.new })) };
}

export const propsNews = () => call<number>("props_news");

export async function markPropsSeen() {
  await call("mark_props_seen");
  window.dispatchEvent(new Event(PROPS_CHANGED));
}

export const setPropsOff = (off: boolean) => call("set_props_off", { off });
/** Admins, for testing: props picked for you arrive without the 5–30 minute wait. Reads it when `on` is null. */
export const propsNoWait = (on: boolean | null = null) => call<boolean>("admin_props_no_wait", { on_now: on });

export const PROPS_ERRORS: Record<string, string> = {
  sign_in: "Sign in to give props.",
  banned: "This account can't give props.",
  no_shuffles: "No more shuffles for this one.",
  no_offer: "That question has moved on. Here's the next one.",
  not_an_option: "That friend can't be picked right now.",
  demo: "Demo mode: Props need Supabase.",
};
export const propsErrorText = (e: unknown) => (e instanceof PropsError && PROPS_ERRORS[e.code]) || failureText(e);

/**
 * A shareable picture of one of my props ("My friends say: Best laugh ×7"),
 * drawn on the phone so nothing private goes to a server.
 */
export async function propsShareImage(item: { emoji: string; label: string; count: number }): Promise<Blob> {
  const W = 1080;
  const H = 1920;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#c4a8ff");
  grad.addColorStop(1, "#8b5cf6");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // Pop-poster shapes.
  g.lineWidth = 8;
  g.strokeStyle = "#1b1530";
  g.fillStyle = "#ffd23f";
  g.beginPath();
  g.arc(W - 60, 140, 260, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = "#52d6a8";
  g.save();
  g.translate(150, H - 260);
  g.rotate(0.25);
  g.fillRect(-110, -110, 220, 220);
  g.strokeRect(-110, -110, 220, 220);
  g.restore();
  await document.fonts.ready;
  const display = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() || "system-ui";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `260px ${display}`;
  g.fillText(item.emoji, W / 2, 720);
  g.fillStyle = "#ffffff";
  g.strokeStyle = "#1b1530";
  g.lineWidth = 6;
  g.font = `800 64px ${display}`;
  g.fillText("My friends say I have the", W / 2, 960);
  g.font = `800 104px ${display}`;
  wrap(g, item.label.toLowerCase(), W / 2, 1090, W - 160, 112);
  // "×7 props" pill.
  const pill = `×${item.count} ${item.count === 1 ? "prop" : "props"}`;
  g.font = `800 72px ${display}`;
  const pw = g.measureText(pill).width + 100;
  g.fillStyle = "#ffd23f";
  roundRect(g, (W - pw) / 2, 1290, pw, 120, 60);
  g.fill();
  g.stroke();
  g.fillStyle = "#1b1530";
  g.fillText(pill, W / 2, 1352);
  g.fillStyle = "#ffffff";
  g.font = `700 44px ${display}`;
  g.fillText("eithr.app · give your friends props 💜", W / 2, H - 120);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png"));
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, line: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (g.measureText(next).width > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  lines.push(cur);
  lines.forEach((l, i) => g.fillText(l, x, y + i * line));
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// In the feed, a Props card takes a slot in the list of polls.
const SLOT = "props:";
export const isPropsSlot = (p: { id: string }) => p.id.startsWith(SLOT);
export function propsSlot(n: number) {
  return {
    id: `${SLOT}${n}`,
    kind: "classic" as const,
    question: null,
    teaser: null,
    visibility: "public" as const,
    locked: false,
    audience: null,
    isMine: false,
    shareCount: 0,
    creator: "eithr",
    isSystem: true,
    featuredToday: false,
    voteCount: 0,
    commentCount: 0,
    createdAt: new Date(0).toISOString(),
    closesAt: new Date(8.64e15).toISOString(),
    myOptionId: null,
    options: [],
  };
}
