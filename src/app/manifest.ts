import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Eithr",
    short_name: "Eithr",
    description: "Eithr? Pick a side. Tap one, see where everyone landed.",
    start_url: "/?src=pwa",
    display: "standalone",
    background_color: "#FFF7EC",
    theme_color: "#FFF7EC",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
