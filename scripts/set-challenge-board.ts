/**
 * Turn the Challenges board (and, separately, the prize wheel) on or off.
 *
 * The board ships OFF — `ChallengeSettings.enabled` defaults to false and
 * gates posting, accepting, countering and the payment quote — so switching
 * it on is the moment the feature starts carrying customers' money. That is a
 * business decision, and this exists so it can be made deliberately, from a
 * dispatch with a name against it, rather than by hand on a console.
 *
 * Normally the venue does this itself with the master switch on
 * /admin/challenges. This script is the same change by another door, for when
 * somebody needs it done without an admin session.
 *
 * Reads before it writes and prints both, because a toggle that does not tell
 * you what it changed is a toggle nobody can audit. Writes nothing when the
 * value is already what was asked for.
 *
 * ENABLED / SPIN_ENABLED / ANNOUNCE: "true", "false", or unset to leave that
 * one alone.
 * AUDIENCE:  ALL | SPORT | RECENT, or unset.
 * DAILY_CAP: announcements per day, or unset.
 * PAYMENT_WINDOW: minutes a payment slot is held for whoever opened it.
 *
 * On PAYMENT_WINDOW: this is also how long an ABANDONED sheet blocks a
 * match, and for that whole time every other captain who taps Pay is told
 * somebody else is paying. What it protects is a UPI collect still
 * resolving at the bank, which is minutes. Long values are expensive.
 *
 * On AUDIENCE specifically: changing the column's DEFAULT in the schema does
 * NOT move a row that already exists, and production's settings row has
 * existed since the board shipped. A venue that wants the widest audience has
 * to be moved there explicitly — this is that door.
 */

import { db } from "../lib/db";

const SINGLETON = "singleton";

function wanted(name: string): boolean | null {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (raw === "" || raw === "unchanged") return null;
  if (raw === "true" || raw === "on" || raw === "yes") return true;
  if (raw === "false" || raw === "off" || raw === "no") return false;
  throw new Error(`${name} must be true, false, or unset — got "${raw}"`);
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/?]+)/)?.[1] ?? "unknown";
  console.log(`database host: ${host}`);

  const board = wanted("ENABLED");
  const spin = wanted("SPIN_ENABLED");
  const announce = wanted("ANNOUNCE");

  const audienceRaw = (process.env.AUDIENCE ?? "").trim().toUpperCase();
  if (audienceRaw && !["ALL", "SPORT", "RECENT"].includes(audienceRaw)) {
    throw new Error(`AUDIENCE must be ALL, SPORT or RECENT — got "${audienceRaw}"`);
  }
  const audience = audienceRaw || null;

  const capRaw = (process.env.DAILY_CAP ?? "").trim();
  const cap = capRaw === "" ? null : Number(capRaw);
  if (cap !== null && (!Number.isInteger(cap) || cap < 0 || cap > 50)) {
    throw new Error(`DAILY_CAP must be a whole number 0–50 — got "${capRaw}"`);
  }

  const payWinRaw = (process.env.PAYMENT_WINDOW ?? "").trim();
  const payWin = payWinRaw === "" ? null : Number(payWinRaw);
  // The SAME bounds the admin screen enforces (`num(..., 5, 1440, ...)`), so
  // this door cannot set a value the venue's own settings page would refuse.
  if (payWin !== null && (!Number.isInteger(payWin) || payWin < 5 || payWin > 1440)) {
    throw new Error(`PAYMENT_WINDOW must be a whole number 5–1440 — got "${payWinRaw}"`);
  }

  if (
    board === null &&
    spin === null &&
    announce === null &&
    !audience &&
    cap === null &&
    payWin === null
  ) {
    console.log("Nothing asked for — reading only.");
  }

  // Upsert with defaults, exactly as the app does, so a database that has
  // never had a settings row reads as OFF rather than erroring.
  const before = await db.challengeSettings.upsert({
    where: { id: SINGLETON },
    update: {},
    create: { id: SINGLETON },
  });

  console.log("");
  console.log("BEFORE");
  console.log(`  board enabled : ${before.enabled}`);
  console.log(`  prize wheel   : ${before.spinEnabled}`);
  console.log(`  sports        : ${before.sports.length ? before.sports.join(", ") : "(all)"}`);
  console.log(`  advance %     : ${before.advancePct}`);
  console.log(`  notice mins   : ${before.minLeadMins}`);
  console.log(`  payment window: ${before.paymentWindowMins} mins`);
  console.log(`  announce posts: ${before.postedPushEnabled}`);
  console.log(`  audience      : ${before.pushAudience}`);
  console.log(`  per-day cap   : ${before.pushDailyCap}`);

  const data: {
    enabled?: boolean;
    spinEnabled?: boolean;
    postedPushEnabled?: boolean;
    pushAudience?: string;
    pushDailyCap?: number;
    paymentWindowMins?: number;
  } = {};
  if (board !== null && board !== before.enabled) data.enabled = board;
  if (spin !== null && spin !== before.spinEnabled) data.spinEnabled = spin;
  if (announce !== null && announce !== before.postedPushEnabled) data.postedPushEnabled = announce;
  if (audience && audience !== before.pushAudience) data.pushAudience = audience;
  if (cap !== null && cap !== before.pushDailyCap) data.pushDailyCap = cap;
  if (payWin !== null && payWin !== before.paymentWindowMins) {
    data.paymentWindowMins = payWin;
  }

  if (Object.keys(data).length === 0) {
    console.log("");
    console.log("No change needed — already in the requested state.");
    await db.$disconnect();
    return;
  }

  const after = await db.challengeSettings.update({
    where: { id: SINGLETON },
    data,
    select: {
      enabled: true,
      spinEnabled: true,
      postedPushEnabled: true,
      pushAudience: true,
      pushDailyCap: true,
      paymentWindowMins: true,
      updatedAt: true,
    },
  });

  const mark = (changed: boolean) => (changed ? "   <-- changed" : "");
  console.log("");
  console.log("AFTER");
  console.log(`  board enabled : ${after.enabled}${mark(data.enabled !== undefined)}`);
  console.log(`  prize wheel   : ${after.spinEnabled}${mark(data.spinEnabled !== undefined)}`);
  console.log(`  announce posts: ${after.postedPushEnabled}${mark(data.postedPushEnabled !== undefined)}`);
  console.log(`  audience      : ${after.pushAudience}${mark(data.pushAudience !== undefined)}`);
  console.log(`  per-day cap   : ${after.pushDailyCap}${mark(data.pushDailyCap !== undefined)}`);
  console.log(
    `  payment window: ${after.paymentWindowMins} mins${mark(data.paymentWindowMins !== undefined)}`,
  );
  console.log(`  updated at    : ${after.updatedAt.toISOString()}`);

  if (data.paymentWindowMins !== undefined) {
    console.log("");
    console.log(
      `An abandoned payment sheet now blocks a match for ${after.paymentWindowMins} minutes, not ${before.paymentWindowMins}.`,
    );
    console.log(
      "Holds already running keep their ORIGINAL deadline — the check is",
    );
    console.log(
      "createdAt + window, read live, so a slot opened before this change",
    );
    console.log("re-measures against the new number on the next attempt.");
  }

  if (after.postedPushEnabled && after.enabled) {
    const who =
      after.pushAudience === "ALL"
        ? "EVERY phone signed in to the app"
        : after.pushAudience === "SPORT"
          ? "people who have played that sport"
          : "people who booked recently";
    console.log("");
    console.log(`Announcements are ON: up to ${after.pushDailyCap} a day, to ${who}.`);
    console.log("They go out on the per-minute sweep, about a minute after a post.");
  }

  if (after.enabled) {
    console.log("");
    console.log("The board is LIVE. Customers can post, take and pay from the app.");
    console.log("To close it again, run this with ENABLED=false, or use the master");
    console.log("switch on /admin/challenges.");
  }

  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect().catch(() => undefined);
  process.exit(1);
});
