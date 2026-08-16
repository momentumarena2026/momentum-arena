/**
 * Why do three admin surfaces show three different "sports earnings"?
 *
 * Reads only. Runs the SAME query each surface runs, then breaks the gaps
 * into named components so the difference stops being a mystery:
 *
 *   /admin/bookings  "Total Sports Earnings"   — actions/admin-booking.ts
 *   /admin/analytics "Sports Earnings" KPI     — getKPIStats
 *   Monthly Earnings — Year View               — getMonthlyEarningsForYear
 *
 * The three answer different questions on purpose (bookings-only vs all
 * sports streams; money booked vs money received), so this does not judge
 * them — it prints what each includes and what each leaves out.
 *
 * Usage: npx tsx scripts/reconcile-sports-earnings.ts --year 2026 [--from YYYY-MM-DD --to YYYY-MM-DD]
 */
import { PrismaClient, Prisma } from "@prisma/client";

const db = new PrismaClient();

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const pad = (s: string, n = 46) => s.padEnd(n);
const num = (v: unknown) => Number(v ?? 0);

const EARNING = Prisma.join(["CONFIRMED", "COMPLETED", "ABSENT"]);

async function main() {
  const year = Number(arg("year") || new Date().getUTCFullYear());
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearNext = new Date(Date.UTC(year + 1, 0, 1));

  // The KPI window defaults exactly as the page does: earliest confirmed
  // payment → today. Overridable so a specific screenshot can be matched.
  const earliest = await db.payment.findFirst({
    where: { status: "COMPLETED", confirmedAt: { not: null } },
    orderBy: { confirmedAt: "asc" },
    select: { confirmedAt: true },
  });
  const from = new Date(arg("from") || earliest?.confirmedAt?.toISOString().slice(0, 10) || "2026-01-01");
  const to = new Date(arg("to") || new Date().toISOString().slice(0, 10));
  to.setUTCHours(23, 59, 59, 999);

  console.log(`\nSports earnings reconciliation — year ${year}`);
  console.log(`KPI window: ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}\n`);

  // ── 1. Bookings-page tile: booked money, bookings only, lifetime ──
  const tileAgg = await db.booking.aggregate({
    where: { status: { in: ["CONFIRMED", "COMPLETED", "ABSENT"] } },
    _sum: { totalAmount: true },
  });
  const [{ covered: tileCovered }] = await db.$queryRaw<{ covered: bigint | null }[]>(Prisma.sql`
    SELECT SUM(pr."coveredAmount")::bigint AS covered
    FROM "PassRedemption" pr
    JOIN "Booking" b ON b.id = pr."bookingId"
    WHERE pr."restoredAt" IS NULL AND b.status::text IN (${EARNING})
  `);
  const tile = num(tileAgg._sum.totalAmount) - num(tileCovered);

  // ── 2. KPI: cash received in window, every sports stream ──
  const [kpiBookings] = await db.$queryRaw<{ revenue: bigint | null }[]>(Prisma.sql`
    SELECT SUM(b."totalAmount" - COALESCE(pr.covered, 0))::bigint AS revenue
    FROM "Booking" b
    INNER JOIN "Payment" p ON p."bookingId" = b.id
    LEFT JOIN (
      SELECT "bookingId", SUM("coveredAmount") AS covered
      FROM "PassRedemption" WHERE "restoredAt" IS NULL GROUP BY "bookingId"
    ) pr ON pr."bookingId" = b.id
    WHERE b.status::text IN (${EARNING})
      AND p.status = 'COMPLETED'
      AND p."confirmedAt" >= ${from} AND p."confirmedAt" <= ${to}
  `);
  const passWin = await db.userPass.aggregate({
    where: { purchasedAt: { gte: from, lte: to }, price: { gt: 0 } },
    _sum: { price: true },
  });
  const tourWin = await db.tournamentTeam.aggregate({
    where: { status: "CONFIRMED", archivedAt: null, paidAmount: { gt: 0 }, paidAt: { gte: from, lte: to } },
    _sum: { paidAmount: true },
  });
  const orgWin = await db.tournamentOrganizerPayment.aggregate({
    where: { receivedAt: { gte: from, lte: to } },
    _sum: { amount: true },
  });
  const campWin = await db.campRegistration.aggregate({
    where: { status: "CONFIRMED", archivedAt: null, paidAmount: { gt: 0 }, paidAt: { gte: from, lte: to } },
    _sum: { paidAmount: true },
  });
  const kpiExtras =
    num(passWin._sum.price) + num(tourWin._sum.paidAmount) +
    num(orgWin._sum.amount) + num(campWin._sum.paidAmount);
  const kpi = num(kpiBookings.revenue) + kpiExtras;

  // ── 3. Year view: booked money by PLAY date, every sports stream ──
  const [yearBookings] = await db.$queryRaw<{ revenue: bigint | null }[]>(Prisma.sql`
    SELECT SUM(b."totalAmount" - COALESCE(pr.covered, 0))::bigint AS revenue
    FROM "Booking" b
    LEFT JOIN (
      SELECT "bookingId", SUM("coveredAmount") AS covered
      FROM "PassRedemption" WHERE "restoredAt" IS NULL GROUP BY "bookingId"
    ) pr ON pr."bookingId" = b.id
    WHERE b.status::text IN (${EARNING})
      AND b.date >= ${yearStart} AND b.date < ${yearNext}
  `);
  const IST = 330 * 60 * 1000;
  const istStart = new Date(yearStart.getTime() - IST);
  const istNext = new Date(yearNext.getTime() - IST);
  const passYr = await db.userPass.aggregate({
    where: { purchasedAt: { gte: istStart, lt: istNext }, price: { gt: 0 } },
    _sum: { price: true },
  });
  const tourYr = await db.tournamentTeam.aggregate({
    where: { status: "CONFIRMED", archivedAt: null, paidAmount: { gt: 0 }, paidAt: { gte: istStart, lt: istNext } },
    _sum: { paidAmount: true },
  });
  const orgYr = await db.tournamentOrganizerPayment.aggregate({
    where: { receivedAt: { gte: istStart, lt: istNext } },
    _sum: { amount: true },
  });
  const campYr = await db.campRegistration.aggregate({
    where: { status: "CONFIRMED", archivedAt: null, paidAmount: { gt: 0 }, paidAt: { gte: istStart, lt: istNext } },
    _sum: { paidAmount: true },
  });
  const yearExtras =
    num(passYr._sum.price) + num(tourYr._sum.paidAmount) +
    num(orgYr._sum.amount) + num(campYr._sum.paidAmount);
  const yearTotal = num(yearBookings.revenue) + yearExtras;

  // ── The money the KPI's payment filter leaves out ──
  const [uncollected] = await db.$queryRaw<{ amt: bigint | null; cnt: bigint }[]>(Prisma.sql`
    SELECT SUM(b."totalAmount" - COALESCE(pr.covered, 0))::bigint AS amt, COUNT(*)::bigint AS cnt
    FROM "Booking" b
    LEFT JOIN "Payment" p ON p."bookingId" = b.id
    LEFT JOIN (
      SELECT "bookingId", SUM("coveredAmount") AS covered
      FROM "PassRedemption" WHERE "restoredAt" IS NULL GROUP BY "bookingId"
    ) pr ON pr."bookingId" = b.id
    WHERE b.status::text IN (${EARNING})
      AND b.date >= ${yearStart} AND b.date < ${yearNext}
      AND (p.id IS NULL OR p.status <> 'COMPLETED')
  `);

  // ── Money that IS collected but never reaches the cash-basis reports ──
  //
  // The KPI (and "Today's Earning", and anything else keyed on
  // Payment.confirmedAt) counts a booking only when its payment is
  // COMPLETED *and* carries a confirmedAt inside the window. A completed
  // payment with a null timestamp is money in the till that no cash report
  // can see, so it is worth naming separately from genuinely-unpaid money.
  const invisible = await db.$queryRaw<
    { reason: string; cnt: bigint; amt: bigint | null }[]
  >(Prisma.sql`
    SELECT
      CASE
        WHEN p."confirmedAt" IS NULL THEN 'COMPLETED payment, confirmedAt is NULL'
        WHEN p."confirmedAt" < ${from} THEN 'confirmedAt before window'
        ELSE 'confirmedAt after window'
      END AS reason,
      COUNT(*)::bigint AS cnt,
      SUM(b."totalAmount" - COALESCE(pr.covered, 0))::bigint AS amt
    FROM "Booking" b
    INNER JOIN "Payment" p ON p."bookingId" = b.id
    LEFT JOIN (
      SELECT "bookingId", SUM("coveredAmount") AS covered
      FROM "PassRedemption" WHERE "restoredAt" IS NULL GROUP BY "bookingId"
    ) pr ON pr."bookingId" = b.id
    WHERE b.status::text IN (${EARNING})
      AND b.date >= ${yearStart} AND b.date < ${yearNext}
      AND p.status = 'COMPLETED'
      AND (p."confirmedAt" IS NULL OR p."confirmedAt" < ${from} OR p."confirmedAt" > ${to})
    GROUP BY reason
    ORDER BY reason
  `);

  const invisibleRows = await db.$queryRaw<
    { id: string; date: Date; amount: number; created: Date; method: string | null }[]
  >(Prisma.sql`
    SELECT b.id, b.date, b."totalAmount" AS amount, p."createdAt" AS created,
           p."method"::text AS method
    FROM "Booking" b
    INNER JOIN "Payment" p ON p."bookingId" = b.id
    WHERE b.status::text IN (${EARNING})
      AND b.date >= ${yearStart} AND b.date < ${yearNext}
      AND p.status = 'COMPLETED'
      AND (p."confirmedAt" IS NULL OR p."confirmedAt" < ${from} OR p."confirmedAt" > ${to})
    ORDER BY b.date
    LIMIT 40
  `);

  console.log("THE THREE NUMBERS");
  console.log(`  ${pad("/admin/bookings  Total Sports Earnings")}${inr(tile)}`);
  console.log(`  ${pad("/admin/analytics Sports Earnings (KPI)")}${inr(kpi)}`);
  console.log(`  ${pad(`Monthly Earnings — Year View ${year}`)}${inr(yearTotal)}\n`);

  console.log("THE BOOKINGS LEG, THREE WAYS (this is where the gap starts)");
  console.log(`  ${pad("Lifetime, booked        (tile uses this)")}${inr(num(tileAgg._sum.totalAmount) - num(tileCovered))}`);
  console.log(`  ${pad(`Play date in ${year}, booked  (year view uses this)`)}${inr(num(yearBookings.revenue))}`);
  console.log(`  ${pad("Payment received in window (KPI uses this)")}${inr(num(kpiBookings.revenue))}\n`);

  console.log("WHAT THE BOOKINGS TILE LEAVES OUT (lifetime streams)");
  console.log(`  ${pad("Pass sales")}${inr(num(passYr._sum.price))}`);
  console.log(`  ${pad("Tournament entry fees")}${inr(num(tourYr._sum.paidAmount))}`);
  console.log(`  ${pad("Third-party venue hire")}${inr(num(orgYr._sum.amount))}`);
  console.log(`  ${pad("Camp fees")}${inr(num(campYr._sum.paidAmount))}`);
  console.log(`  ${pad("→ total non-booking sports revenue")}${inr(yearExtras)}\n`);

  console.log("WHAT THE KPI LEAVES OUT (booked but not received)");
  console.log(`  ${pad(`Bookings with no COMPLETED payment (${num(uncollected.cnt)} rows)`)}${inr(num(uncollected.amt))}\n`);

  console.log("COLLECTED BUT INVISIBLE TO CASH REPORTS");
  if (invisible.length === 0) {
    console.log("  (none — every completed payment carries a usable timestamp)\n");
  } else {
    for (const r of invisible) {
      console.log(`  ${pad(`${r.reason} (${num(r.cnt)} rows)`)}${inr(num(r.amt))}`);
    }
    console.log("");
    console.log("  Affected bookings (up to 40):");
    for (const r of invisibleRows) {
      console.log(
        `    ${r.id}  ${new Date(r.date).toISOString().slice(0, 10)}  ${inr(r.amount).padStart(10)}  ` +
        `payment created ${new Date(r.created).toISOString().slice(0, 10)}  ${r.method ?? "-"}`,
      );
    }
    console.log("");
  }

  console.log("GAPS");
  console.log(`  ${pad("KPI − tile")}${inr(kpi - tile)}`);
  console.log(`  ${pad("Year view − KPI")}${inr(yearTotal - kpi)}`);
  console.log(`  ${pad("Year view − tile")}${inr(yearTotal - tile)}\n`);
  console.log("Read-only: this script issued no writes.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
