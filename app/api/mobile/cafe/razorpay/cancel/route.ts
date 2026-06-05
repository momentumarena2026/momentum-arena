import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileUser } from "@/lib/mobile-auth";
import { db } from "@/lib/db";
import { deleteCafePaymentIntent } from "@/lib/cafe-intent";

/**
 * Cancel a CafePaymentIntent on mobile — called when the customer
 * dismisses the Razorpay modal without paying. Mirrors the web
 * /api/razorpay/cafe-cancel route. No CafeOrder exists yet, so
 * cancellation is just an intent delete.
 */
const Body = z.object({ orderId: z.string().min(1) });

export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
  }
  const { orderId } = parsed.data;

  const intent = await db.cafePaymentIntent.findUnique({
    where: { id: orderId },
    select: { userId: true, consumedAt: true },
  });
  if (!intent) {
    return NextResponse.json({ success: true, alreadyGone: true });
  }
  if (intent.userId && intent.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (intent.consumedAt) {
    return NextResponse.json(
      {
        error:
          "Payment already completed — contact venue for refund if needed",
      },
      { status: 409 },
    );
  }
  await deleteCafePaymentIntent(orderId);
  return NextResponse.json({ success: true });
}
