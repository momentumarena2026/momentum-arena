import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { getValidHold } from "@/lib/slot-hold";
import {
  AnalyticsCategory,
  logServerAction,
  resolveRequestPlatform,
} from "@/lib/server-log";

/**
 * POST /api/mobile/booking/payment-method
 * Body: { holdId, paymentMethod: "online" | "upi_qr" | "cash" }
 *
 * Audit log when the customer taps a payment tile on native checkout.
 * Does not create a booking — only records the selection.
 */
export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { holdId?: string; paymentMethod?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { holdId, paymentMethod } = body;
  if (!holdId || !paymentMethod) {
    return NextResponse.json(
      { error: "Missing holdId or paymentMethod" },
      { status: 400 },
    );
  }

  const hold = await getValidHold(holdId, user.id);
  logServerAction({
    userId: user.id,
    action: "payment.select_payment",
    category: AnalyticsCategory.PAYMENT,
    outcome: "success",
    path: request.nextUrl.pathname,
    method: "POST",
    platform: resolveRequestPlatform(request),
    metadata: {
      holdId,
      paymentMethod,
      sport: hold?.courtConfig.sport ?? null,
    },
  });

  return NextResponse.json({ ok: true });
}
