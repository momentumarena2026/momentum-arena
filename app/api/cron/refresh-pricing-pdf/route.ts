import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateSportsPricingPdf } from "@/lib/pricing-pdf";

// Vercel cron fires GET; we also accept POST for manual re-runs via curl.
async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const pdfBuffer = await generateSportsPricingPdf();
    const bytes = new Uint8Array(pdfBuffer);
    await db.cachedDocument.upsert({
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
    return NextResponse.json({
      success: true,
      bytes: bytes.byteLength,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("refresh-pricing-pdf failed:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to regenerate pricing PDF",
      },
      { status: 500 }
    );
  }
}

export const GET = handle;
export const POST = handle;
