/**
 * Correct the founders' equity history, and record today's two movements.
 *
 * The seed laid down a flat ₹7,00,000 each. That was right in total and
 * wrong for two of the three: Utkarsh was ₹1,50,000 short, and Anand
 * covered the gap — so Anand had ₹8,50,000 in and Utkarsh ₹5,50,000. The
 * total still matched the capex, which is why nothing ever flagged it.
 *
 * Today Utkarsh transferred his remaining ₹1,50,000 into the Sportive
 * Ventures account, completing his ₹7,00,000, and Anand withdrew
 * ₹1,00,000 of what he had fronted.
 *
 * Recorded as dated MOVEMENTS rather than by editing the two totals,
 * because "who has paid what" and "when did it move" are different
 * questions and the second one has no answer if the history is overwritten.
 * A withdrawal is a negative movement — it is the owner taking their own
 * money out, not a cost to the business, so it must never reach the P&L
 * as an expense.
 *
 *   npx tsx scripts/record-capital-movements.ts [--apply]
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/** What each founder ACTUALLY had in before today. */
const OPENING: Record<string, number> = {
  Nakul: 700_000,
  Anand: 850_000,
  Utkarsh: 550_000,
};
const UTKARSH_TOPUP = 150_000;
const ANAND_WITHDRAWAL = 100_000;

async function main() {
  console.log(APPLY ? "APPLYING" : "DRY RUN — pass --apply to write");
  console.log("");

  const today = new Date();
  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const rows = await db.capitalContribution.findMany({
    where: { kind: "EQUITY" },
    orderBy: { name: "asc" },
  });

  console.log("Before:");
  for (const r of rows) {
    console.log(`   ${r.name.padEnd(9)} ₹${r.amount.toLocaleString("en-IN").padStart(10)}  ${r.startDate.toISOString().slice(0, 10)}`);
  }
  console.log("");

  if (rows.length !== 3) {
    console.log(`Expected 3 opening equity rows, found ${rows.length}. Stopping.`);
    return;
  }
  const already = rows.some((r) => r.note?.includes("Repaid") || r.note?.includes("Withdrew"));
  if (already) {
    console.log("Movements already recorded — nothing to do.");
    return;
  }

  console.log("Planned:");
  for (const r of rows) {
    const opening = OPENING[r.name];
    if (opening == null) {
      console.log(`   ${r.name}: not a known founder, leaving alone`);
      continue;
    }
    if (opening !== r.amount) {
      console.log(
        `   ${r.name.padEnd(9)} opening corrected ₹${r.amount.toLocaleString("en-IN")} → ₹${opening.toLocaleString("en-IN")}`,
      );
    }
  }
  console.log(`   Utkarsh   + ₹${UTKARSH_TOPUP.toLocaleString("en-IN")}  (repaid, completes ₹7,00,000)`);
  console.log(`   Anand     − ₹${ANAND_WITHDRAWAL.toLocaleString("en-IN")}  (withdrawal)`);
  console.log("");

  const after: Record<string, number> = { ...OPENING };
  after.Utkarsh += UTKARSH_TOPUP;
  after.Anand -= ANAND_WITHDRAWAL;
  console.log("After:");
  for (const [n, v] of Object.entries(after)) {
    console.log(`   ${n.padEnd(9)} ₹${v.toLocaleString("en-IN").padStart(10)}`);
  }
  const total = Object.values(after).reduce((a, b) => a + b, 0);
  console.log(`   equity total ₹${total.toLocaleString("en-IN")}`);
  console.log("");

  if (!APPLY) {
    console.log("DRY RUN — nothing written.");
    return;
  }

  await db.$transaction(async (tx) => {
    // Restate the opening rows to what was actually transferred, keeping
    // their original date — this is correcting a record, not a movement.
    for (const r of rows) {
      const opening = OPENING[r.name];
      if (opening == null || opening === r.amount) continue;
      await tx.capitalContribution.update({
        where: { id: r.id },
        data: {
          amount: opening,
          note:
            r.name === "Anand"
              ? "Founder equity, including ₹1,50,000 fronted on Utkarsh's behalf"
              : "Founder equity contribution to the build-out (part paid)",
        },
      });
    }
    await tx.capitalContribution.create({
      data: {
        name: "Utkarsh",
        kind: "EQUITY",
        amount: UTKARSH_TOPUP,
        startDate: todayUtc,
        note: "Repaid the balance fronted by Anand — equity now complete at ₹7,00,000",
      },
    });
    await tx.capitalContribution.create({
      data: {
        name: "Anand",
        kind: "EQUITY",
        amount: -ANAND_WITHDRAWAL,
        startDate: todayUtc,
        note: "Withdrew ₹1,00,000 of the amount fronted for Utkarsh",
      },
    });
  });
  console.log("Written.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
