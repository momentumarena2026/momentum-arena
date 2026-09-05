import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { markConfirmed } from "@/lib/booking-bot/learn";

export const dynamic = "force-dynamic";

/**
 * "The customer went through with this reading."
 *
 * Deliberately its own endpoint, off the money path. Booking is already
 * a lock → pay → verify pipeline that works; threading a learning
 * concern through it would put the loop's convenience in front of a
 * customer's payment. This is called after the hold succeeds, and if it
 * fails nobody notices.
 *
 * The row it marks is the only unambiguous label the learning loop gets.
 * Everything else in BookingBotLog is a reading that was SHOWN — we have
 * no idea whether the customer accepted it or gave up and used the slot
 * picker. A confirmed row is a phrasing we know we read correctly, which
 * is what makes it safe to serve from cache next time.
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request).catch(() => null);
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

  let body: { logId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!body.logId) return NextResponse.json({ ok: true });

  await markConfirmed(body.logId);
  return NextResponse.json({ ok: true });
}
