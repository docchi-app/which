import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fonts read at request time by the link-preview image (src/app/p/[id]/opengraph-image.tsx).
  outputFileTracingIncludes: {
    "/p/[id]/opengraph-image": ["./assets/fonts/**/*"],
  },
};

export default nextConfig;
