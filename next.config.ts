import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
  // Keep these as Node-only externals. @neondatabase/serverless pulls in
  // node:net / ws internals; @prisma/* include the Rust query engine and
  // driver adapters — none of this can run in the browser, so Turbopack
  // shouldn't try to bundle them for the client.
  serverExternalPackages: [
    "bcryptjs",
    "@prisma/client",
    "@prisma/adapter-neon",
    "@neondatabase/serverless",
  ],
  // Disable HTTP/3 (QUIC) advertisement. Indian mobile carriers (Jio, Airtel,
  // VI) intermittently mangle UDP/443, which causes Chrome/Safari to fail
  // reaching the site with "ERR_CONNECTION_*" until the OS network stack is
  // reset. Browsers cache the Alt-Svc hint for ~24h, so the problem persists
  // even after the carrier path recovers. Shipping `Alt-Svc: clear` on every
  // response tells the browser to forget any cached HTTP/3 upgrade for our
  // origin and stick with HTTP/2 over TCP.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Alt-Svc", value: "clear" }],
      },
    ];
  },
};

export default nextConfig;