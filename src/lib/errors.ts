// Catches errors in the app and reports them to Admin → Errors (see
// supabase/migrations/20261205000000_errors.sql). Only the error itself, the screen, the
// phone and browser type and the app version: never anything typed, never photos.
import { getSupabase } from "./supabase";
import { visitorCode } from "./visits";

const APP_VERSION = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "dev";
const RATE_KEY = "eithr.errorReports";
const PER_HOUR = 20;

/** The screen a path belongs to, with ids taken out so one screen is one place. */
export function screenOf(path: string): string {
  const p = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  const NAMES: [RegExp, string][] = [
    [/^\/$/, "Feed (/)"],
    [/^\/p\/[^/]+$/, "Poll page (/p/:id)"],
    [/^\/u\/[^/]+$/, "Profile (/u/:name)"],
    [/^\/snap/, "Snap (/snap)"],
    [/^\/create/, "Create (/create)"],
    [/^\/activity/, "Activity (/activity)"],
    [/^\/friends/, "Friends (/friends)"],
    [/^\/profile/, "Your profile (/profile)"],
    [/^\/settings/, "Settings (/settings)"],
    [/^\/leaders/, "Leaders (/leaders)"],
    [/^\/admin/, "Admin (/admin)"],
  ];
  for (const [re, name] of NAMES) if (re.test(p)) return name;
  return p.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id").slice(0, 60);
}

/** Phone or computer, browser, and the social app it's inside, if any. */
export function deviceOf(ua: string, touch = false): { device: string; browser: string; inApp: string | null } {
  const device = /iPhone|iPod/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && touch)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux|CrOS/.test(ua)
              ? "Linux"
              : "Other";
  const inApp = /Instagram/.test(ua)
    ? "Instagram"
    : /FBAN|FBAV|FB_IAB|FBIOS/.test(ua)
      ? "Facebook"
      : /WhatsApp/.test(ua)
        ? "WhatsApp"
        : /Snapchat/.test(ua)
          ? "Snapchat"
          : /LinkedInApp/.test(ua)
            ? "LinkedIn"
            : /musical_ly|BytedanceWebview|TikTok/.test(ua)
              ? "TikTok"
              : null;
  const browser = /SamsungBrowser/.test(ua)
    ? "Samsung Internet"
    : /Edg\//.test(ua)
      ? "Edge"
      : /Firefox|FxiOS/.test(ua)
        ? "Firefox"
        : /CriOS|Chrome\//.test(ua)
          ? "Chrome"
          : /Safari/.test(ua)
            ? "Safari"
            : "Other";
  return { device, browser, inApp };
}

/** "polls.ts fetchFeed" from the first useful stack line. */
export function codeOf(stack: string | undefined): string | null {
  for (const line of (stack ?? "").split("\n").slice(0, 8)) {
    const m = line.match(/at (?:(\S+) \()?(?:.*\/)?([^/\s)]+?\.[a-z]+)(?:\?[^:)]*)?:(\d+)/) ?? line.match(/^(\S*)@(?:.*\/)?([^/\s]+?\.[a-z]+)(?:\?[^:]*)?:(\d+)/);
    if (m) return `${m[2]}${m[1] ? ` ${m[1]}` : ""}`.slice(0, 160);
  }
  return null;
}

// Noise: not ours, or not a problem.
const IGNORE = /ResizeObserver loop|^Script error\.?$|AbortError|The operation was aborted|The user aborted|cancelled|Non-Error promise rejection captured/i;

let prevPath: string | null = null;
let lastPath: string | null = null;
/** Remembers the screen before this one, for "steps before". */
export function notePath(path: string) {
  if (path === lastPath) return;
  prevPath = lastPath;
  lastPath = path;
}

const seenThisLoad = new Map<string, number>();

function allowed(): boolean {
  try {
    const now = Date.now();
    const times = (JSON.parse(localStorage.getItem(RATE_KEY) ?? "[]") as number[]).filter((t) => now - t < 3600_000);
    if (times.length >= PER_HOUR) return false;
    times.push(now);
    localStorage.setItem(RATE_KEY, JSON.stringify(times));
  } catch {
    // Storage blocked: the server's limit still applies.
  }
  return true;
}

export type ErrorReport = { message: string; kind?: string; stack?: string; code?: string | null; place?: string };

/** Sends one error to Admin → Errors. Never throws; drops repeats and noise. */
export function reportError(r: ErrorReport): void {
  try {
    if (typeof window === "undefined") return;
    const message = String(r.message ?? "").trim().slice(0, 300);
    if (!message || IGNORE.test(message) || IGNORE.test(r.kind ?? "")) return;
    if (/chrome-extension:|moz-extension:|safari-extension:/.test(r.stack ?? "")) return;
    const place = r.place ?? screenOf(location.pathname);
    const key = `${r.kind}|${message}|${place}`;
    const n = (seenThisLoad.get(key) ?? 0) + 1;
    seenThisLoad.set(key, n);
    if (n > 3 || !allowed()) return;
    const supabase = getSupabase();
    if (!supabase) return;
    const { device, browser, inApp } = deviceOf(navigator.userAgent, navigator.maxTouchPoints > 1);
    const installed =
      window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    void supabase
      .rpc("report_error", {
        message,
        kind: (r.kind ?? "Error").slice(0, 60),
        place,
        code: r.code ?? codeOf(r.stack),
        stack: r.stack?.split("\n").slice(0, 8).join("\n").slice(0, 800) ?? null,
        visitor: visitorCode(),
        device,
        browser,
        in_app: inApp,
        installed,
        app_version: APP_VERSION,
        path: screenOf(location.pathname),
        prev_path: prevPath ? screenOf(prevPath) : null,
      })
      .then(
        () => {},
        () => {},
      );
  } catch {
    // Reporting must never break the app.
  }
}

/** Reports a thrown value (an Error or anything else). */
export function reportThrown(e: unknown, kind?: string) {
  if (e instanceof Error) reportError({ message: e.message || e.name, kind: kind ?? e.name, stack: e.stack });
  else reportError({ message: typeof e === "string" ? e : JSON.stringify(e)?.slice(0, 200) ?? String(e), kind: kind ?? "Thrown" });
}

const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

/** What a request was for, in words: "database: feed_page", "/api/snap/check". */
export function targetOf(url: string): string | null {
  try {
    const u = new URL(url, location.href);
    if (SUPABASE && url.startsWith(SUPABASE)) {
      const rpc = u.pathname.match(/\/rest\/v1\/rpc\/([\w]+)/);
      if (rpc) return rpc[1] === "report_error" ? null : `database: ${rpc[1]}`;
      const table = u.pathname.match(/\/rest\/v1\/([\w]+)/);
      if (table) return `database: ${table[1]}`;
      if (u.pathname.startsWith("/auth/")) return "sign-in service";
      if (u.pathname.startsWith("/storage/")) return "photo storage";
      return "database";
    }
    if (u.origin === location.origin && u.pathname.startsWith("/api/")) return u.pathname;
  } catch {
    // Not a URL we track.
  }
  return null;
}

let installed = false;
/** Listens for script errors, unhandled promise errors and failed requests (once). */
export function installErrorCatcher() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    if (!e.message && !e.error) return;
    reportThrown(e.error ?? new Error(e.message), e.error?.name ?? "ScriptError");
  });
  window.addEventListener("unhandledrejection", (e) => reportThrown(e.reason, (e.reason as Error | undefined)?.name ?? "UnhandledRejection"));
  // Requests to the database and our own API that fail outright or with a server error.
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const target = targetOf(url);
    try {
      const res = await original(input, init);
      if (target && res.status >= 500) {
        reportError({ message: `${res.status} from ${target}`, kind: "ServerResponse", code: target });
      }
      return res;
    } catch (e) {
      const aborted = init?.signal?.aborted || (e instanceof DOMException && e.name === "AbortError");
      // Offline, or leaving the page (Safari cancels requests then): not an error.
      if (target && !aborted && navigator.onLine && document.visibilityState !== "hidden") {
        reportError({ message: e instanceof Error ? e.message : "Request failed", kind: "NetworkError", code: target });
      }
      throw e;
    }
  };
}
