import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // The letter generators (NDA / offer) read the authorised-signatory
  // signature + company stamp at render time via fs. They live OUTSIDE
  // /public on purpose — a signature/stamp must never be publicly
  // downloadable — so they aren't auto-bundled into the serverless
  // functions. Trace them in explicitly.
  outputFileTracingIncludes: {
    "/api/admin/nda/generate": ["./assets/letter-assets/**"],
    "/api/admin/offer-letter/generate": ["./assets/letter-assets/**"],
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
      {
        // Vercel Blob — every image WE store (camp banners, team logos,
        // promo banners) lives here. Without this next/image refuses the
        // URL and renders a broken image, while local fallbacks like
        // /cricket.png still work, which makes it look like the upload
        // failed when it actually succeeded.
        protocol: "https",
        hostname: "**.blob.vercel-storage.com",
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
  // Apex -> www, for everything EXCEPT /.well-known/.
  //
  // This redirect used to live in Vercel's domain settings, which applies it
  // to every path. That broke Android App Links: the verifier fetches
  // https://momentumarena.com/.well-known/assetlinks.json and does NOT follow
  // redirects, so it saw a 307 and failed the domain ("Domain non-redirect
  // failed" in Play Console). Same rule applies to iOS Universal Links and
  // apple-app-site-association, which is why the whole directory is excluded
  // rather than the one file.
  //
  // The apex is now connected to Production in Vercel so it can serve those
  // files directly, and this brings the redirect back for human traffic. That
  // matters because session cookies are host-scoped: without it, signing in on
  // www leaves you signed out on the apex — two separate sessions on what
  // looks like one site. Scoping the cookie to .momentumarena.com would also
  // "fix" it, but that would hand production session cookies to
  // development.momentumarena.com, so redirecting is the safer of the two.
  //
  // Keeping people on www also keeps the GA4 host check in lib/analytics.ts
  // honest and leaves search consolidated on a single host.
  async redirects() {
    return [
      {
        source: "/:path((?!\\.well-known\\/).*)",
        has: [{ type: "host", value: "momentumarena.com" }],
        destination: "https://www.momentumarena.com/:path",
        // Temporary, matching the 307 Vercel was serving. Worth revisiting as
        // permanent once this is proven, but a cached permanent redirect is
        // painful to undo if the host choice ever changes.
        permanent: false,
      },
    ];
  },
};

export default nextConfig;