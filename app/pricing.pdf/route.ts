import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateSportsPricingPdf } from "@/lib/pricing-pdf";

// Public route that serves the cached sports-pricing PDF at /pricing.pdf.
// The nightly cron (/api/cron/refresh-pricing-pdf, 5:00 AM IST) regenerates
// the CachedDocument row so this handler stays read-only on hot paths.
// If the cache is empty (fresh deploy, pre-first-cron), we generate on
// demand and persist the result so subsequent hits are cached again.
export async function GET() {
  let cached = await db.cachedDocument.findUnique({
    where: { id: "SPORTS_PRICING" },
  });

  if (!cached) {
    const pdfBuffer = await generateSportsPricingPdf();
    const bytes = new Uint8Array(pdfBuffer);
    cached = await db.cachedDocument.upsert({
      where: { id: "SPORTS_PRICING" },
      update: {
        content: bytes,
        mimeType: "application/pdf",
        generatedAt: new Date(),
      },
      create: {
        id: "SPORTS_PRICING",
        content: bytes,
        mimeType: "application/pdf",
      },
    });
  }

  const body = new Uint8Array(cached.content);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": cached.mimeType || "application/pdf",
      "Content-Length": String(body.byteLength),
      "Content-Disposition": 'inline; filename="momentum-arena-pricing.pdf"',
      // Short browser/CDN cache. The cron refreshes the row nightly, and
      // any manual re-run via /api/cron/refresh-pricing-pdf will be picked
      // up within the TTL.
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "Last-Modified": cached.generatedAt.toUTCString(),
    },
  });
}

export const dynamic = "force-dynamic";
