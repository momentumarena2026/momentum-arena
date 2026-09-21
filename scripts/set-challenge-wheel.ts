/**
 * Read — and optionally set — the prize wheel and the average band that
 * guards it.
 *
 * The venue's rule, stated plainly: a discounted hour must still bring in at
 * least ₹1,800 of a ₹2,000 court ON AVERAGE. That is an average discount of
 * 10% or less. Two settings have to agree for that to hold:
 *
 *   spinSegments   the prizes and their weights — what the wheel gives away
 *   spinAvgMinPct  \ the band the wheel's average must fall inside, checked
 *   spinAvgMaxPct  / by `wheelRefusal` every time anyone saves the wheel
 *
 * Setting the segments alone is not enough. The band is what stops the next
 * person widening the wheel back past the rule — and if the band still says
 * 15–25 while the wheel averages 9, the admin screen refuses to save any
 * edit at all, because the wheel it is being asked to keep is outside the
 * range it is being asked to enforce.
 *
 * Prints the average in rupees, not just percent, because "17.75%" does not
 * read as "you are giving away ₹355 an hour" until somebody does the sum.
 *
 * SEGMENTS    JSON array of {pct, weight}, or unset to leave the wheel alone.
 * AVG_MIN     integer percent, or unset.
 * AVG_MAX     integer percent, or unset.
 * SPINS_CAP   spins allowed per poster (0 = no cap), or unset.
 * SPINS_DAYS  the rolling window in days (0 = lifetime), or unset.
 * COURT       the court price used for the rupee illustration (default 2000).
 *
 * On the cap: every spin follows a SALE. A captain only earns one when a
 * match they posted becomes a paid, confirmed booking, so spins cannot be
 * farmed — the cap is not an anti-abuse control, it bounds how much discount
 * any single customer can accumulate. That is why a rolling window beats a
 * lifetime cap: a lifetime cap permanently stops rewarding your best
 * customers, which is the opposite of what the wheel is for.
 */

import { db } from "../lib/db";
import { resolveWheel, wheelAveragePct, wheelRefusal } from "../lib/challenge-rules";

const SINGLETON = "singleton";

type Seg = { pct: number; weight: number };

function money(n: number): string {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

/** What this wheel costs, expressed the way the venue thinks about it. */
function describe(segs: Seg[], court: number, label: string) {
  const avg = wheelAveragePct(segs);
  const live = segs.filter((s) => s.weight > 0);
  const total = live.reduce((t, s) => t + s.weight, 0) || 1;
  const sd = Math.sqrt(
    live.reduce((t, s) => t + s.weight * (s.pct - avg) ** 2, 0) / total,
  );

  console.log("");
  console.log(`${label}`);
  for (const s of [...live].sort((a, b) => a.pct - b.pct)) {
    const chance = s.weight / total;
    console.log(
      `   ${String(s.pct).padStart(3)}% off  weight ${String(s.weight).padStart(3)}` +
        `   ${(chance * 100).toFixed(1).padStart(5)}% of spins` +
        `   about 1 in ${Math.max(1, Math.round(1 / chance))}` +
        `   −${money((court * s.pct) / 100)}`,
    );
  }
  console.log(
    `   average discount ${avg.toFixed(2)}%  →  you keep ${money((court * (100 - avg)) / 100)} of ${money(court)} per hour`,
  );
  console.log(
    `   over 10 spins    ${money(court * 10 * (1 - avg / 100))} of ${money(court * 10)}`,
  );
  console.log(`   spread (1 sd)    ${sd.toFixed(1)} percentage points`);
  return avg;
}

function parseSegments(raw: string): Seg[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("SEGMENTS must be a non-empty JSON array");
  }
  return parsed.map((s) => {
    const seg = s as { pct?: unknown; weight?: unknown };
    if (!Number.isInteger(seg.pct) || !Number.isFinite(Number(seg.weight))) {
      throw new Error(`each segment needs an integer pct and a numeric weight — got ${JSON.stringify(s)}`);
    }
    return { pct: Number(seg.pct), weight: Number(seg.weight) };
  });
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/?]+)/)?.[1] ?? "unknown";
  const court = Number(process.env.COURT ?? 2000) || 2000;
  console.log(`database host: ${host}`);
  console.log(`illustrating against a ${money(court)} court`);

  const before = await db.challengeSettings.upsert({
    where: { id: SINGLETON },
    update: {},
    create: { id: SINGLETON },
  });

  const currentSegs = resolveWheel(before.spinSegments);
  const usingBuiltIn = !Array.isArray(before.spinSegments) || before.spinSegments.length === 0;
  describe(
    currentSegs,
    court,
    `BEFORE — ${usingBuiltIn ? "the BUILT-IN wheel (no custom segments saved)" : "the venue's saved wheel"}`,
  );
  console.log("");
  console.log(`   average band enforced on save: ${before.spinAvgMinPct}% – ${before.spinAvgMaxPct}%`);
  console.log(`   prize wheel running: ${before.spinEnabled}`);
  console.log(
    `   spins per poster: ${before.spinsPerPosterCap || "no cap"}` +
      (before.spinsPerPosterPerDays ? ` per ${before.spinsPerPosterPerDays} day(s)` : ""),
  );

  const wantSegs = process.env.SEGMENTS?.trim() ? parseSegments(process.env.SEGMENTS) : null;
  const wantMin = process.env.AVG_MIN?.trim() ? Number(process.env.AVG_MIN) : null;
  const wantMax = process.env.AVG_MAX?.trim() ? Number(process.env.AVG_MAX) : null;
  const wantCap = process.env.SPINS_CAP?.trim() ? Number(process.env.SPINS_CAP) : null;
  const wantDays = process.env.SPINS_DAYS?.trim() ? Number(process.env.SPINS_DAYS) : null;

  for (const [name, v] of [["SPINS_CAP", wantCap], ["SPINS_DAYS", wantDays]] as const) {
    if (v !== null && (!Number.isInteger(v) || v < 0)) {
      throw new Error(`${name} must be a whole number of 0 or more — got "${v}"`);
    }
  }

  if (!wantSegs && wantMin === null && wantMax === null && wantCap === null && wantDays === null) {
    console.log("");
    console.log("Read only — pass SEGMENTS and/or AVG_MIN/AVG_MAX to change anything.");
    await db.$disconnect();
    return;
  }

  const nextSegs = wantSegs ?? currentSegs;
  const nextMin = wantMin ?? before.spinAvgMinPct;
  const nextMax = wantMax ?? before.spinAvgMaxPct;

  // The SAME validator the admin screen uses, run before writing rather than
  // after — so a wheel this script would save is a wheel the venue can still
  // edit afterwards, instead of one that wedges their own settings page.
  const refusal = wheelRefusal(nextSegs, nextMin, nextMax);
  if (refusal) {
    console.error("");
    console.error(`REFUSED: ${refusal}`);
    console.error("Nothing written.");
    await db.$disconnect();
    process.exit(1);
  }

  const after = await db.challengeSettings.update({
    where: { id: SINGLETON },
    data: {
      ...(wantSegs ? { spinSegments: nextSegs as never } : {}),
      ...(wantMin !== null ? { spinAvgMinPct: nextMin } : {}),
      ...(wantMax !== null ? { spinAvgMaxPct: nextMax } : {}),
      ...(wantCap !== null ? { spinsPerPosterCap: wantCap } : {}),
      ...(wantDays !== null ? { spinsPerPosterPerDays: wantDays } : {}),
    },
    select: {
      spinSegments: true,
      spinAvgMinPct: true,
      spinAvgMaxPct: true,
      spinsPerPosterCap: true,
      spinsPerPosterPerDays: true,
      updatedAt: true,
    },
  });

  const avgAfter = describe(resolveWheel(after.spinSegments), court, "AFTER");
  console.log("");
  console.log(`   average band enforced on save: ${after.spinAvgMinPct}% – ${after.spinAvgMaxPct}%`);
  const cap = after.spinsPerPosterCap;
  const days = after.spinsPerPosterPerDays;
  console.log(
    `   spins per poster: ` +
      (cap > 0
        ? days > 0
          ? `${cap} in any ${days} day(s) — worst case ${money((court * avgAfter) / 100 * cap)} of discount per customer per ${days} days`
          : `${cap} ever`
        : "no cap"),
  );
  console.log(`   updated at: ${after.updatedAt.toISOString()}`);
  console.log("");
  console.log(
    avgAfter <= 10
      ? `✓ Average discount is ${avgAfter.toFixed(2)}% — a ${money(court)} hour still brings in ${money((court * (100 - avgAfter)) / 100)}.`
      : `⚠ Average discount is ${avgAfter.toFixed(2)}% — ABOVE the 10% the venue asked for.`,
  );

  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect().catch(() => undefined);
  process.exit(1);
});
