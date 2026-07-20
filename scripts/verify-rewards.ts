/**
 * Rewards / points invariant harness.
 *
 * Run against a NON-PRODUCTION database:
 *   DATABASE_URL='<staging url>' npx tsx scripts/verify-rewards.ts
 *
 * Every case builds real rows (user + booking + payment + cafe order),
 * calls the REAL engine in lib/rewards/*, asserts the outcome, then
 * DELETES everything it made — nothing is left behind. Unlike
 * verify-pass-coverage.ts we cannot wrap a case in one outer
 * transaction and throw ROLLBACK at the end: the engine functions take
 * no `tx` argument, they open their OWN transactions on the global
 * `db` singleton. So teardown is explicit (see `cleanup`), and every
 * user this script creates is tracked in CREATED so a mid-run crash
 * still gets swept in the final `finally`.
 *
 * THE CENTRAL INVARIANT, asserted after EVERY case by `assertInvariant`:
 *   RewardBalance.pointsAvailable === SUM(RewardTransaction.points)
 * plus its corollary the engine also promises ("we never let balance go
 * negative" — revoke.ts): pointsAvailable >= 0. Points are redeemable
 * against a real bill, so a divergence here is money, not bookkeeping.
 *
 * Cases named `[suspect]` assert what the engine OUGHT to do, not what
 * it currently does. They are expected to fail on today's code; each
 * one carries a comment naming the file:line it indicts. Do not
 * "fix" them by weakening the assertion.
 *
 * TWO THINGS THIS SCRIPT MUTATES OUTSIDE ITS OWN ROWS — read before running:
 *  1. RewardConfig("singleton"). The engine reads its guard rails from
 *     that single row, so the harness overwrites it with a deterministic
 *     TEST_CONFIG and restores the original in the final `finally`. A
 *     SIGINT handler restores too. A hard kill (-9) will leave the test
 *     config in place — re-run the script to restore.
 *  2. runExpirySweep() takes no user filter; it sweeps the WHOLE table.
 *     The expiry cases count how many OTHER users' rows the sweep would
 *     touch and print it before running. Set VERIFY_SKIP_EXPIRY=1 to
 *     skip those cases entirely.
 */
import type {
  Prisma,
  RewardConfig,
  RewardTransaction,
  RewardTxnType,
  Sport,
} from "@prisma/client";
import { db } from "../lib/db";
import {
  adminGrantPoints,
  awardBirthdayBonus,
  awardBookingPoints,
  awardBookingRemainderPoints,
  awardCafePoints,
  awardReferralBonus,
  awardSignupBonus,
  previewBookingEarn,
} from "../lib/rewards/earn";
import {
  commitRedeemInTx,
  previewRedemption,
  redeemForBooking,
  refundRedemption,
} from "../lib/rewards/redeem";
import { revokeBookingRewards } from "../lib/rewards/revoke";
import { runExpirySweep } from "../lib/rewards/expire";
import {
  getRewardConfig,
  invalidateRewardConfigCache,
} from "../lib/rewards/config";

// ---------------------------------------------------------------
// Environment
// ---------------------------------------------------------------

// Any active court works — we never exercise availability, only the
// FK. Same default as verify-pass-coverage.ts; override elsewhere.
const COURT_ENV = process.env.VERIFY_COURT_CONFIG_ID ?? "cmn5rkkgs000e21074z2nj0wd";
// Optional: attach a real CafeOrderItem line so the cafe order looks
// like production. awardCafePoints never reads items, so this is
// cosmetic — the cafe cases run fine without it.
const CAFE_ITEM_ENV = process.env.VERIFY_CAFE_ITEM_ID ?? "";
const SKIP_EXPIRY = process.env.VERIFY_SKIP_EXPIRY === "1";

const TAG = "VERIFY-REWARDS";
// Far future so the rows can never collide with anything real on the
// availability grid a human might be staring at on staging.
const DATE = new Date("2030-01-15T00:00:00Z");
const ALL_SPORTS: Sport[] = ["CRICKET", "FOOTBALL", "PICKLEBALL"];
const EARN_TYPES: RewardTxnType[] = [
  "EARNED_BOOKING",
  "EARNED_BOOKING_REMAINDER",
  "EARNED_CAFE",
  "EARNED_SIGNUP",
  "EARNED_REFERRAL",
  "EARNED_BIRTHDAY",
  "EARNED_ADJUSTMENT",
  "ADJUSTMENT_REFUND",
];

let COURT_ID = COURT_ENV;
let COURT_SPORT: Sport = "PICKLEBALL";
let ADMIN_ID: string | null = null;

let pass = 0;
let fail = 0;
let skip = 0;
/** Every user this run created — swept in the final `finally`. */
const CREATED = new Set<string>();

// ---------------------------------------------------------------
// Deterministic config
// ---------------------------------------------------------------

type CfgFields = Omit<RewardConfig, "id" | "updatedAt">;

/**
 * 10% booking earn at ₹1/point makes every expectation in this file
 * a mental one-liner: points = floor(rupees / 10).
 *
 * earnToRedeemMinHours is 0 so a freshly-seeded balance is spendable.
 * We ALSO back-date the ledger rows with `backdate()` before every
 * redeem, because previewRedemption computes its hold cutoff from the
 * NODE clock while createdAt comes from the DB clock — a couple of
 * seconds of skew between Neon and the laptop would otherwise make
 * redemptions flap. The one case that WANTS the hold sets the hours
 * itself and skips the back-date.
 */
const TEST_CONFIG: CfgFields = {
  earnRateBookingBps: 1000, // 10%
  earnRateCafeBps: 1000, // 10%
  pointValuePaise: 100, // 1 point = ₹1
  minPointsToRedeem: 50,
  maxRedemptionPctOfBill: 20,
  maxRedemptionPaisePerTxn: 50000, // ₹500
  pointExpiryMonths: 12,
  earnToRedeemMinHours: 0,
  signupBonusPoints: 100,
  referralEarnerPoints: 75,
  referralReferredPoints: 25,
  birthdayBonusPoints: 60,
  highVelocityEarnDailyThreshold: 5000,
  bulkRedemptionPaiseThreshold: 50000,
  enabled: true,
  cafeEarnEnabled: true,
  enabledSports: [],
};

let ORIGINAL_CONFIG: RewardConfig | null = null;

async function writeConfig(c: CfgFields): Promise<void> {
  await db.rewardConfig.update({
    where: { id: "singleton" },
    data: { ...c, enabledSports: { set: c.enabledSports } },
  });
  // The engine hot-caches the config for 60s per process; without this
  // bust every case after the first would read stale guard rails.
  invalidateRewardConfigCache();
}

/** Apply TEST_CONFIG with a per-case patch on top. */
async function cfg(patch: Partial<CfgFields> = {}): Promise<void> {
  await writeConfig({ ...TEST_CONFIG, ...patch });
}

async function restoreConfig(): Promise<void> {
  if (!ORIGINAL_CONFIG) return;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id, updatedAt: _u, ...rest } = ORIGINAL_CONFIG;
  await writeConfig(rest);
}

// ---------------------------------------------------------------
// Case plumbing
// ---------------------------------------------------------------

class Skip extends Error {}

interface Ctx {
  users: string[];
  errors: string[];
  notes: string[];
  ok(label: string, cond: boolean, detail?: string): void;
  eq(label: string, actual: unknown, expected: unknown): void;
  note(s: string): void;
}

function newCtx(): Ctx {
  const c: Ctx = {
    users: [],
    errors: [],
    notes: [],
    ok(label, cond, detail) {
      if (!cond) c.errors.push(detail ? `${label} — ${detail}` : label);
    },
    eq(label, actual, expected) {
      if (actual !== expected) {
        c.errors.push(`${label}: got ${fmt(actual)}, want ${fmt(expected)}`);
      }
    },
    note(s) {
      c.notes.push(s);
    },
  };
  return c;
}

function fmt(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  return typeof v === "string" ? `"${v}"` : String(v);
}

function msg(e: unknown): string {
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}

/**
 * THE shared assertion. Every case runs this against every user it
 * touched, no matter which flow the case exercised — so a future
 * change that lets ANY path write a ledger row without its balance
 * delta (or vice versa) fails loudly here rather than surfacing as a
 * customer complaint six months later.
 */
async function assertInvariant(userId: string): Promise<string[]> {
  const errs: string[] = [];
  const [balance, agg] = await Promise.all([
    db.rewardBalance.findUnique({ where: { userId } }),
    db.rewardTransaction.aggregate({ where: { userId }, _sum: { points: true } }),
  ]);
  const materialized = balance?.pointsAvailable ?? 0;
  const ledger = agg._sum.points ?? 0;
  if (materialized !== ledger) {
    errs.push(
      `INVARIANT BROKEN: RewardBalance.pointsAvailable=${materialized} but SUM(RewardTransaction.points)=${ledger}`,
    );
  }
  if (materialized < 0) {
    errs.push(`NEGATIVE BALANCE: pointsAvailable=${materialized}`);
  }
  return errs;
}

async function run(name: string, fn: (c: Ctx) => Promise<void>): Promise<void> {
  const c = newCtx();
  try {
    await fn(c);
    for (const userId of c.users) {
      c.errors.push(...(await assertInvariant(userId)));
    }
    if (c.errors.length === 0) {
      pass++;
      console.log(`PASS  ${name}`);
    } else {
      fail++;
      console.log(`FAIL  ${name}`);
      for (const e of c.errors) console.log(`      ${e}`);
    }
    for (const n of c.notes) console.log(`      · ${n}`);
  } catch (e) {
    if (e instanceof Skip) {
      skip++;
      console.log(`SKIP  ${name}\n      ${e.message}`);
    } else {
      fail++;
      console.log(`FAIL  ${name}\n      threw: ${msg(e)}`);
    }
  } finally {
    await cleanup(c.users);
  }
}

// ---------------------------------------------------------------
// Row builders + teardown
// ---------------------------------------------------------------

let seq = 0;
function uniq(): string {
  seq += 1;
  return `${Date.now().toString(36)}${seq.toString(36)}${Math.floor(Math.random() * 1e6)}`;
}

async function mkUser(c: Ctx, data: Partial<Prisma.UserCreateInput> = {}): Promise<string> {
  // User.phone is @unique and staging already has real rows in it, so
  // retry on the (rare) collision instead of failing the case for a
  // reason that has nothing to do with rewards.
  for (let attempt = 0; ; attempt++) {
    try {
      const u = await db.user.create({
        data: {
          // 10-digit local part behind +91 keeps normalisePhone happy
          // and is obviously synthetic in the admin user list.
          phone: `+9199${String(Math.floor(Math.random() * 9e7 + 1e7))}`,
          name: TAG,
          ...data,
        },
      });
      c.users.push(u.id);
      CREATED.add(u.id);
      return u.id;
    } catch (e) {
      const collision =
        e !== null && typeof e === "object" && "code" in e && e.code === "P2002";
      if (!collision || attempt >= 4) throw e;
    }
  }
}

interface BookingOpts {
  /** Booking.totalAmount, RUPEES. */
  total: number;
  /** Payment.amount, RUPEES — the money actually captured. */
  paid: number;
  status?: Prisma.BookingCreateInput["status"];
  paymentStatus?: Prisma.PaymentCreateWithoutBookingInput["status"];
  method?: Prisma.PaymentCreateWithoutBookingInput["method"];
  discount?: number;
  isPartial?: boolean;
  advance?: number;
  createdByAdminId?: string;
}

async function mkBooking(userId: string, o: BookingOpts): Promise<string> {
  const b = await db.booking.create({
    data: {
      userId,
      courtConfigId: COURT_ID,
      date: DATE,
      status: o.status ?? "CONFIRMED",
      totalAmount: o.total,
      discountAmount: o.discount ?? 0,
      createdByAdminId: o.createdByAdminId ?? null,
      slots: {
        create: [
          { startHour: 6, startMinute: 0, durationMinutes: 60, price: o.total },
        ],
      },
      payment: {
        create: {
          amount: o.paid,
          method: o.method ?? "RAZORPAY",
          status: o.paymentStatus ?? "COMPLETED",
          confirmedBy: TAG,
          isPartialPayment: o.isPartial ?? false,
          advanceAmount: o.advance ?? null,
          remainingAmount: o.isPartial ? o.total - (o.advance ?? o.paid) : null,
        },
      },
    },
  });
  return b.id;
}

interface CafeOpts {
  /** CafePayment.amount, RUPEES (Float — decimals are legal here). */
  paid: number;
  status?: Prisma.CafeOrderCreateInput["status"];
  paymentStatus?: Prisma.CafePaymentCreateWithoutOrderInput["status"];
}

async function mkCafeOrder(userId: string, o: CafeOpts): Promise<string> {
  const order = await db.cafeOrder.create({
    data: {
      userId,
      orderNumber: `VR-${uniq()}`,
      status: o.status ?? "COMPLETED",
      totalAmount: o.paid,
      items: CAFE_ITEM_ENV
        ? {
            create: [
              {
                cafeItemId: CAFE_ITEM_ENV,
                itemName: TAG,
                quantity: 1,
                unitPrice: o.paid,
                totalPrice: o.paid,
              },
            ],
          }
        : undefined,
      payment: {
        create: {
          amount: o.paid,
          method: "RAZORPAY",
          status: o.paymentStatus ?? "COMPLETED",
          confirmedBy: TAG,
        },
      },
    },
  });
  return order.id;
}

/**
 * Push every ledger row for the user two hours into the past.
 *
 * previewRedemption filters eligible earns with `createdAt <= now -
 * earnToRedeemMinHours`, where `now` is the NODE clock and createdAt
 * is the DB clock. Doing the shift in SQL with NOW() means the margin
 * is measured entirely on the DB clock and survives any plausible
 * skew — without this the redeem cases would flake.
 */
async function backdate(userId: string): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE "RewardTransaction" SET "createdAt" = NOW() - INTERVAL '2 hours' WHERE "userId" = $1`,
    userId,
  );
}

/** Drag every credit row's expiresAt into the past so the cron sees it. */
async function expireEarns(userId: string): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE "RewardTransaction" SET "expiresAt" = NOW() - INTERVAL '1 day' WHERE "userId" = $1 AND "points" > 0`,
    userId,
  );
}

/** Re-read `read` until `done` or the budget runs out. For the engine's
 *  handful of deliberately un-awaited side effects. */
async function poll<T>(
  read: () => Promise<T>,
  done: (v: T) => boolean,
  budgetMs = 5000,
): Promise<T> {
  const deadline = Date.now() + budgetMs;
  let last = await read();
  while (!done(last) && Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 200));
    last = await read();
  }
  return last;
}

async function balanceOf(userId: string): Promise<number> {
  const b = await db.rewardBalance.findUnique({ where: { userId } });
  return b?.pointsAvailable ?? 0;
}

async function ledger(
  userId: string,
  type?: RewardTxnType,
): Promise<RewardTransaction[]> {
  return db.rewardTransaction.findMany({
    where: { userId, ...(type ? { type } : {}) },
    orderBy: { createdAt: "asc" },
  });
}

/** Seed exactly `points` spendable points via a real booking earn. */
async function seedPoints(userId: string, points: number): Promise<void> {
  // 10% of ₹(points*10) is exactly `points` under TEST_CONFIG.
  const bookingId = await mkBooking(userId, { total: points * 10, paid: points * 10 });
  const r = await awardBookingPoints(bookingId);
  if (r.points !== points) {
    throw new Error(
      `seedPoints wanted ${points}, engine awarded ${r.points ?? 0} (${r.reason ?? "no reason"})`,
    );
  }
  await backdate(userId);
}

/**
 * Explicit teardown, child rows first. Payment/CafePayment have no
 * cascade off their parent, and Booking/CafeOrder have no cascade off
 * User, so the order below is load-bearing.
 */
async function cleanup(userIds: string[]): Promise<void> {
  for (const userId of userIds) {
    try {
      await db.rewardTransaction.deleteMany({ where: { userId } });
      await db.rewardAlert.deleteMany({ where: { userId } });
      await db.rewardBalance.deleteMany({ where: { userId } });
      await db.payment.deleteMany({ where: { booking: { userId } } });
      await db.booking.deleteMany({ where: { userId } });
      await db.cafePayment.deleteMany({ where: { order: { userId } } });
      await db.cafeOrderItem.deleteMany({ where: { order: { userId } } });
      await db.cafeOrder.deleteMany({ where: { userId } });
      await db.user.delete({ where: { id: userId } });
      CREATED.delete(userId);
    } catch (e) {
      console.warn(`      ! cleanup failed for user ${userId}: ${msg(e)}`);
    }
  }
}

// ---------------------------------------------------------------
// EARN
// ---------------------------------------------------------------

async function earnCases(): Promise<void> {
  await run("earn: full online payment ₹2000 → 200 pts", async (c) => {
    await cfg();
    const u = await mkUser(c);
    const b = await mkBooking(u, { total: 2000, paid: 2000, method: "RAZORPAY" });
    const r = await awardBookingPoints(b);
    c.eq("awarded", r.awarded, true);
    c.eq("points", r.points, 200);
    c.eq("balance", await balanceOf(u), 200);
    const rows = await ledger(u, "EARNED_BOOKING");
    c.eq("EARNED_BOOKING rows", rows.length, 1);
    c.eq("pointsValuePaise", rows[0]?.pointsValuePaise, 200 * 100);
    c.ok("expiresAt set", rows[0]?.expiresAt instanceof Date);
  });

  await run("earn: cash-confirmed booking ₹2000 → 200 pts", async (c) => {
    await cfg();
    const u = await mkUser(c);
    // Shape confirmCashPayment leaves behind: CASH + COMPLETED.
    const b = await mkBooking(u, {
      total: 2000,
      paid: 2000,
      method: "CASH",
      paymentStatus: "COMPLETED",
    });
    const r = await awardBookingPoints(b);
    c.eq("points", r.points, 200);
    c.eq("balance", await balanceOf(u), 200);
  });

  await run("earn: 50% advance ₹775 of ₹1550 → 77 pts (earn on PAID, not total)", async (c) => {
    await cfg();
    const u = await mkUser(c);
    const b = await mkBooking(u, {
      total: 1550,
      paid: 775,
      paymentStatus: "PARTIAL",
      isPartial: true,
      advance: 775,
    });
    const r = await awardBookingPoints(b);
    // floor(775/10) = 77 — NOT floor(1550/10) = 155. Earning on
    // totalAmount here would credit points for money never collected.
    c.eq("points", r.points, 77);
    c.eq("balance", await balanceOf(u), 77);
  });

  await run("earn: advance then remainder collected → 77 + 78 = 155 (no floor drift)", async (c) => {
    await cfg();
    const u = await mkUser(c);
    const b = await mkBooking(u, {
      total: 1550,
      paid: 775,
      paymentStatus: "PARTIAL",
      isPartial: true,
      advance: 775,
    });
    c.eq("advance earn", (await awardBookingPoints(b)).points, 77);
    // Replicate exactly what markRemainderCollected writes before it
    // calls the remainder helper: Payment.amount rises to the full
    // collected sum and status flips PARTIAL → COMPLETED.
    await db.payment.update({
      where: { bookingId: b },
      data: { amount: 1550, status: "COMPLETED", remainingAmount: 0 },
    });
    const r = await awardBookingRemainderPoints(b);
    // 775+775 split naively floors to 77+77=154; the delta-from-total
    // formula must recover the lost point. This is the whole reason
    // awardBookingRemainderPoints recomputes instead of adding.
    c.eq("remainder points", r.points, 78);
    c.eq("total balance", await balanceOf(u), 155);
    c.eq("== points on full bill", 155, Math.floor(1550 / 10));
  });

  await run("earn: remainder helper refuses while payment still PARTIAL", async (c) => {
    await cfg();
    const u = await mkUser(c);
    const b = await mkBooking(u, {
      total: 1550,
      paid: 775,
      paymentStatus: "PARTIAL",
      isPartial: true,
      advance: 775,
    });
    await awardBookingPoints(b);
    const r = await awardBookingRemainderPoints(b);
    c.eq("awarded", r.awarded, false);
    c.eq("reason", r.reason, "payment not completed");
    c.eq("balance untouched", await balanceOf(u), 77);
  });

  await run("earn: pass-covered booking (Payment.amount 0) → 0 pts, no ledger row", async (c) => {
    await cfg();
    const u = await mkUser(c);
    const b = await mkBooking(u, { total: 2400, paid: 0, method: "PASS" });
    const r = await awardBookingPoints(b);
    c.eq("awarded", r.awarded, false);
    c.eq("reason", r.reason, "zero points");
    c.eq("ledger rows", (await ledger(u)).length, 0);
    c.eq("balance", await balanceOf(u), 0);
  });

  await run("earn: 100%-coupon booking (paid 0) → 0 pts", async (c) => {
    await cfg();
    const u = await mkUser(c);
    const b = await mkBooking(u, { total: 0, paid: 0, method: "FREE", discount: 2000 });
    const r = await awardBookingPoints(b);
    c.eq("awarded", r.awarded, false);
    c.eq("balance", await balanceOf(u), 0);
  });

  await run("earn: partial coupon ₹2000-₹500 → 150 pts (post-discount, not rack rate)", async (c) => {
    await cfg();
    const u = await mkUser(c);
    const b = await mkBooking(u, { total: 1500, paid: 1500, discount: 500 });
    const r = await awardBookingPoints(b);
    // 200 here would mean the customer earned on the venue's discount.
    c.eq("points", r.points, 150);
  });

  await run("earn: idempotent under a repeated call", async (c) => {
    await cfg();
    const u = await mkUser(c);
    const b = await mkBooking(u, { total: 2000, paid: 2000 });
    const first = await awardBookingPoints(b);
    const second = await awardBookingPoints(b);
    c.eq("first awarded", first.awarded, true);
    c.eq("second awarded", second.awarded, false);
    c.eq("second reason", second.reason, "already credited");
    c.eq("EARNED_BOOKING rows", (await ledger(u, "EARNED_BOOKING")).length, 1);
    c.eq("balance", await balanceOf(u), 200);
  });

  await run("earn: idempotent under CONCURRENT calls (webhook + verify race)", async (c) => {
    await cfg();
    const u = await mkUser(c);
    const b = await mkBooking(u, { total: 2000, paid: 2000 });
    // Razorpay's verify endpoint and its webhook routinely land within
    // milliseconds of each other; both call awardBookingPoints.
    const results = await Promise.allSettled([
      awardBookingPoints(b),
      awardBookingPoints(b),
      awardBookingPoints(b),
    ]);
    const credited = results.filter(
      (r) => r.status === "fulfilled" && r.value.awarded,
    ).length;
    c.eq("exactly one credit", credited, 1);
    c.eq("EARNED_BOOKING rows", (await ledger(u, "EARNED_BOOKING")).length, 1);
    c.eq("balance", await balanceOf(u), 200);
  });

  await run("earn: PENDING booking earns nothing", async (c) => {
    await cfg();
    const u = await mkUser(c);
    const b = await mkBooking(u, { total: 2000, paid: 2000, status: "PENDING" });
    const r = await awardBookingPoints(b);
    c.eq("awarded", r.awarded, false);
    c.eq("reason", r.reason, "not confirmed");
    c.eq("ledger rows", (await ledger(u)).length, 0);
  });

  await run("earn: admin-created booking earns nothing", async (c) => {
    if (!ADMIN_ID) throw new Skip("no AdminUser row in this database");
    await cfg();
    const u = await mkUser(c);
    const b = await mkBooking(u, {
      total: 2000,
      paid: 2000,
      createdByAdminId: ADMIN_ID,
    });
    const r = await awardBookingPoints(b);
    c.eq("awarded", r.awarded, false);
    c.eq("reason", r.reason, "admin-created booking");
    c.eq("ledger rows", (await ledger(u)).length, 0);
  });

  await run("earn: sport not in enabledSports earns nothing", async (c) => {
    await cfg({ enabledSports: ALL_SPORTS.filter((s) => s !== COURT_SPORT) });
    const u = await mkUser(c);
    const b = await mkBooking(u, { total: 2000, paid: 2000 });
    const r = await awardBookingPoints(b);
    c.eq("awarded", r.awarded, false);
    c.eq("reason", r.reason, "sport disabled");
  });

  await run("earn: kill switch (enabled=false) earns nothing", async (c) => {
    await cfg({ enabled: false });
    const u = await mkUser(c);
    const b = await mkBooking(u, { total: 2000, paid: 2000 });
    const r = await awardBookingPoints(b);
    c.eq("awarded", r.awarded, false);
    c.eq("balance", await balanceOf(u), 0);
  });

  await run("earn: preview matches actual for the same bill", async (c) => {
    await cfg();
    const u = await mkUser(c);
    const live = await getRewardConfig();
    // Checkout (web + mobile) renders this number BEFORE the customer
    // pays. If it disagrees with what the engine later credits, the
    // customer sees a broken promise on their balance screen.
    for (const rupees of [2000, 1550, 999, 1, 33333]) {
      const predicted = previewBookingEarn({
        billPaise: rupees * 100,
        sport: COURT_SPORT,
        config: live,
      });
      const b = await mkBooking(u, { total: rupees, paid: rupees });
      const actual = (await awardBookingPoints(b)).points ?? 0;
      c.eq(`preview vs actual @₹${rupees}`, predicted, actual);
    }
    c.eq(
      "preview honours admin-created gate",
      previewBookingEarn({
        billPaise: 200000,
        sport: COURT_SPORT,
        createdByAdmin: true,
        config: live,
      }),
      0,
    );
  });

  await run("earn: cafe order ₹250.50 → 25 pts + idempotent", async (c) => {
    await cfg();
    const u = await mkUser(c);
    const o = await mkCafeOrder(u, { paid: 250.5 });
    const r = await awardCafePoints(o);
    // floor(25050 paise / 100) = ₹250 → floor(250 * 1000 / 10000) = 25.
    c.eq("points", r.points, 25);
    c.eq("second call", (await awardCafePoints(o)).awarded, false);
    c.eq("EARNED_CAFE rows", (await ledger(u, "EARNED_CAFE")).length, 1);
    c.eq("balance", await balanceOf(u), 25);
  });

  await run("earn: guest cafe order (no userId) earns nothing", async (c) => {
    await cfg();
    const order = await db.cafeOrder.create({
      data: {
        orderNumber: `VR-${uniq()}`,
        guestName: TAG,
        status: "COMPLETED",
        totalAmount: 500,
        payment: {
          create: { amount: 500, method: "CASH", status: "COMPLETED", confirmedBy: TAG },
        },
      },
    });
    try {
      const r = await awardCafePoints(order.id);
      c.eq("awarded", r.awarded, false);
      c.eq("reason", r.reason, "guest order");
    } finally {
      await db.cafePayment.deleteMany({ where: { orderId: order.id } });
      await db.cafeOrderItem.deleteMany({ where: { orderId: order.id } });
      await db.cafeOrder.delete({ where: { id: order.id } });
    }
  });

  await run(
    "[suspect] earn: cafe order still in PENDING_PAYMENT with an unpaid CafePayment must NOT earn",
    async (c) => {
      await cfg();
      const u = await mkUser(c);
      // lib/rewards/earn.ts:222 rejects only CANCELLED and PENDING.
      // PENDING_PAYMENT — the payment-first state where the order is
      // deliberately invisible to admin and stock is not yet
      // decremented — falls through, and there is NO check on
      // payment.status either. An unpaid order credits real points.
      const o = await mkCafeOrder(u, {
        paid: 500,
        status: "PENDING_PAYMENT",
        paymentStatus: "PENDING",
      });
      const r = await awardCafePoints(o);
      c.eq("awarded", r.awarded, false);
      c.eq("balance", await balanceOf(u), 0);
    },
  );

  await run("earn: admin manual grant writes ledger + ADJUSTMENT_AUDIT alert", async (c) => {
    await cfg();
    const u = await mkUser(c);
    const r = await adminGrantPoints({
      userId: u,
      points: 250,
      actorAdminId: ADMIN_ID ?? TAG,
      reason: "harness grant",
    });
    c.eq("awarded", r.awarded, true);
    c.eq("balance", await balanceOf(u), 250);
    const alerts = await db.rewardAlert.findMany({
      where: { userId: u, kind: "ADJUSTMENT_AUDIT" },
    });
    c.eq("audit alerts", alerts.length, 1);
    const neg = await adminGrantPoints({
      userId: u,
      points: -50,
      actorAdminId: ADMIN_ID ?? TAG,
      reason: "harness negative",
    });
    c.eq("negative grant refused", neg.awarded, false);
    c.eq("balance unchanged", await balanceOf(u), 250);
  });
}

// ---------------------------------------------------------------
// BONUSES — signup / referral / birthday
// ---------------------------------------------------------------

async function bonusCases(): Promise<void> {
  await run("[suspect] bonus: signup fires EXACTLY once per user", async (c) => {
    await cfg();
    const u = await mkUser(c);
    const first = await awardSignupBonus(u);
    c.eq("first awarded", first.points, 100);
    // insertBonusEarn (lib/rewards/earn.ts:484) has no idempotency key:
    // @@unique([type, bookingId]) is NULL-tolerant in Postgres, and a
    // signup row carries no bookingId. A retried OTP verify, a
    // duplicated after() dispatch, or any future caller doubles this.
    const second = await awardSignupBonus(u);
    c.eq("second awarded", second.awarded, false);
    c.eq("EARNED_SIGNUP rows", (await ledger(u, "EARNED_SIGNUP")).length, 1);
    c.eq("balance", await balanceOf(u), 100);
  });

  await run("bonus: signup is a no-op when signupBonusPoints = 0", async (c) => {
    await cfg({ signupBonusPoints: 0 });
    const u = await mkUser(c);
    const r = await awardSignupBonus(u);
    c.eq("awarded", r.awarded, false);
    c.eq("ledger rows", (await ledger(u)).length, 0);
  });

  await run("bonus: referral credits BOTH sides once", async (c) => {
    await cfg();
    const earner = await mkUser(c);
    const referred = await mkUser(c);
    const r = await awardReferralBonus({ earnerId: earner, referredId: referred });
    c.eq("earner points", r.earner.points, 75);
    c.eq("referred points", r.referred.points, 25);
    c.eq("earner balance", await balanceOf(earner), 75);
    c.eq("referred balance", await balanceOf(referred), 25);
  });

  await run("[suspect] bonus: referral replay must not double-credit", async (c) => {
    await cfg();
    const earner = await mkUser(c);
    const referred = await mkUser(c);
    await awardReferralBonus({ earnerId: earner, referredId: referred });
    // Same missing idempotency key as signup. actions/referral.ts
    // guards with a `referredBy IS NULL` updateMany, so today only a
    // race gets through — but the engine itself offers no protection,
    // and awardReferralBonus is exported for anyone to call.
    await awardReferralBonus({ earnerId: earner, referredId: referred });
    c.eq("earner balance", await balanceOf(earner), 75);
    c.eq("referred balance", await balanceOf(referred), 25);
  });

  await run("[suspect] bonus: birthday fires at most once per user per sweep", async (c) => {
    await cfg();
    const u = await mkUser(c);
    c.eq("first", (await awardBirthdayBonus(u)).points, 60);
    // awardBirthdayBonus has NO caller anywhere in the repo (the admin
    // config still exposes birthdayBonusPoints), so it has never run in
    // production. If it is ever wired to a daily cron it will credit
    // 60 points EVERY day — there is no once-per-year guard and no
    // idempotency key.
    const second = await awardBirthdayBonus(u);
    c.eq("second awarded", second.awarded, false);
    c.eq("balance", await balanceOf(u), 60);
  });
}

// ---------------------------------------------------------------
// REDEEM
// ---------------------------------------------------------------

async function redeemCases(): Promise<void> {
  await run("redeem: 100 of 500 pts against a ₹2000 bill", async (c) => {
    await cfg();
    const u = await mkUser(c);
    await seedPoints(u, 500);
    const b = await mkBooking(u, { total: 2000, paid: 2000 });
    const r = await redeemForBooking({
      userId: u,
      bookingId: b,
      points: 100,
      billPaise: 2000 * 100,
    });
    c.eq("redeemed", r.redeemed, true);
    c.eq("pointsConsumed", r.pointsConsumed, 100);
    c.eq("discountPaise", r.discountPaise, 10000); // 100 pts × ₹1 = ₹100
    c.eq("balance", await balanceOf(u), 400);
    const rows = await ledger(u, "REDEEMED_BOOKING");
    c.eq("ledger row is a DEBIT", rows[0]?.points, -100);
    c.eq("valuePaise is negative", rows[0]?.pointsValuePaise, -10000);
  });

  await run("redeem: ABOVE balance is refused, ledger untouched", async (c) => {
    await cfg();
    const u = await mkUser(c);
    await seedPoints(u, 100);
    const b = await mkBooking(u, { total: 5000, paid: 5000 });
    const r = await redeemForBooking({
      userId: u,
      bookingId: b,
      points: 200,
      billPaise: 5000 * 100,
    });
    c.eq("redeemed", r.redeemed, false);
    c.eq("error", r.error, "Max 100 points allowed");
    c.eq("balance", await balanceOf(u), 100);
    c.eq("no debit rows", (await ledger(u, "REDEEMED_BOOKING")).length, 0);
  });

  await run("redeem: %-of-bill cap (₹500 bill → 100 pts max)", async (c) => {
    await cfg();
    const u = await mkUser(c);
    await seedPoints(u, 500);
    const preview = await previewRedemption({ userId: u, billPaise: 500 * 100 });
    // 20% of 50000 paise = 10000 paise = 100 points, well under the
    // 500 the user holds — the bill, not the balance, is the binding
    // constraint here.
    c.eq("maxPoints", preview.maxPoints, 100);
    c.eq("maxPaise", preview.maxPaise, 10000);
    const b = await mkBooking(u, { total: 500, paid: 500 });
    const over = await redeemForBooking({
      userId: u,
      bookingId: b,
      points: 150,
      billPaise: 500 * 100,
    });
    c.eq("over-cap refused", over.redeemed, false);
    const at = await redeemForBooking({
      userId: u,
      bookingId: b,
      points: 100,
      billPaise: 500 * 100,
    });
    c.eq("at-cap accepted", at.redeemed, true);
    c.eq("balance", await balanceOf(u), 400);
  });

  await run("redeem: absolute per-txn paise cap beats a huge bill", async (c) => {
    await cfg();
    const u = await mkUser(c);
    await seedPoints(u, 900);
    // 20% of a ₹100,000 bill would be ₹20,000 — the ₹500 absolute cap
    // must win, or one booking drains a year of someone's points.
    const preview = await previewRedemption({ userId: u, billPaise: 100000 * 100 });
    c.eq("maxPoints", preview.maxPoints, 500);
    const b = await mkBooking(u, { total: 100000, paid: 100000 });
    const r = await redeemForBooking({
      userId: u,
      bookingId: b,
      points: 600,
      billPaise: 100000 * 100,
    });
    c.eq("above absolute cap refused", r.redeemed, false);
    c.eq("balance", await balanceOf(u), 900);
  });

  await run("redeem: below minPointsToRedeem is refused", async (c) => {
    await cfg();
    const u = await mkUser(c);
    await seedPoints(u, 500);
    const b = await mkBooking(u, { total: 2000, paid: 2000 });
    const r = await redeemForBooking({
      userId: u,
      bookingId: b,
      points: 10,
      billPaise: 2000 * 100,
    });
    c.eq("redeemed", r.redeemed, false);
    c.eq("error", r.error, "Min 50 points");
    c.eq("balance", await balanceOf(u), 500);
  });

  await run("redeem: earn-to-redeem hold blocks freshly-earned points", async (c) => {
    await cfg({ earnToRedeemMinHours: 24 });
    const u = await mkUser(c);
    // Deliberately NOT back-dated — this is the "book a micro-slot to
    // earn, immediately redeem on a big booking" abuse path.
    const seed = await mkBooking(u, { total: 5000, paid: 5000 });
    c.eq("seed earn", (await awardBookingPoints(seed)).points, 500);
    const preview = await previewRedemption({ userId: u, billPaise: 5000 * 100 });
    c.eq("maxPoints", preview.maxPoints, 0);
    c.ok("blocked with a reason", Boolean(preview.blockedReason), preview.blockedReason);
    const b = await mkBooking(u, { total: 5000, paid: 5000 });
    const r = await redeemForBooking({
      userId: u,
      bookingId: b,
      points: 100,
      billPaise: 5000 * 100,
    });
    c.eq("redeem refused", r.redeemed, false);
    c.eq("balance", await balanceOf(u), 500);
  });

  await run("redeem: second redemption on the SAME booking is refused", async (c) => {
    await cfg();
    const u = await mkUser(c);
    await seedPoints(u, 500);
    const b = await mkBooking(u, { total: 5000, paid: 5000 });
    const args = { userId: u, bookingId: b, points: 100, billPaise: 5000 * 100 };
    c.eq("first", (await redeemForBooking(args)).redeemed, true);
    const second = await redeemForBooking(args);
    c.eq("second refused", second.redeemed, false);
    c.eq("second reason", second.error, "already redeemed");
    c.eq("debit rows", (await ledger(u, "REDEEMED_BOOKING")).length, 1);
    c.eq("balance", await balanceOf(u), 400);
  });

  await run(
    "[suspect] redeem: CONCURRENT double-spend of one balance must not overspend",
    async (c) => {
      await cfg();
      const u = await mkUser(c);
      await seedPoints(u, 100);
      const b1 = await mkBooking(u, { total: 5000, paid: 5000 });
      const b2 = await mkBooking(u, { total: 5000, paid: 5000 });
      const live = await getRewardConfig();
      const cfgArg = {
        pointValuePaise: live.pointValuePaise,
        bulkRedemptionPaiseThreshold: live.bulkRedemptionPaiseThreshold,
      };
      // Two checkout tabs paying at the same instant. commitRedeemInTx
      // (lib/rewards/redeem.ts:221) READS pointsAvailable and then
      // writes an unconditional `{ increment: -points }`. Under
      // Postgres READ COMMITTED both transactions read 100 before
      // either writes, so both pass the guard and the balance lands at
      // -100. The read is not a lock and there is no CHECK constraint
      // on RewardBalance.pointsAvailable.
      const results = await Promise.allSettled([
        db.$transaction((tx) =>
          commitRedeemInTx(tx, {
            userId: u,
            type: "REDEEMED_BOOKING",
            points: 100,
            bookingId: b1,
            cafeOrderId: null,
            cfg: cfgArg,
          }),
        ),
        db.$transaction((tx) =>
          commitRedeemInTx(tx, {
            userId: u,
            type: "REDEEMED_BOOKING",
            points: 100,
            bookingId: b2,
            cafeOrderId: null,
            cfg: cfgArg,
          }),
        ),
      ]);
      const won = results.filter((r) => r.status === "fulfilled").length;
      c.eq("exactly one redemption commits", won, 1);
      c.eq("balance", await balanceOf(u), 0);
      // assertInvariant additionally catches pointsAvailable < 0.
      c.note(`outcomes: ${results.map((r) => r.status).join(", ")}`);
    },
  );

  await run("redeem: bulk redemption over threshold raises a BULK_REDEMPTION alert", async (c) => {
    await cfg({ bulkRedemptionPaiseThreshold: 10000 }); // ₹100
    const u = await mkUser(c);
    await seedPoints(u, 500);
    const b = await mkBooking(u, { total: 5000, paid: 5000 });
    const r = await redeemForBooking({
      userId: u,
      bookingId: b,
      points: 200,
      billPaise: 5000 * 100,
    });
    c.eq("redeemed", r.redeemed, true);
    // The alert insert is voided (not awaited) inside commitRedeem
    // (lib/rewards/redeem.ts:316), so poll rather than sleeping a fixed
    // beat — a Neon cold start can easily outlast any constant we pick.
    const alerts = await poll(
      () => db.rewardAlert.findMany({ where: { userId: u, kind: "BULK_REDEMPTION" } }),
      (rows) => rows.length > 0,
    );
    c.eq("bulk alerts", alerts.length, 1);
  });
}

// ---------------------------------------------------------------
// REFUND / REVOKE
// ---------------------------------------------------------------

async function revokeCases(): Promise<void> {
  await run("refund: refundRedemption returns the points", async (c) => {
    await cfg();
    const u = await mkUser(c);
    await seedPoints(u, 500);
    const b = await mkBooking(u, { total: 5000, paid: 5000 });
    await redeemForBooking({ userId: u, bookingId: b, points: 100, billPaise: 5000 * 100 });
    c.eq("post-redeem balance", await balanceOf(u), 400);
    const r = await refundRedemption({
      userId: u,
      points: 100,
      bookingId: b,
      reason: "harness refund",
    });
    c.eq("refunded", r.refunded, true);
    c.eq("balance restored", await balanceOf(u), 500);
    const rows = await ledger(u, "ADJUSTMENT_REFUND");
    c.eq("refund rows", rows.length, 1);
    c.eq("refund is a credit", rows[0]?.points, 100);
  });

  await run("[suspect] refund: a replayed refund must not throw or double-credit", async (c) => {
    await cfg();
    const u = await mkUser(c);
    await seedPoints(u, 500);
    const b = await mkBooking(u, { total: 5000, paid: 5000 });
    await redeemForBooking({ userId: u, bookingId: b, points: 100, billPaise: 5000 * 100 });
    await refundRedemption({ userId: u, points: 100, bookingId: b, reason: "first" });
    // refundRedemption (lib/rewards/redeem.ts:353) has no try/catch for
    // P2002, so the @@unique([type, bookingId]) collision escapes as a
    // raw Prisma error. revokeBookingRewards guards with a
    // non-atomic existence check, which cancelBooking and refundBooking
    // can race — both dispatch it from after().
    let threw: string | null = null;
    try {
      await refundRedemption({ userId: u, points: 100, bookingId: b, reason: "replay" });
    } catch (e) {
      threw = msg(e).split("\n")[0];
    }
    c.ok("did not throw", threw === null, threw ?? undefined);
    c.eq("balance", await balanceOf(u), 500);
  });

  await run("revoke: cancel claws back the full unspent earn", async (c) => {
    await cfg();
    const u = await mkUser(c);
    const b = await mkBooking(u, { total: 2000, paid: 2000 });
    await awardBookingPoints(b);
    c.eq("pre-revoke balance", await balanceOf(u), 200);
    const r = await revokeBookingRewards(b);
    c.eq("revokedPoints", r.revokedPoints, 200);
    c.eq("balance", await balanceOf(u), 0);
    const rows = await ledger(u, "REVOKED");
    c.eq("REVOKED rows", rows.length, 1);
    c.eq("REVOKED is a debit", rows[0]?.points, -200);
    c.ok("sourceTxnId anchors the earn", Boolean(rows[0]?.sourceTxnId));
  });

  await run("revoke: claws back advance + remainder as ONE row", async (c) => {
    await cfg();
    const u = await mkUser(c);
    const b = await mkBooking(u, {
      total: 1550,
      paid: 775,
      paymentStatus: "PARTIAL",
      isPartial: true,
      advance: 775,
    });
    await awardBookingPoints(b);
    await db.payment.update({
      where: { bookingId: b },
      data: { amount: 1550, status: "COMPLETED", remainingAmount: 0 },
    });
    await awardBookingRemainderPoints(b);
    c.eq("pre-revoke balance", await balanceOf(u), 155);
    const r = await revokeBookingRewards(b);
    // @@unique([type, bookingId]) allows only one REVOKED row, so it
    // must cover BOTH earn rows or half the credit floats free.
    c.eq("revokedPoints", r.revokedPoints, 155);
    c.eq("REVOKED rows", (await ledger(u, "REVOKED")).length, 1);
    c.eq("balance", await balanceOf(u), 0);
  });

  await run("revoke: shortfall — earn already spent, clawback caps at available", async (c) => {
    await cfg();
    const u = await mkUser(c);
    const earnBooking = await mkBooking(u, { total: 2000, paid: 2000 });
    await awardBookingPoints(earnBooking); // +200
    await backdate(u);
    const spendBooking = await mkBooking(u, { total: 5000, paid: 5000 });
    await redeemForBooking({
      userId: u,
      bookingId: spendBooking,
      points: 150,
      billPaise: 5000 * 100,
    });
    c.eq("balance before revoke", await balanceOf(u), 50);
    const r = await revokeBookingRewards(earnBooking);
    // Wanted 200, only 50 left. Taking 200 would drive the balance
    // negative and hand the customer a debt they can't see.
    c.eq("revokedPoints", r.revokedPoints, 50);
    c.eq("balance", await balanceOf(u), 0);
    const alerts = await db.rewardAlert.findMany({
      where: { userId: u, kind: "PARTIAL_REVOKE_SHORTFALL" },
    });
    c.eq("shortfall alerts", alerts.length, 1);
    const details = alerts[0]?.details as { shortfall?: number } | null;
    c.eq("shortfall amount", details?.shortfall, 150);
  });

  await run("revoke: earn + redemption on the same booking unwind together", async (c) => {
    await cfg();
    const u = await mkUser(c);
    await seedPoints(u, 500);
    const b = await mkBooking(u, { total: 2000, paid: 2000 });
    await awardBookingPoints(b); // +200 → 700
    await backdate(u);
    await redeemForBooking({ userId: u, bookingId: b, points: 100, billPaise: 2000 * 100 });
    c.eq("balance before revoke", await balanceOf(u), 600);
    const r = await revokeBookingRewards(b);
    c.eq("revokedPoints", r.revokedPoints, 200);
    c.eq("refundedPoints", r.refundedPoints, 100);
    // 600 - 200 (earn clawed back) + 100 (redemption returned) = 500,
    // i.e. exactly the pre-booking balance.
    c.eq("balance back to pre-booking", await balanceOf(u), 500);
  });

  await run("revoke: idempotent under a repeated call", async (c) => {
    await cfg();
    const u = await mkUser(c);
    const b = await mkBooking(u, { total: 2000, paid: 2000 });
    await awardBookingPoints(b);
    const first = await revokeBookingRewards(b);
    const second = await revokeBookingRewards(b);
    c.eq("first revoked", first.revokedPoints, 200);
    c.eq("second revoked", second.revokedPoints, 0);
    c.eq("REVOKED rows", (await ledger(u, "REVOKED")).length, 1);
    c.eq("balance", await balanceOf(u), 0);
  });

  await run(
    "[suspect] revoke: a fully-drained earn must not re-raise its shortfall alert",
    async (c) => {
      await cfg();
      const u = await mkUser(c);
      const earnBooking = await mkBooking(u, { total: 2000, paid: 2000 });
      await awardBookingPoints(earnBooking); // +200
      await backdate(u);
      const spendBooking = await mkBooking(u, { total: 5000, paid: 5000 });
      await redeemForBooking({
        userId: u,
        bookingId: spendBooking,
        points: 200,
        billPaise: 5000 * 100,
      });
      c.eq("balance drained", await balanceOf(u), 0);
      // actualClawback is 0, so lib/rewards/revoke.ts:81 never writes
      // the REVOKED row — which means the `!existingRevoke` guard at
      // line 61 stays true forever and every retry (cancel then refund,
      // both via after()) files a fresh PARTIAL_REVOKE_SHORTFALL.
      await revokeBookingRewards(earnBooking);
      await revokeBookingRewards(earnBooking);
      const alerts = await db.rewardAlert.findMany({
        where: { userId: u, kind: "PARTIAL_REVOKE_SHORTFALL" },
      });
      c.eq("shortfall alerts", alerts.length, 1);
      c.eq("balance", await balanceOf(u), 0);
    },
  );
}

// ---------------------------------------------------------------
// EXPIRY
// ---------------------------------------------------------------

/**
 * runExpirySweep has no user filter — it walks the whole table. Report
 * the blast radius before firing so nobody is surprised on a shared
 * staging box.
 */
async function reportExpiryBlastRadius(): Promise<void> {
  const foreign = await db.rewardTransaction.count({
    where: {
      expiresAt: { lt: new Date() },
      type: { in: EARN_TYPES },
      consumers: { none: { type: "EXPIRED" } },
      userId: { notIn: [...CREATED] },
    },
  });
  console.log(
    `\n  runExpirySweep() is GLOBAL. ${foreign} pre-existing earn row(s) belonging to other users are already past their expiry and WILL be swept. Set VERIFY_SKIP_EXPIRY=1 to skip the expiry cases.`,
  );
  // The sweep walks at most 100 batches of 500, oldest expiry first.
  // Past that ceiling our freshly-expired rows fall off the end and the
  // expiry cases would fail for a reason that isn't a rewards bug.
  if (foreign > 49_000) {
    console.log(
      `  WARNING: ${foreign} exceeds the sweep's 50,000-row ceiling — the expiry cases may report false failures.`,
    );
  }
  console.log("");
}

async function expiryCases(): Promise<void> {
  if (SKIP_EXPIRY) {
    console.log("\n  VERIFY_SKIP_EXPIRY=1 — expiry cases skipped.\n");
    skip += 4;
    return;
  }
  await reportExpiryBlastRadius();

  await run("expire: sweep debits a fully-unspent expired earn, and is idempotent", async (c) => {
    await cfg();
    const u = await mkUser(c);
    const b = await mkBooking(u, { total: 2000, paid: 2000 });
    await awardBookingPoints(b);
    await expireEarns(u);
    await runExpirySweep();
    c.eq("balance", await balanceOf(u), 0);
    const rows = await ledger(u, "EXPIRED");
    c.eq("EXPIRED rows", rows.length, 1);
    c.eq("EXPIRED is a debit", rows[0]?.points, -200);
    c.ok("sourceTxnId anchors the earn", Boolean(rows[0]?.sourceTxnId));
    // A daily cron re-runs this; a second pass must add nothing.
    await runExpirySweep();
    c.eq("EXPIRED rows after re-run", (await ledger(u, "EXPIRED")).length, 1);
    c.eq("balance after re-run", await balanceOf(u), 0);
  });

  await run("expire: partially-spent earn expires only what is left", async (c) => {
    await cfg();
    const u = await mkUser(c);
    const b = await mkBooking(u, { total: 2000, paid: 2000 });
    await awardBookingPoints(b); // +200
    await backdate(u);
    const spend = await mkBooking(u, { total: 5000, paid: 5000 });
    await redeemForBooking({
      userId: u,
      bookingId: spend,
      points: 150,
      billPaise: 5000 * 100,
    });
    c.eq("balance before sweep", await balanceOf(u), 50);
    await expireEarns(u);
    await runExpirySweep();
    // Expiring the full 200-point lot would double-count the 150 the
    // customer already spent and push the balance to -150.
    const rows = await ledger(u, "EXPIRED");
    c.eq("EXPIRED rows", rows.length, 1);
    c.eq("EXPIRED points", rows[0]?.points, -50);
    c.eq("balance", await balanceOf(u), 0);
  });

  await run("expire: fully-drained earn writes a zero-point tombstone, not a debit", async (c) => {
    await cfg();
    const u = await mkUser(c);
    const b = await mkBooking(u, { total: 2000, paid: 2000 });
    await awardBookingPoints(b);
    await backdate(u);
    const spend = await mkBooking(u, { total: 5000, paid: 5000 });
    await redeemForBooking({
      userId: u,
      bookingId: spend,
      points: 200,
      billPaise: 5000 * 100,
    });
    c.eq("balance drained", await balanceOf(u), 0);
    await expireEarns(u);
    await runExpirySweep();
    const rows = await ledger(u, "EXPIRED");
    c.eq("EXPIRED rows", rows.length, 1);
    c.eq("tombstone carries 0 points", rows[0]?.points, 0);
    c.eq("balance", await balanceOf(u), 0);
    // Without the tombstone the sweep would re-select this earn on
    // every nightly run, forever.
    await runExpirySweep();
    c.eq("EXPIRED rows after re-run", (await ledger(u, "EXPIRED")).length, 1);
  });

  await run("expire: pointExpiryMonths = 0 means never expires", async (c) => {
    await cfg({ pointExpiryMonths: 0 });
    const u = await mkUser(c);
    const b = await mkBooking(u, { total: 2000, paid: 2000 });
    await awardBookingPoints(b);
    const rows = await ledger(u, "EARNED_BOOKING");
    // The sentinel must collapse to NULL, not to "expires right now".
    c.eq("expiresAt", rows[0]?.expiresAt, null);
    await runExpirySweep();
    c.eq("EXPIRED rows", (await ledger(u, "EXPIRED")).length, 0);
    c.eq("balance", await balanceOf(u), 200);
  });
}

// ---------------------------------------------------------------
// Cross-cutting
// ---------------------------------------------------------------

async function ledgerShapeCases(): Promise<void> {
  await run("ledger: a full earn → redeem → revoke lifecycle stays reconciled", async (c) => {
    await cfg();
    const u = await mkUser(c);
    const b1 = await mkBooking(u, { total: 3000, paid: 3000 });
    await awardBookingPoints(b1); // +300
    const o1 = await mkCafeOrder(u, { paid: 800 });
    await awardCafePoints(o1); // +80
    await adminGrantPoints({
      userId: u,
      points: 120,
      actorAdminId: ADMIN_ID ?? TAG,
      reason: "harness",
    }); // +120  → 500
    await backdate(u);
    const b2 = await mkBooking(u, { total: 4000, paid: 4000 });
    await redeemForBooking({ userId: u, bookingId: b2, points: 250, billPaise: 4000 * 100 });
    await awardBookingPoints(b2); // +400 → 650
    await revokeBookingRewards(b1); // -300, refund nothing → 350
    c.eq("balance", await balanceOf(u), 350);
    const bal = await db.rewardBalance.findUnique({ where: { userId: u } });
    // Lifetime accumulators are separate columns and can drift
    // independently of pointsAvailable — check them explicitly.
    c.eq("lifetimeEarned", bal?.pointsLifetimeEarned, 900); // 300+80+120+400
    c.eq("lifetimeRedeemed", bal?.pointsLifetimeRedeemed, 250);
    c.eq("lifetimeRevoked", bal?.pointsLifetimeRevoked, 300);
    c.eq("lifetimeExpired", bal?.pointsLifetimeExpired, 0);
    c.eq(
      "earned - redeemed - revoked - expired == available",
      (bal?.pointsLifetimeEarned ?? 0) -
        (bal?.pointsLifetimeRedeemed ?? 0) -
        (bal?.pointsLifetimeRevoked ?? 0) -
        (bal?.pointsLifetimeExpired ?? 0),
      350,
    );
  });

  await run("ledger: every debit row carries a NEGATIVE points value", async (c) => {
    await cfg();
    const u = await mkUser(c);
    await seedPoints(u, 500);
    const b = await mkBooking(u, { total: 5000, paid: 5000 });
    await redeemForBooking({ userId: u, bookingId: b, points: 100, billPaise: 5000 * 100 });
    await revokeBookingRewards(b);
    const rows = await ledger(u);
    for (const r of rows) {
      const isDebit = ["REDEEMED_BOOKING", "REDEEMED_CAFE", "REVOKED", "ADJUSTMENT_DEBIT"].includes(
        r.type,
      );
      if (isDebit) {
        c.ok(`${r.type} points < 0`, r.points < 0, `got ${r.points}`);
        c.ok(`${r.type} valuePaise <= 0`, r.pointsValuePaise <= 0, `got ${r.pointsValuePaise}`);
      } else if (r.type !== "EXPIRED") {
        c.ok(`${r.type} points > 0`, r.points > 0, `got ${r.points}`);
      }
    }
  });
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------

async function bootstrap(): Promise<void> {
  const court = await db.courtConfig.findUnique({ where: { id: COURT_ID } });
  if (court) {
    COURT_SPORT = court.sport;
  } else {
    const fallback = await db.courtConfig.findFirst({ where: { isActive: true } });
    if (!fallback) throw new Error("No CourtConfig rows — cannot build bookings.");
    COURT_ID = fallback.id;
    COURT_SPORT = fallback.sport;
    console.log(
      `  VERIFY_COURT_CONFIG_ID "${COURT_ENV}" not found — using ${COURT_ID} (${COURT_SPORT}).`,
    );
  }
  const admin = await db.adminUser.findFirst({ select: { id: true } });
  ADMIN_ID = admin?.id ?? null;
  ORIGINAL_CONFIG = await db.rewardConfig.upsert({
    where: { id: "singleton" },
    create: { id: "singleton" },
    update: {},
  });
  console.log(
    `  court=${COURT_ID} (${COURT_SPORT})  admin=${ADMIN_ID ?? "none"}  cafeItem=${CAFE_ITEM_ENV || "none"}`,
  );
  console.log(
    "  RewardConfig snapshotted; the harness will overwrite and restore it.\n",
  );
}

async function main(): Promise<void> {
  console.log("Rewards engine invariant harness");
  console.log("  central invariant: RewardBalance.pointsAvailable === SUM(RewardTransaction.points)");
  console.log("  cases marked [suspect] assert intended behaviour and are expected to fail today\n");
  await bootstrap();
  await earnCases();
  await bonusCases();
  await redeemCases();
  await revokeCases();
  await expiryCases();
  await ledgerShapeCases();
  console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
  if (fail > 0) process.exitCode = 1;
}

// A voided push-notification promise inside the engine can reject
// after its case has finished; log it rather than tearing the run down.
process.on("unhandledRejection", (e) => {
  console.warn(`      ! unhandled rejection (ignored): ${msg(e)}`);
});

let interrupted = false;
process.on("SIGINT", () => {
  if (interrupted) process.exit(130);
  interrupted = true;
  console.log("\nSIGINT — restoring config and sweeping leftovers…");
  void (async () => {
    await cleanup([...CREATED]).catch(() => {});
    await restoreConfig().catch(() => {});
    process.exit(130);
  })();
});

main()
  .catch((e) => {
    console.error("FATAL", msg(e));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (CREATED.size > 0) {
      console.log(`\nSweeping ${CREATED.size} leftover user(s)…`);
      await cleanup([...CREATED]);
    }
    await restoreConfig().catch((e) =>
      console.error("!! FAILED TO RESTORE RewardConfig — re-run the script:", msg(e)),
    );
    await db.$disconnect();
  });
