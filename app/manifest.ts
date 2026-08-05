import type { MetadataRoute } from "next";

/**
 * PWA manifest.
 *
 * Two jobs: it lets a mobile-web visitor "add to home screen" with proper
 * branding instead of a generic bookmark, and it's part of what crawlers
 * read to understand this site has an app-like presence. It does NOT
 * replace the native apps — `related_applications` points at those, with
 * `prefer_related_applications` true so a browser that can offer the real
 * app does that instead of the web shell.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Momentum Arena — Mathura's Multi-Sport Arena",
    short_name: "Momentum Arena",
    description:
      "Book cricket, football and pickleball courts at Momentum Arena Mathura. Passes, cafe orders, tournaments, camps and live scores.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#10b981",
    orientation: "portrait",
    categories: ["sports", "lifestyle"],
    lang: "en-IN",
    icons: [
      { src: "/icon.png", sizes: "500x500", type: "image/png", purpose: "any" },
      { src: "/icon.png", sizes: "500x500", type: "image/png", purpose: "maskable" },
    ],
  };
}
