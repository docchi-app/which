import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Docchi",
    short_name: "Docchi",
    description: "Docchi. Which one? Tap a side, see where everyone landed.",
    start_url: "/?src=pwa",
    display: "standalone",
    background_color: "#FFF7EC",
    theme_color: "#FFF7EC",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
