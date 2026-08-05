import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { areCampsEnabled, registerForCamp, createCampOrder } from "@/lib/camps";
import { db } from "@/lib/db";
import { RAZORPAY_KEY_ID } from "@/lib/razorpay";

/**
 * Register for a camp. Unified auth (web cookie or mobile bearer), so the
 * app reuses this route.
 *
 * Returns either a confirmed registration (free camps) or a Razorpay
 * order for the amount due online. The server prices the registration —
 * the client never states an amount.
 */
export async function POST(request: NextRequest) {
  if (!(await areCampsEnabled())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json(
      { error: "Sign in to register for a camp" },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const { campId, participantName, participantAge, guardianName, phone, email, notes, couponCode } =
    body || {};
  if (!campId || !participantName || !phone) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const res = await registerForCamp({
    campId: String(campId),
    userId,
    participantName: String(participantName),
    participantAge: participantAge ? Number(participantAge) : null,
    guardianName: guardianName ? String(guardianName) : null,
    phone: String(phone),
    email: email ? String(email) : null,
    notes: notes ? String(notes) : null,
    couponCode: couponCode ? String(couponCode) : null,
  });
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }

  // Waitlisted or free — nothing to pay, we're done.
  if (res.waitlisted || !res.payableNow) {
    return NextResponse.json({
      registrationId: res.registrationId,
      waitlisted: !!res.waitlisted,
      payableNow: 0,
    });
  }

  const camp = await db.camp.findUnique({
    where: { id: String(campId) },
    select: { name: true },
  });
  const order = await createCampOrder(res.registrationId!, userId, res.payableNow);

  return NextResponse.json({
    registrationId: res.registrationId,
    payableNow: res.payableNow,
    orderId: order.orderId,
    keyId: RAZORPAY_KEY_ID,
    campName: camp?.name ?? "Camp",
  });
}
