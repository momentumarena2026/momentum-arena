/**
 * Recover the platform for bookings recorded as "web" by the default-arg
 * bug (fixed in actions/booking.ts — createBookingFromHold now falls back
 * to the hold's platform).
 *
 * Two tiers, and the distinction matters because one is evidence and the
 * other is inference:
 *
 *   EXACT   The DQR initiate route logged the real platform alongside the
 *           transactionId, and Payment.phonePeMerchantTxnId stores that
 *           same id. That is a join, not a guess.
 *
 *   LIKELY  For everything else, the booking.lock audit row for the same
 *           user shortly before the booking. Applied ONLY when every
 *           candidate lock in the window agrees on one platform — a user
 *           who touched both web and app in that hour is left alone
 *           rather than guessed at.
 *
 * DRY RUN by default. --apply writes. --exact-only skips the inferred tier.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const EXACT_ONLY = process.argv.includes("--exact-only");
const pad = (s: string, n = 34) => s.padEnd(n);

type Row = { id: string; platform: string; createdAt: Date; via: string };

async function main() {
  console.log(`\n${APPLY ? "APPLYING" : "DRY RUN"} — booking platform backfill`);
  console.log(EXACT_ONLY ? "Tier: EXACT only\n" : "Tiers: EXACT + LIKELY\n");

  const total = await db.booking.count();
  const webCount = await db.booking.count({ where: { platform: "web" } });
  console.log(`  ${pad("Bookings total")}${total}`);
  console.log(`  ${pad("Currently recorded web")}${webCount}\n`);

  // ── EXACT: DQR initiate log ⇄ Payment.phonePeMerchantTxnId ──
  const exact = await db.$queryRaw<Row[]>`
    SELECT DISTINCT ON (b.id)
           b.id, l.platform, b."createdAt", 'dqr-initiate' AS via
    FROM "Booking" b
    JOIN "Payment" p ON p."bookingId" = b.id
    JOIN "ServerActionLog" l
      ON l.action = 'payment.dqr.initiate'
     AND l.metadata->>'transactionId' = p."phonePeMerchantTxnId"
    WHERE b.platform = 'web'
      AND l.platform <> 'web'
      AND p."phonePeMerchantTxnId" IS NOT NULL
    ORDER BY b.id, l."occurredAt" ASC
  `;

  // ── LIKELY: the user's own lock, and only when unambiguous ──
  const likely = EXACT_ONLY
    ? []
    : await db.$queryRaw<Row[]>`
        SELECT b.id,
               MIN(l.platform) AS platform,
               b."createdAt",
               'booking-lock' AS via
        FROM "Booking" b
        JOIN "ServerActionLog" l
          ON l."userId" = b."userId"
         AND l.action = 'booking.lock'
         AND l."occurredAt" <= b."createdAt"
         AND l."occurredAt" >= b."createdAt" - interval '60 minutes'
        WHERE b.platform = 'web'
        GROUP BY b.id, b."createdAt"
        -- Every lock in the window must agree, and agree on a NON-web
        -- platform. Mixed evidence means we genuinely don't know.
        HAVING COUNT(DISTINCT l.platform) = 1 AND MIN(l.platform) <> 'web'
      `;

  const exactIds = new Set(exact.map((r) => r.id));
  const likelyOnly = likely.filter((r) => !exactIds.has(r.id));
  const all = [...exact, ...likelyOnly];

  const by = (rows: Row[]) =>
    rows.reduce<Record<string, number>>((a, r) => {
      a[r.platform] = (a[r.platform] ?? 0) + 1;
      return a;
    }, {});

  console.log(`  ${pad("EXACT  (dqr initiate join)")}${exact.length}  ${JSON.stringify(by(exact))}`);
  console.log(`  ${pad("LIKELY (unambiguous lock)")}${likelyOnly.length}  ${JSON.stringify(by(likelyOnly))}`);
  console.log(`  ${pad("→ would correct")}${all.length}`);
  console.log(`  ${pad("left as web (no evidence)")}${webCount - all.length}\n`);

  for (const r of all.slice(0, 25)) {
    console.log(
      `    ${r.id}  ${new Date(r.createdAt).toISOString().slice(0, 10)}  web → ${r.platform.padEnd(8)} (${r.via})`,
    );
  }
  if (all.length > 25) console.log(`    … and ${all.length - 25} more`);
  console.log("");

  if (!APPLY) {
    console.log("Dry run: nothing written. Re-run with --apply.\n");
    return;
  }
  let done = 0;
  for (const r of all) {
    await db.booking.update({ where: { id: r.id }, data: { platform: r.platform } });
    done++;
  }
  console.log(`Updated ${done} bookings.\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
