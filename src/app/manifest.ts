import type { MetadataRoute } from "next";

// Browser-tab and iOS icons come from the favicon/icon/apple-icon files in this
// directory; these are the icons used when WikiHole is installed or added to a
// home screen. Regenerate everything with scripts/generate-icons.mjs.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WikiHole",
    short_name: "WikiHole",
    description: "A ranked stream of obscure, technically deep Wikipedia articles.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
