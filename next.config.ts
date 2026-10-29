import type { NextConfig } from "next";

// Security headers for every page (see README → Security). The app only talks
// to its own routes and its Supabase project; avatars come from Google; snap
// photos are signed Supabase Storage links (or blob: previews on the phone).
const supabase = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  } catch {
    return null;
  }
})();
const supabaseHttp = supabase?.origin ?? "";
const supabaseWs = supabase ? `${supabase.protocol === "https:" ? "wss:" : "ws:"}//${supabase.host}` : "";
const dev = process.env.NODE_ENV === "development";

const csp = [
  "default-src 'self'",
  // Next's own inline bootstrap scripts need 'unsafe-inline' without per-request nonces;
  // scripts from any other site are still blocked.
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabaseHttp} https://*.googleusercontent.com`,
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseHttp} ${supabaseWs}`,
  "media-src 'self' blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(supabase?.protocol === "https:" ? ["upgrade-insecure-requests"] : []),
]
  .join("; ")
  .replace(/\s+/g, " ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The camera is only for Quick snap, on this site; nothing else.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Fonts read at request time by the link-preview image (src/app/p/[id]/opengraph-image.tsx).
  outputFileTracingIncludes: {
    "/p/[id]/opengraph-image": ["./assets/fonts/**/*"],
  },
  // Next.js traces its image library (sharp, ~47 MB with its native builds) into the shared-poll
  // functions in case they resize images. Nothing here does: the link-preview card is drawn by
  // next/og (resvg), and the app doesn't use next/image. Leaving it out keeps each deployment small
  // (Vercel stores every deployment's functions).
  outputFileTracingExcludes: {
    "/**": ["node_modules/sharp/**", "node_modules/@img/**"],
  },
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The service worker must always be fresh, and may control the whole site.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
