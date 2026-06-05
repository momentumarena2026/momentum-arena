import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileUser } from "@/lib/mobile-auth";
import { db } from "@/lib/db";
import { verifyRazorpaySignature } from "@/lib/razorpay";
import { materializeOrderFromIntent } from "@/lib/cafe-intent";

/**
 * Verify Razorpay payment + materialise the real CafeOrder from
 * the intent. Identical state-machine to the web verify endpoint;
 * different auth surface (mobile JWT) and response keys (orderId
 * is the materialised CafeOrder id so the client navigates to the
 * confirmation screen with the right value).
 */
const Body = z.object({
  orderId: z.string().min(1), // intent id
  razorpayPaymentId: z.string().min(1),
  razorpayOrderId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const { orderId, razorpayPaymentId, razorpayOrderId, razorpaySignature } =
    parsed.data;

  const intent = await db.cafePaymentIntent.findUnique({
    where: { id: orderId },
  });

  // Duplicate verify call (intent already consumed) — look up the
  // materialised order by gateway ref and return it.
  if (!intent) {
    const existingPayment = await db.cafePayment.findFirst({
      where: { razorpayOrderId },
      select: { orderId: true, order: { select: { status: true } } },
    });
    if (existingPayment?.orderId) {
      return NextResponse.json({
        success: true,
        orderId: existingPayment.orderId,
        status: existingPayment.order?.status ?? "PENDING",
      });
    }
    return NextResponse.json(
      { error: "Checkout session expired — please start again" },
      { status: 410 },
    );
  }

  if (intent.userId && intent.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (intent.razorpayOrderId && intent.razorpayOrderId !== razorpayOrderId) {
    return NextResponse.json({ error: "Order mismatch" }, { status: 400 });
  }

  const isValid = verifyRazorpaySignature(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  );
  if (!isValid) {
    return NextResponse.json(
      { error: "Invalid payment signature" },
      { status: 400 },
    );
  }

  const result = await materializeOrderFromIntent(intent.id, {
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        refundRequired: !!result.refundOrderId,
        orderId: result.refundOrderId,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    success: true,
    orderId: result.orderId,
    orderNumber: result.orderNumber,
    status: result.status,
  });
}
