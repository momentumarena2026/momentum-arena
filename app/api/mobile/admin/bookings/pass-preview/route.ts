import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { getPassOfferForHold } from "@/lib/passes";

const Body = z.object({
  userId: z.string().min(1),
  courtConfigId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hours: z.array(z.number().int().min(0).max(24)).default([]),
  bowlingSlots: z
    .array(
      z.object({
        hour: z.number().int().min(0).max(23),
        minute: z.union([z.literal(0), z.literal(30)]),
      }),
    )
    .optional(),
});

/**
 * POST /api/mobile/admin/bookings/pass-preview — would this customer's
 * passes cover these slots? Drives the "Book with customer's pass"
 * checkbox on the app's create-booking screen. Mirrors the web form's
 * previewAdminPassCoverage action, but gated by the mobile admin
 * session instead of the web one (which is why the offer call is
 * inlined here rather than reusing the server action).
 */
export async function POST(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_BOOKINGS");
  if ("error" in gate) return gate.error;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid body" },
      { status: 400 },
    );
  }
  const args = parsed.data;
  const usingBowling = !!args.bowlingSlots?.length;
  if (!usingBowling && args.hours.length === 0) {
    return NextResponse.json({ preview: { eligible: false } });
  }
  const offer = await getPassOfferForHold({
    userId: args.userId,
    courtConfigId: args.courtConfigId,
    date: new Date(args.date + "T00:00:00Z"),
    hours: usingBowling ? args.bowlingSlots!.map((sl) => sl.hour) : args.hours,
    startMinutes: usingBowling
      ? args.bowlingSlots!.map((sl) => sl.minute)
      : undefined,
    // Prices resolve from the day's classified rates inside the offer
    // computation; totalAmount is unused for coverage math.
    totalAmount: 0,
    courtConfig: { slotDurationMinutes: usingBowling ? 30 : 60 },
  }).catch(() => null);
  if (!offer) return NextResponse.json({ preview: { eligible: false } });
  return NextResponse.json({
    preview: {
      eligible: true,
      fullCoverage: offer.fullCoverage,
      coveredMinutes: offer.coveredMinutes,
      coveredAmount: offer.coveredAmount,
      remainderAmount: offer.remainderAmount,
      passes: offer.passes.map((sh) => ({
        passName: sh.passName,
        coveredMinutes: sh.coveredMinutes,
      })),
    },
  });
}
