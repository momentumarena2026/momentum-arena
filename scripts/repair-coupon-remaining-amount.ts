// One-shot: repair Payment.remainingAmount on partial-payment bookings that
// had a coupon applied. The bug was in the razorpay/verify + phonepe
// callback/redirect + selectCashPayment paths: `fullAmount` was read as
// `hold.totalAmount` (pre-discount), so `remainingAmount = fullAmount -
// advance` over-charged the venue-side collection by exactly the coupon
// amount (e.g. FLAT100 on ₹2,000 → advance ₹950 → remaining stored as
// ₹1,050 instead of ₹950).
//
// Fix: set Payment.remainingAmount = Booking.totalAmount - Payment.advanceAmount
// for rows that still owe (remainingAmount > 0) on discounted bookings.
//
// Read-only by default — pass APPLY=1 to actually write.

import { db } from "../lib/db";

async function main() {
  const apply = process.env.APPLY === "1";

  // Candidates: partial payments that still owe something, on bookings with
  // a coupon discount (originalAmount > totalAmount).
  const candidates = await db.payment.findMany({
    where: {
      isPartialPayment: true,
      remainingAmount: { gt: 0 },
      advanceAmount: { not: null },
      booking: {
        originalAmount: { not: null },
      },
    },
    include: {
      booking: {
        select: {
          id: true,
          totalAmount: true,
          originalAmount: true,
          discountAmount: true,
          status: true,
        },
      },
    },
  });

  console.log(
    `Found ${candidates.length} partial Payment row(s) on discounted bookings.\n`
  );

  const toFix: Array<{
    paymentId: string;
    bookingId: string;
    before: { remainingAmount: number | null };
    after: { remainingAmount: number };
  }> = [];

  for (const p of candidates) {
    const total = p.booking.totalAmount; // post-discount
    const original = p.booking.originalAmount ?? total;
    // Only rows where original > total are discount cases we want to touch.
    if (original <= total) continue;

    const advance = p.advanceAmount ?? 0;
    const correctRemaining = Math.max(total - advance, 0);
    const currentRemaining = p.remainingAmount ?? 0;

    // Only touch rows that are wrong (over-collected).
    if (currentRemaining === correctRemaining) continue;

    toFix.push({
      paymentId: p.id,
      bookingId: p.booking.id,
      before: { remainingAmount: p.remainingAmount },
      after: { remainingAmount: correctRemaining },
    });
  }

  if (toFix.length === 0) {
    console.log("No rows need correction. Exiting.");
    return;
  }

  console.log(`${toFix.length} row(s) will be fixed:\n`);
  for (const row of toFix) {
    console.log(`  bookingId=${row.bookingId}`);
    console.log(
      `    before: remaining=${row.before.remainingAmount}  →  after: remaining=${row.after.remainingAmount}`
    );
  }

  if (!apply) {
    console.log("\nDry run — pass APPLY=1 to write changes.");
    return;
  }

  console.log("\nApplying updates...");
  for (const row of toFix) {
    await db.payment.update({
      where: { id: row.paymentId },
      data: { remainingAmount: row.after.remainingAmount },
    });
  }
  console.log(`Done. Updated ${toFix.length} row(s).`);
}

main()
  .catch((e) => {
    console.error("Repair script failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
