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
    // pdfkit reads AFM/ICC files from its own package at runtime (new
    // PDFDocument() → Helvetica font load). Treating it as external keeps
    // those data files alongside the module so fs.open() resolves in the
    // Vercel serverless bundle.
    "pdfkit",
  ],
  // Ensure the pdfkit data dir is traced into the serverless bundle for
  // routes that render PDFs on demand (cache-miss fallback + cron refresh).
  outputFileTracingIncludes: {
    "/pricing.pdf": ["./node_modules/pdfkit/js/data/**/*"],
    "/api/cron/refresh-pricing-pdf": ["./node_modules/pdfkit/js/data/**/*"],
  },
};

export default nextConfig;