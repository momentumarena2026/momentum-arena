/**
 * Give COMPLETED payments a confirmedAt so cash reporting can see them.
 *
 * Every cash-basis figure — the Sports Earnings KPI, "Today's Earning",
 * the CA report — filters on Payment.confirmedAt. A payment marked
 * COMPLETED without one is money in the till that no such report counts.
 * Found by scripts/reconcile-sports-earnings.ts.
 *
 * The timestamp used is `updatedAt`, falling back to `createdAt`. For a
 * counter payment those are the moment the row was written or last
 * touched, which is the closest honest answer available; the alternative
 * — stamping "now" — would book May's cash into August and move money
 * between accounting months. Never invents a date outside the row's own
 * lifetime.
 *
 * DRY RUN by default. Pass --apply to write.
 *
 * Usage: npx tsx scripts/backfill-payment-confirmed-at.ts [--apply]
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

async function main() {
  const rows = await db.payment.findMany({
    where: { status: "COMPLETED", confirmedAt: null },
    select: {
      id: true,
      amount: true,
      method: true,
      createdAt: true,
      updatedAt: true,
      booking: { select: { id: true, date: true, totalAmount: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\n${APPLY ? "APPLYING" : "DRY RUN"} — COMPLETED payments with no confirmedAt\n`);

  if (rows.length === 0) {
    console.log("Nothing to do: every completed payment already carries a timestamp.\n");
    return;
  }

  let total = 0;
  for (const p of rows) {
    const stamp = p.updatedAt ?? p.createdAt;
    total += p.booking?.totalAmount ?? p.amount;
    console.log(
      `  ${p.id}  booking ${p.booking?.id ?? "—"}  ` +
        `${p.booking ? new Date(p.booking.date).toISOString().slice(0, 10) : "—"}  ` +
        `${inr(p.booking?.totalAmount ?? p.amount).padStart(10)}  ${p.method}  ` +
        `→ confirmedAt ${stamp.toISOString()}`,
    );
  }
  console.log(`\n  ${rows.length} payments · ${inr(total)} of booking value affected\n`);

  if (!APPLY) {
    console.log("Dry run: nothing written. Re-run with --apply to write.\n");
    return;
  }

  let done = 0;
  for (const p of rows) {
    await db.payment.update({
      where: { id: p.id },
      data: { confirmedAt: p.updatedAt ?? p.createdAt },
    });
    done++;
  }
  console.log(`Wrote confirmedAt on ${done} payments.\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
