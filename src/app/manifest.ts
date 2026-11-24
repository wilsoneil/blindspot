// The web app manifest: lets phones install Blindspot to the home screen with its own icon.
// Served at /manifest.webmanifest; Next.js links it from every page automatically.
// The icons live in public/icons/ and, like this file, are reachable without signing in
// (see the matcher in src/proxy.ts): browsers fetch them without the login cookie.

import type { MetadataRoute } from "next";
import { slate } from "@/lib/themes/slate";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Blindspot",
    short_name: "Blindspot",
    description: "Find the gaps in your chess and train only those.",
    start_url: "/",
    display: "standalone",
    // Matches the icons' background, so the launch screen blends with the icon.
    background_color: slate.ui.bg,
    theme_color: slate.ui.bg,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
