import { PrismaClient }/**
 * Pass-coverage invariant harness.
 *
 * Run against a NON-PRODUCTION database:
 *   DATABASE_URL='<staging url>' npx tsx scripts/verify-pass-coverage.ts
 *
 * Every case builds a real booking + pass, runs syncPassAfterAdminEdit,
 * asserts the resulting coverage, then ROLLS BACK — nothing is left
 * behind. `expectCovered: -1` means "the edit must be refused".
 *
 * These scenarios are the ones that actually broke in production-shaped
 * code across four fix rounds: a slot swap billing a fully-covered
 * customer, a court/date move letting the pass absorb a price change or
 * stranding a bill, equipment being written off as pass-settled, and a
 * removal crediting minutes that were never covered. Coverage is now
 * recorded per slot on PassRedemption.coveredSlots rather than
 * reconstructed, which is what makes these pass — if someone reverts to
 * deriving it, these fail.
 */
 from "@prisma/client";
import { syncPassAfterAdminEdit, shouldCoverDelta } from "../lib/passes";
const db = new PrismaClient();
// Any active 60-min court works; override for another environment.
const COURT = process.env.VERIFY_COURT_CONFIG_ID ?? "cmn5rkkgs000e21074z2nj0wd";
const RB = "ROLLBACK";
const DATE = new Date("2026-08-05T00:00:00Z");
const S = (h: number, isNew = false, price = 800) => ({
  startHour: h, startMinute: 0, durationMinutes: 60, price, isNew,
});
let pass = 0, fail = 0;

type SyncArgs = Omit<
  Parameters<typeof syncPassAfterAdminEdit>[1],
  "bookingId" | "bookingUserId" | "bookingDate" | "courtConfigId" | "newTotalAmount" | "paymentAmount" | "equipmentAmount"
>;

async function run(
  name: string,
  expectCovered: number,
  newTotal: number,
  payAmt: number,
  args: SyncArgs,
  opts: { equip?: number; balance?: number; coveredHours?: number[] } = {},
) {
  try {
    await db.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { phone: `+9199${Math.floor(Math.random()*9e7+1e7)}`, name: "T" } });
      const p = await tx.userPass.create({ data: {
        userId: u.id, name: "TEST 3h", sport: "PICKLEBALL", courtConfigId: COURT,
        totalMinutes: 180 + (opts.balance ?? 0), remainingMinutes: opts.balance ?? 0, price: 2400, validityDays: 30,
        startsAt: new Date("2026-01-01"), expiresAt: new Date("2027-01-01"), bands: [], status: "ACTIVE" } });
      const b = await tx.booking.create({ data: {
        userId: u.id, courtConfigId: COURT, date: DATE, status: "CONFIRMED",
        totalAmount: 2400, discountAmount: 0,
        slots: { create: [18,19,20].map((h) => ({ startHour: h, startMinute: 0, durationMinutes: 60, price: 800 })) },
        payment: { create: { amount: 0, method: "PASS", status: "COMPLETED", confirmedBy: "PASS" } } } });
      await tx.passRedemption.create({ data: {
        userPassId: p.id, bookingId: b.id,
        minutes: (opts.coveredHours ?? [18, 19, 20]).length * 60,
        value: 2400, coveredAmount: 2400,
        coveredSlots: (opts.coveredHours ?? [18, 19, 20]).map((h) => ({ h, m: 0, min: 60 })) } });
      // Route the request through the SAME gate the server actions use.
      // Passing coverDeltaWithPass straight into the sync is what let a
      // broken gate ship: the sync handled swaps correctly while both
      // editors silently stripped the flag on a net-zero edit.
      const out = await syncPassAfterAdminEdit(tx, {
        bookingId: b.id, bookingUserId: u.id, bookingDate: DATE, courtConfigId: COURT,
        newTotalAmount: newTotal, paymentAmount: payAmt, equipmentAmount: opts.equip ?? 0,
        ...args,
        coverDeltaWithPass: shouldCoverDelta(args.coverDeltaWithPass, args.newSlots),
      });
      const red = await tx.passRedemption.findUnique({ where: { bookingId: b.id } });
      const up = await tx.userPass.findUnique({ where: { id: p.id } });
      const covered = out.ok ? out.coveredAmount : -1;
      const owed = newTotal - payAmt - (red?.restoredAt ? 0 : red?.coveredAmount ?? 0);
      const ok = expectCovered === -1 ? !out.ok : out.ok && covered === expectCovered;
      console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
      console.log(`      covered=${covered} (want ${expectCovered})  owed=${owed}  redMin=${red?.minutes}  passRemaining=${up?.remainingMinutes}${out.ok ? "" : "  err=" + out.error}`);
      if (ok) pass++;
      else fail++;
      throw new Error(RB);
    }, { timeout: 30000, maxWait: 15000 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg !== RB) {
      console.log(`FAIL  ${name}\n      threw: ${msg}`);
      fail++;
    }
  }
}

/**
 * Bowling: two 30-min slots share ONE hour (:00 and :30). Coverage is
 * keyed by hour AND minute, so dropping 10:30 must leave 10:00 covered
 * — an hour-only key would drop both and refund twice the time.
 */
async function bowling() {
  const BOWL = "bowling_machine_court";
  const date = new Date("2026-08-06T00:00:00Z");
  const rows = [
    { startHour: 10, startMinute: 0, durationMinutes: 30, price: 300, isNew: false },
    { startHour: 10, startMinute: 30, durationMinutes: 30, price: 300, isNew: false },
  ];
  try {
    await db.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { phone: `+9199${Math.floor(Math.random()*9e7+1e7)}`, name: "T" } });
      const p = await tx.userPass.create({ data: {
        userId: u.id, name: "Bowl 1h", sport: "CRICKET", courtConfigId: BOWL,
        totalMinutes: 60, remainingMinutes: 0, price: 600, validityDays: 30,
        startsAt: new Date("2026-01-01"), expiresAt: new Date("2027-01-01"), bands: [], status: "ACTIVE" } });
      const b = await tx.booking.create({ data: {
        userId: u.id, courtConfigId: BOWL, date, status: "CONFIRMED", totalAmount: 600, discountAmount: 0,
        slots: { create: rows.map(({ isNew: _isNew, ...r }) => r) },
        payment: { create: { amount: 0, method: "PASS", status: "COMPLETED", confirmedBy: "PASS" } } } });
      await tx.passRedemption.create({ data: {
        userPassId: p.id, bookingId: b.id, minutes: 60, value: 600, coveredAmount: 600,
        coveredSlots: [{ h: 10, m: 0, min: 30 }, { h: 10, m: 30, min: 30 }] } });
      // Drop only the :30 half.
      const out = await syncPassAfterAdminEdit(tx, {
        bookingId: b.id, bookingUserId: u.id, bookingDate: date, courtConfigId: BOWL,
        newTotalAmount: 300, paymentAmount: 0, equipmentAmount: 0, newSlots: [rows[0]] });
      const red = await tx.passRedemption.findUnique({ where: { bookingId: b.id } });
      const up = await tx.userPass.findUnique({ where: { id: p.id } });
      const ok = out.ok && red?.coveredAmount === 300 && red?.minutes === 30 && up?.remainingMinutes === 30;
      console.log(`${ok ? "PASS" : "FAIL"}  bowling: drop 10:30 keeps 10:00 [covered 300, 30min back]`);
      console.log(`      covered=${red?.coveredAmount} redMin=${red?.minutes} passRemaining=${up?.remainingMinutes}`);
      if (ok) pass++;
      else fail++;
      throw new Error(RB);
    }, { timeout: 30000, maxWait: 15000 });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m !== RB) { console.log(`FAIL  bowling\n      threw: ${m}`); fail++; }
  }
}

/**
 * A LEGACY redemption (written before coveredSlots existed) records
 * only a minute count. The first edit must adopt the slots the pass
 * most likely paid for — priciest-first, the rule checkout used — and
 * must never adopt MORE minutes than were recorded.
 */
async function legacyAdoption() {
  const date = new Date("2026-08-07T00:00:00Z");
  // Top-up booking: pass covered 120 of 180 min; customer paid for the
  // cheapest hour. Rows are deliberately cheap-first in array order, so
  // an hour-ordered adoption would grab the wrong two.
  const rows = [
    { startHour: 18, startMinute: 0, durationMinutes: 60, price: 600, isNew: false },
    { startHour: 19, startMinute: 0, durationMinutes: 60, price: 800, isNew: false },
    { startHour: 20, startMinute: 0, durationMinutes: 60, price: 800, isNew: false },
  ];
  try {
    await db.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { phone: `+9199${Math.floor(Math.random()*9e7+1e7)}`, name: "T" } });
      const p = await tx.userPass.create({ data: {
        userId: u.id, name: "Legacy 2h", sport: "PICKLEBALL", courtConfigId: COURT,
        totalMinutes: 120, remainingMinutes: 0, price: 1600, validityDays: 30,
        startsAt: new Date("2026-01-01"), expiresAt: new Date("2027-01-01"), bands: [], status: "ACTIVE" } });
      const b = await tx.booking.create({ data: {
        userId: u.id, courtConfigId: COURT, date, status: "CONFIRMED", totalAmount: 2200, discountAmount: 0,
        slots: { create: rows.map(({ isNew: _i, ...r }) => r) },
        payment: { create: { amount: 600, method: "RAZORPAY", status: "COMPLETED", confirmedBy: "PASS_TOPUP" } } } });
      await tx.passRedemption.create({ data: {
        userPassId: p.id, bookingId: b.id, minutes: 120, value: 1600, coveredAmount: 1600,
        coveredSlots: undefined } }); // legacy: no per-slot record
      const out = await syncPassAfterAdminEdit(tx, {
        bookingId: b.id, bookingUserId: u.id, bookingDate: date, courtConfigId: COURT,
        newTotalAmount: 2200, paymentAmount: 600, equipmentAmount: 0,
        newSlots: rows });
      const red = await tx.passRedemption.findUnique({ where: { bookingId: b.id } });
      // Priciest-first adoption = 19 + 20 = 1600. Owed = 2200-600-1600 = 0.
      const ok = out.ok && red?.coveredAmount === 1600 && red?.minutes === 120;
      console.log(`${ok ? "PASS" : "FAIL"}  legacy row adopts priciest 2 of 3 [covered 1600, owed 0]`);
      console.log(`      covered=${red?.coveredAmount} redMin=${red?.minutes} owed=${2200 - 600 - (red?.coveredAmount ?? 0)}`);
      if (ok) pass++;
      else fail++;
      throw new Error(RB);
    }, { timeout: 30000, maxWait: 15000 });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m !== RB) { console.log(`FAIL  legacy adoption\n      threw: ${m}`); fail++; }
  }
}

async function main() {
  console.log("Booking: 18/19/20 @ 800 = 2400, fully pass-covered (180 min), payment 0\n");
  await run("swap 20->21, cover ticked  [stays fully covered, pass net 0]", 2400, 2400, 0,
    { newSlots: [S(18), S(19), S(21, true)], coverDeltaWithPass: true });
  await run("swap 20->21, NOT ticked    [21 uncovered -> owed 800, 60min back]", 1600, 2400, 0,
    { newSlots: [S(18), S(19), S(21, true)] });
  await run("add 21 uncovered           [owed 800]", 2400, 3200, 0,
    { newSlots: [S(18), S(19), S(20), S(21, true)] });
  await run("add 21 WITH cover (60 left)  [fully covered, owed 0]", 3200, 3200, 0,
    { newSlots: [S(18), S(19), S(20), S(21, true)], coverDeltaWithPass: true }, { balance: 60 });
  await run("add 21 WITH cover, 0 balance [must REFUSE]", -1, 3200, 0,
    { newSlots: [S(18), S(19), S(20), S(21, true)], coverDeltaWithPass: true });
  await run("gear 500 added             [covered 2400, owed 500]", 2400, 2900, 0,
    { newSlots: [S(18), S(19), S(20)] }, { equip: 500 });
  await run("remove 20                  [covered 1600, 60min back]", 1600, 1600, 0,
    { newSlots: [S(18), S(19)] });
  await run("date move, cheaper (600/hr)[fully covered, owed 0]", 1800, 1800, 0,
    { newSlots: [S(18,false,600), S(19,false,600), S(20,false,600)] });
  await run("date move, pricier (1000)  [fully covered, owed 0]", 3000, 3000, 0,
    { newSlots: [S(18,false,1000), S(19,false,1000), S(20,false,1000)] });
  await run("no-op re-save              [unchanged 2400]", 2400, 2400, 0,
    { newSlots: [S(18), S(19), S(20)] });
  // 50% off: slot rows still carry LIST prices (800 each) but the
  // customer owes 1200. A pass covering 2 of 3 hours settles its share
  // of the DISCOUNTED liability (800), not the rack rate (1600) —
  // otherwise the overstatement silently eats the next charge.
  await run("50% discount, 2 of 3 covered [covered 800, owed 400]", 800, 1200, 0,
    { newSlots: [S(18), S(19), S(20, true)] }, { coveredHours: [18, 19] });
  await bowling();
  await legacyAdoption();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}
main()
  .catch((e) => {
    console.error("FATAL", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
