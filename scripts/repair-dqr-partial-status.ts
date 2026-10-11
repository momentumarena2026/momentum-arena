/**
 * Repair DQR payments stamped COMPLETED while money is still owed.
 *
 * One-off, for the rows written before the fix in lib/dqr-settlement.ts.
 * A customer who tapped "I've paid" on a 50% advance had their payment
 * settled by confirmDqrBooking's late-settlement branch, which wrote
 * `status: "COMPLETED"` without reading isPartialPayment. The advance
 * fields were left intact and still say what is owed, so the row
 * contradicts itself: ₹350 outstanding, marked paid in full.
 *
 * ── WHY THIS DECIDES NOTHING OF ITS OWN ───────────────────────────────
 * The new status comes from `settledPaymentStatus`, the same pure
 * function the live code now calls. A repair script that re-implemented
 * the rule would be free to disagree with it — and the disagreement
 * would show up as rows that flip back and forth depending on which
 * ran last. Importing it means the repair is correct for exactly as
 * long as the fix is.
 *
 * Deliberately NARROW. It only touches rows where all of:
 *   - isPartialPayment is true
 *   - remainingAmount is above zero
 *   - no remainder has been recorded as collected
 *   - status is COMPLETED
 * Anything the counter has already settled is left alone, because its
 * COMPLETED is the truth.
 *
 * Money is not moved, recalculated or refunded. advanceAmount,
 * remainingAmount and amount are untouched; only the label changes.
 *
 *   npx tsx scripts/repair-dqr-partial-status.ts --dry-run
 *   npx tsx scripts/repair-dqr-partial-status.ts --allow-production
 */
import { PrismaClient } from "@prisma/client";
import { settledPaymentStatus } from "../lib/dqr-settlement";

const db = new PrismaClient();
const PRODUCTION_ENDPOINT = "ep-dark-hat-ampi5dah";
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (
    url.includes(PRODUCTION_ENDPOINT) &&
    !DRY_RUN &&
    !process.argv.includes("--allow-production")
  ) {
    throw new Error(
      "REFUSING TO RUN: that is the PRODUCTION branch. Pass --allow-production if you mean it.",
    );
  }
  console.log(`database: ${url.match(/@([^/?]+)/)?.[1] ?? "unknown"}`);
  if (DRY_RUN) console.log("DRY RUN — nothing will be written\n");

  const candidates = await db.payment.findMany({
    where: {
      status: "COMPLETED",
      isPartialPayment: true,
      remainingAmount: { gt: 0 },
      remainderMethod: null,
    },
    select: {
      id: true,
      bookingId: true,
      // Selected, not just filtered on: settledPaymentStatus reads it,
      // and the typecheck is what noticed it was missing.
      isPartialPayment: true,
      amount: true,
      advanceAmount: true,
      remainingAmount: true,
      method: true,
      confirmedBy: true,
      createdAt: true,
      booking: { select: { totalAmount: true, user: { select: { name: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (candidates.length === 0) {
    console.log("Nothing to repair — no payment is marked COMPLETED with money still owed.");
    return;
  }

  console.log(`${candidates.length} payment(s) contradict themselves:\n`);
  let changed = 0;
  for (const p of candidates) {
    const want = settledPaymentStatus(p);
    // Guard rather than assume: if the shared rule ever says COMPLETED
    // is right for a row this query returned, believe the rule and skip.
    if (want === "COMPLETED") {
      console.log(`  ${p.id}  left alone — the rule says COMPLETED is correct`);
      continue;
    }
    console.log(
      `  ${p.booking?.user?.name ?? "?"}  booking ${p.bookingId}\n` +
        `    ₹${p.amount} paid of ₹${p.booking?.totalAmount ?? "?"} · ₹${p.remainingAmount} still owed · ${p.method} via ${p.confirmedBy}\n` +
        `    COMPLETED → ${want}`,
    );
    if (!DRY_RUN) {
      await db.payment.update({ where: { id: p.id }, data: { status: want } });
    }
    changed++;
  }

  console.log(`\n${DRY_RUN ? "would repair" : "repaired"} ${changed} row(s)`);

  if (!DRY_RUN) {
    // Read back rather than trust the write. The whole defect was a
    // field saying something the row's other fields contradicted, so
    // confirming the contradiction is gone is the only honest proof.
    const left = await db.payment.count({
      where: {
        status: "COMPLETED",
        isPartialPayment: true,
        remainingAmount: { gt: 0 },
        remainderMethod: null,
      },
    });
    console.log(
      left === 0
        ? "verified: no payment is marked COMPLETED with money still owed"
        : `STILL ${left} contradictory row(s) — investigate`,
    );
    if (left > 0) process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
