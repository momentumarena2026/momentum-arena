import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { db } from "@/lib/db";
import { readRegisterImage } from "@/lib/cafe-register/vision";
import {
  matchItem,
  normalizePayment,
  priceMismatch,
} from "@/lib/cafe-register/match";

export const dynamic = "force-dynamic";
// Reading a page of handwriting is slow. The default serverless budget
// would cut the model off mid-transcription and report it as a failure.
export const maxDuration = 60;

/**
 * GET  — the menu and the shorthand already learned, for the review table.
 * POST — transcribe one photographed register page.
 *
 * The phone is the right place for this: the register is a paper book on
 * the counter, and the camera is already in the room. The web page does
 * the same thing for someone sitting at a desk with a scan.
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_CAFE_ORDERS");
  if ("error" in gate) return gate.error;

  const [menu, aliases] = await Promise.all([
    db.cafeItem.findMany({
      where: { isAvailable: true },
      select: { id: true, name: true, price: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    db.cafeItemAlias.findMany({
      orderBy: [{ seenCount: "desc" }],
      take: 200,
      select: {
        id: true,
        term: true,
        seenCount: true,
        cafeItem: { select: { name: true } },
      },
    }),
  ]);

  return NextResponse.json({
    menu,
    aliases: aliases.map((a) => ({
      id: a.id,
      term: a.term,
      itemName: a.cafeItem?.name ?? "(deleted item)",
      seenCount: a.seenCount,
    })),
  });
}

export async function POST(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_CAFE_ORDERS");
  if ("error" in gate) return gate.error;

  let body: { imageDataUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const imageDataUrl = body.imageDataUrl ?? "";
  if (!imageDataUrl.startsWith("data:image/")) {
    return NextResponse.json({ error: "No image received" }, { status: 400 });
  }

  const vision = await readRegisterImage(imageDataUrl);
  const [menu, aliases] = await Promise.all([
    db.cafeItem.findMany({
      where: { isAvailable: true },
      select: { id: true, name: true, price: true },
    }),
    db.cafeItemAlias.findMany({ select: { term: true, cafeItemId: true } }),
  ]);
  const byId = new Map(menu.map((m) => [m.id, m]));

  const rows = vision.rows.map((r) => {
    const m = matchItem(r.item, menu, aliases);
    const qty = r.qty != null && r.qty > 0 ? Math.min(99, Math.round(r.qty)) : 1;
    const item = m.cafeItemId ? (byId.get(m.cafeItemId) ?? null) : null;
    return {
      rawItem: m.rawItem,
      cafeItemId: m.cafeItemId,
      itemName: m.itemName,
      matchSource: m.matchSource,
      qty,
      writtenPrice: r.price,
      time: r.time,
      payment: normalizePayment(r.payment),
      priceWarning: priceMismatch(r.price, qty, item),
    };
  });

  const autoMatched = rows.filter((r) => r.cafeItemId != null).length;

  // Logged before anything is created, so a page that was read and then
  // abandoned is still visible — those are the ones worth looking at.
  const upload = await db.cafeRegisterUpload
    .create({
      data: {
        imageUrl: "",
        rawResult: (vision.raw ?? null) as never,
        rowCount: rows.length,
        autoMatchedCount: autoMatched,
        uploadedByAdminId: gate.admin.id,
        error: vision.error,
        latencyMs: vision.latencyMs,
      },
      select: { id: true },
    })
    .catch(() => null);

  return NextResponse.json({
    uploadId: upload?.id ?? null,
    rows,
    autoMatched,
    error: vision.error,
    latencyMs: vision.latencyMs,
  });
}
