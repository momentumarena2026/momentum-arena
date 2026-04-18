// One-shot: repair Payment rows that got wrong advance/remaining amounts
// due to the create-order bug where hold.paymentAmount was set to the
// full slot price instead of the 50% advance.
//
// Bug signature on Payment:
//   - isPartialPayment = true
//   - method = "CASH"
//   - amount == booking.totalAmount (should be ~half)
//   - advanceAmount == booking.totalAmount (should be ~half)
//   - remainingAmount == 0 (should be the other half)
//
// Fix: recompute from booking.totalAmount as Math.ceil(total/2).
// Read-only by default — pass APPLY=1 to actually write.

import { db } from "../lib/db";

async function main() {
  const apply = process.env.APPLY === "1";

  const candidates = await db.payment.findMany({
    where: {
      isPartialPayment: true,
    },
    include: {
      booking: {
        select: { id: true, totalAmount: true, status: true },
      },
    },
  });

  console.log(`Found ${candidates.length} Payment row(s) with the bug signature.\n`);

  const toFix: Array<{
    paymentId: string;
    bookingId: string;
    before: { amount: number; advanceAmount: number | null; remainingAmount: number | null };
    after: { amount: number; advanceAmount: number; remainingAmount: number };
  }> = [];

  for (const p of candidates) {
    const total = p.booking.totalAmount;
    const correctAdvance = Math.ceil(total / 2);
    const correctRemaining = total - correctAdvance;

    // Only fix rows where advanceAmount is clearly the full amount (i.e.
    // advanceAmount > correctAdvance). This avoids touching rows where the
    // split happens to be legitimate (e.g. complimentary slot with zero due).
    if ((p.advanceAmount ?? 0) <= correctAdvance) {
      continue;
    }

    toFix.push({
      paymentId: p.id,
      bookingId: p.booking.id,
      before: {
        amount: p.amount,
        advanceAmount: p.advanceAmount,
        remainingAmount: p.remainingAmount,
      },
      after: {
        amount: correctAdvance,
        advanceAmount: correctAdvance,
        remainingAmount: correctRemaining,
      },
    });
  }

  if (toFix.length === 0) {
    console.log("No rows need correction. Exiting.");
    return;
  }

  console.log(`${toFix.length} row(s) will be fixed:\n`);
  for (const row of toFix) {
    console.log(`  bookingId=${row.bookingId}`);
    console.log(`    before: amount=${row.before.amount}, advance=${row.before.advanceAmount}, remaining=${row.before.remainingAmount}`);
    console.log(`    after:  amount=${row.after.amount}, advance=${row.after.advanceAmount}, remaining=${row.after.remainingAmount}`);
  }

  if (!apply) {
    console.log("\nDry run — pass APPLY=1 to write changes.");
    return;
  }

  console.log("\nApplying updates...");
  for (const row of toFix) {
    await db.payment.update({
      where: { id: row.paymentId },
      data: {
        amount: row.after.amount,
        advanceAmount: row.after.advanceAmount,
        remainingAmount: row.after.remainingAmount,
      },
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
