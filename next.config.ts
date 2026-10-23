import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fonts read at request time by the link-preview image (src/app/p/[id]/opengraph-image.tsx).
  outputFileTracingIncludes: {
    "/p/[id]/opengraph-image": ["./assets/fonts/**/*"],
  },
  // The service worker must always be fresh, and may control the whole site.
  async headers() {
    return [
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
