/**
 * One-shot backfill: reconcile Booking.totalAmount with at-collection
 * discount.
 *
 * Background. Commit `85063e6` shipped the 3-input split-collection
 * UI (cash + UPI + discount), but only `3540190` taught
 * markRemainderCollected / updateRemainderSplit to roll the discount
 * into Booking.totalAmount. Bookings collected in the window between
 * the two deploys ended up with:
 *   - Payment.amount        = cash + UPI       (correct, e.g. ₹1,200)
 *   - Payment.remainderDiscountAmount = discount (correct, e.g. ₹800)
 *   - Booking.totalAmount   = original total   (stale, e.g. ₹2,000)
 *   - Booking.discountAmount/originalAmount    (stale, didn't include
 *     the at-collection discount)
 *
 * The detail page reads Booking.totalAmount for the "Amount" line, so
 * floor staff see the pre-discount number even though Payment.amount
 * is correct.
 *
 * This script walks every Payment with remainderDiscountAmount > 0,
 * detects rows where the invariant `Payment.amount ===
 * Booking.totalAmount` is broken, and rewrites Booking.totalAmount /
 * discountAmount / originalAmount so the detail / list pages render
 * the post-discount figure.
 *
 * Idempotent: rows already in the consistent state are skipped, so
 * re-running this is safe.
 *
 * Usage (against prod):
 *   DATABASE_URL="<prod_url>" npx tsx scripts/backfill-discount-totals.ts
 *
 * Add `--dry-run` to print intended changes without writing.
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const payments = await db.payment.findMany({
    where: { remainderDiscountAmount: { gt: 0 } },
    include: {
      booking: {
        select: {
          id: true,
          totalAmount: true,
          discountAmount: true,
          originalAmount: true,
        },
      },
    },
  });

  console.log(
    `Found ${payments.length} payment(s) with at-collection discount.\n`,
  );
  if (dryRun) console.log("(dry-run mode — no writes)\n");

  let fixed = 0;
  let alreadyOk = 0;
  let skipped = 0;

  for (const payment of payments) {
    const booking = payment.booking;
    if (!booking) {
      console.log(`SKIP   payment ${payment.id}: no booking`);
      skipped++;
      continue;
    }

    // Already-consistent rows: Payment.amount equals Booking.totalAmount,
    // which is the post-3540190 invariant. Nothing to do.
    if (payment.amount === booking.totalAmount) {
      console.log(`OK     ${booking.id}: total=${booking.totalAmount} matches payment.amount`);
      alreadyOk++;
      continue;
    }

    // Broken rows have Booking.totalAmount inflated by the
    // remainderDiscountAmount (since the action skipped the booking
    // write). Sanity-check by confirming the gap matches the discount.
    const gap = booking.totalAmount - payment.amount;
    const discount = payment.remainderDiscountAmount ?? 0;
    if (gap !== discount) {
      // Defensive: bail rather than guess. If the gap doesn't match
      // the discount, something else is going on (manual edit?
      // multi-step partial collection with a separate adjustment?).
      console.log(
        `SKIP   ${booking.id}: gap ${gap} ≠ remainderDiscount ${discount}; needs manual review`,
      );
      skipped++;
      continue;
    }

    const newTotal = booking.totalAmount - discount;
    const newDiscount = booking.discountAmount + discount;
    // Invariant: originalAmount = totalAmount + discountAmount when a
    // discount applies; null otherwise. Re-derive instead of preserving
    // the old originalAmount, which was tied to the pre-edit slot config.
    const newOriginal = newDiscount > 0 ? newTotal + newDiscount : null;

    console.log(
      `FIX    ${booking.id}: ` +
        `total ${booking.totalAmount}→${newTotal}, ` +
        `discount ${booking.discountAmount}→${newDiscount}, ` +
        `original ${booking.originalAmount ?? "null"}→${newOriginal ?? "null"}`,
    );

    if (!dryRun) {
      await db.booking.update({
        where: { id: booking.id },
        data: {
          totalAmount: newTotal,
          discountAmount: newDiscount,
          originalAmount: newOriginal,
        },
      });
    }
    fixed++;
  }

  console.log(
    `\nDone. fixed=${fixed} alreadyOk=${alreadyOk} skipped=${skipped}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
