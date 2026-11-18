import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/password";
import { ALL_PERMISSIONS } from "../lib/permissions";

const prisma = new PrismaClient();

/**
 * Production seed — runs on every push to `main` via the seed-production
 * workflow, and on every push to `development` via seed-staging.
 *
 * The only thing this script does is upsert the "gamelord" superadmin so
 * there's always a login that can reach /admin. The update branch refreshes
 * `permissions` to the current `ALL_PERMISSIONS` export, so newly-added
 * permission constants are auto-granted to the superadmin without a manual
 * intervention each release.
 *
 * Everything else (court configs, time classifications, pricing rules,
 * coupons, FAQs, court-deactivations, NEWUSER state) used to live here as
 * `upsert(..., update: { … })` blocks. The update branches silently
 * clobbered admin edits on every deploy — most visibly, bowling-machine
 * pricing kept resetting from ₹250 back to the hardcoded SHARED defaults
 * (₹400/₹600) until we pulled those blocks out. All of that data is now
 * admin-managed via the /admin/* surfaces and bootstrapped manually on a
 * fresh DB (or restored from a snapshot).
 */
async function main() {
  const superadminPassword = await hashPassword("burninhell@26");
  await prisma.adminUser.upsert({
    where: { username: "gamelord" },
    update: {
      permissions: [...ALL_PERMISSIONS],
    },
    create: {
      username: "gamelord",
      email: "y12.nakul@gmail.com",
      passwordHash: superadminPassword,
      role: "SUPERADMIN",
      permissions: [...ALL_PERMISSIONS],
      isDeletable: false,
    },
  });
  console.log("Seeded superadmin user: gamelord");

  // ── WORLDCUP25 — worldcup-final-day football promo ────────────────
  // 25% off FOOTBALL bookings whose PLAY DATE is 20 Jul 2026 (the
  // final), auto-applied at checkout AHEAD of the new-user welcome
  // code (autoApply coupons are tried first by both checkouts).
  //
  // CREATE-ONLY upsert (update: {}) per this file's policy — the seed
  // creates the coupon once per environment (dev now; production when
  // the branch is promoted to main, via seed-production) and never
  // clobbers later admin edits. Admins retire it via isActive.
  const gamelord = await prisma.adminUser.findUnique({
    where: { username: "gamelord" },
    select: { id: true },
  });
  await prisma.coupon.upsert({
    where: { code: "WORLDCUP25" },
    update: {},
    create: {
      code: "WORLDCUP25",
      description:
        "Worldcup Final Day — 25% off football bookings played on 20 Jul 2026",
      scope: "SPORTS",
      type: "PERCENTAGE",
      value: 2500, // basis points = 25%
      maxUses: null, // unlimited total
      maxUsesPerUser: 1_000_000, // effectively unlimited (schema min 1)
      minAmount: null, // no minimum
      sportFilter: ["FOOTBALL"],
      validPlatforms: [], // web + app
      isStackable: false,
      isPublic: true,
      isSystemCode: false,
      autoApply: true,
      // Redeemable from now until the end of final day IST — the
      // BOOKING_DATE condition below is what pins WHICH day is booked.
      validFrom: new Date("2026-07-16T00:00:00+05:30"),
      validUntil: new Date("2026-07-20T23:59:59+05:30"),
      isActive: true,
      createdBy: gamelord!.id,
      conditions: {
        create: [
          {
            conditionType: "BOOKING_DATE",
            conditionValue: JSON.stringify({
              from: "2026-07-20",
              to: "2026-07-20",
            }),
          },
        ],
      },
    },
  });
  console.log("Seeded coupon: WORLDCUP25 (create-only)");

  // ── Pickleball launch banner → promo-banner system ────────────────
  // Migrates the previously-hardcoded homepage + slot-page banner into
  // the admin-managed PromoBanner module. Linked to PICKLEBALL25 so it
  // keeps the exact old behaviour: visible while the coupon is live,
  // gone the moment admin disables/expires it. CREATE-ONLY (find by
  // title) — admin edits are never clobbered.
  const pickleball25 = await prisma.coupon.findUnique({
    where: { code: "PICKLEBALL25" },
    select: { id: true },
  });
  const existingPbBanner = await prisma.promoBanner.findFirst({
    where: { title: "Pickleball Launch Offer" },
    select: { id: true },
  });
  if (!existingPbBanner) {
    await prisma.promoBanner.create({
      data: {
        title: "Pickleball Launch Offer",
        // Site-relative /public asset (1200×400) — web renders it
        // directly; the mobile API absolutises it per request.
        imageUrl: "/pickleball-promo-banner.jpg",
        appImageUrl: "/pickleball-promo-banner.jpg",
        aspectRatio: 3,
        linkUrl: "/book/pickleball",
        placement: ["HOME_PROMO", "SLOT_SELECTION"],
        couponId: pickleball25?.id ?? null,
        startsAt: null,
        endsAt: null,
        isActive: true,
        sortOrder: 0,
        createdBy: gamelord!.id,
      },
    });
    console.log("Seeded promo banner: Pickleball Launch Offer (create-only)");
  }

  // ── ExpenseOption.isVenture backfill ───────────────────────────────
  //
  // The flag marks a payer as the venture's own account rather than a
  // person owed their money back, and it drives the "to reimburse"
  // figures on Running Expenses.
  //
  // It arrives as a new column defaulting to FALSE, which would make the
  // venture look like a person owed six figures the moment the column
  // lands. This sets it for the payer that has always been treated that
  // way, so the numbers do not change under anyone.
  //
  // Idempotent and one-directional: it only ever turns the flag ON for
  // these exact labels, so an admin who later switches one OFF in
  // Dropdowns does not get overruled by the next deploy.
  // Matched in JS rather than with a `label: { in: [...], mode:
  // "insensitive" }` filter: Prisma's insensitive mode is documented
  // for equals/contains/startsWith/endsWith, and relying on it applying
  // to `in` would be a filter that typechecks and might quietly match
  // nothing. Comparing here is unambiguous.
  const VENTURE_PAYER_SEED = new Set(["sportive ventures", "sportive venture"]);
  const payerOptions = await prisma.expenseOption.findMany({
    where: { field: "DONE_BY", isVenture: false },
    select: { id: true, label: true },
  });
  const toFlag = payerOptions
    .filter((o) => VENTURE_PAYER_SEED.has(o.label.trim().toLowerCase()))
    .map((o) => o.id);
  if (toFlag.length > 0) {
    await prisma.expenseOption.updateMany({
      where: { id: { in: toFlag } },
      data: { isVenture: true },
    });
    console.log(
      `Seeded ExpenseOption.isVenture on ${toFlag.length} payer option(s)`,
    );
  }

  // ── BookingSettlement backfill / reconcile ─────────────────────────
  //
  // Venue-side booking money now lives in BookingSettlement, one row
  // per instalment with a real `receivedAt`. Everything collected
  // before that ledger existed has no rows, so this reconstructs them
  // from what was recorded at the time: the AMOUNTS from the
  // Payment.remainder* columns (structured, trustworthy) and the DATE
  // from the last REMAINDER_COLLECTED audit row — precisely what the
  // collections report used to infer on every page load. The numbers on
  // screen therefore do not move; what changes is where they come from.
  // Checked against production before shipping: 667 bookings, ₹7,17,701
  // across 344 day/channel cells, zero cells different either way.
  //
  // It reconciles rather than skips. Any booking whose settlement rows
  // fall SHORT of its Payment totals gets one row for the difference,
  // so this repairs a partial ledger as well as an empty one and is
  // idempotent — a second run finds no shortfall and writes nothing.
  // A booking whose rows are in SURPLUS on any leg is left alone and
  // counted: that should be impossible (both writers move the rows and
  // the columns in one transaction) and guessing at it would turn a
  // visible anomaly into a quiet wrong number.
  //
  // A booking collected over two visits before the ledger gets ONE row
  // dated to the later visit, because the per-visit amounts only ever
  // existed inside a generated sentence. The note says so rather than
  // letting a tidy row imply precision it does not have, and the
  // collections screen keeps counting these separately.
  const withRemainder = await prisma.payment.findMany({
    where: {
      OR: [
        { remainderCashAmount: { gt: 0 } },
        { remainderUpiAmount: { gt: 0 } },
      ],
    },
    select: {
      bookingId: true,
      confirmedAt: true,
      remainderCashAmount: true,
      remainderUpiAmount: true,
      remainderDiscountAmount: true,
    },
  });
  if (withRemainder.length > 0) {
    // Grouped queries rather than a lookup per booking — this runs
    // against production inside a deploy, not on a laptop.
    const [events, ledgered] = await Promise.all([
      prisma.bookingEditHistory.groupBy({
        by: ["bookingId"],
        where: { editType: "REMAINDER_COLLECTED" },
        _max: { createdAt: true },
        _count: { _all: true },
      }),
      prisma.bookingSettlement.groupBy({
        by: ["bookingId"],
        _sum: { cashAmount: true, upiAmount: true, discountAmount: true },
      }),
    ]);
    const eventMap = new Map(
      events.map((e) => [
        e.bookingId,
        { at: e._max.createdAt, count: e._count._all },
      ]),
    );
    const ledgerMap = new Map(
      ledgered.map((l) => [
        l.bookingId,
        {
          cash: l._sum.cashAmount ?? 0,
          upi: l._sum.upiAmount ?? 0,
          discount: l._sum.discountAmount ?? 0,
        },
      ]),
    );

    const rows: {
      bookingId: string;
      amount: number;
      cashAmount: number;
      upiAmount: number;
      discountAmount: number;
      method: "CASH" | "UPI_QR";
      receivedAt: Date;
      note: string;
    }[] = [];
    let undateable = 0;
    let surplus = 0;
    for (const p of withRemainder) {
      const have = ledgerMap.get(p.bookingId) ?? {
        cash: 0,
        upi: 0,
        discount: 0,
      };
      const cashAmount = (p.remainderCashAmount ?? 0) - have.cash;
      const upiAmount = (p.remainderUpiAmount ?? 0) - have.upi;
      const discountAmount = (p.remainderDiscountAmount ?? 0) - have.discount;
      if (cashAmount < 0 || upiAmount < 0 || discountAmount < 0) {
        surplus++;
        continue;
      }
      if (cashAmount + upiAmount + discountAmount === 0) continue; // in step

      const ev = eventMap.get(p.bookingId);
      // No audit row and no confirmed advance leaves nothing honest to
      // date the money with. Skipped and counted rather than stamped
      // with today, which would drop it into the current month.
      const receivedAt = ev?.at ?? p.confirmedAt;
      if (!receivedAt) {
        undateable++;
        continue;
      }
      const visits = ev?.count ?? 0;
      rows.push({
        bookingId: p.bookingId,
        amount: cashAmount + upiAmount,
        cashAmount,
        upiAmount,
        discountAmount,
        method: upiAmount > cashAmount ? "UPI_QR" : "CASH",
        receivedAt,
        note:
          visits > 1
            ? `Backfilled from ${visits} collection events — the per-visit amounts were never recorded, so the whole balance sits on the last one`
            : "Backfilled from the recorded collection",
      });
    }
    if (rows.length > 0) {
      await prisma.bookingSettlement.createMany({ data: rows });
    }
    console.log(
      `BookingSettlement: wrote ${rows.length} row(s) for ${withRemainder.length} booking(s) with venue-side money` +
        (undateable > 0 ? `; skipped ${undateable} with no usable date` : "") +
        (surplus > 0
          ? `; LEFT ALONE ${surplus} whose rows exceed their Payment totals — investigate`
          : ""),
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
