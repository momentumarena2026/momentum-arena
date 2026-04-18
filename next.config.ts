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
};

export default nextConfig;