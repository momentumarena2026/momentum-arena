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
 * ENABLED / SPIN_ENABLED: "true", "false", or unset to leave that one alone.
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
  if (board === null && spin === null) {
    console.log("Nothing asked for — pass ENABLED and/or SPIN_ENABLED. Reading only.");
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

  const data: { enabled?: boolean; spinEnabled?: boolean } = {};
  if (board !== null && board !== before.enabled) data.enabled = board;
  if (spin !== null && spin !== before.spinEnabled) data.spinEnabled = spin;

  if (Object.keys(data).length === 0) {
    console.log("");
    console.log("No change needed — already in the requested state.");
    await db.$disconnect();
    return;
  }

  const after = await db.challengeSettings.update({
    where: { id: SINGLETON },
    data,
    select: { enabled: true, spinEnabled: true, updatedAt: true },
  });

  console.log("");
  console.log("AFTER");
  console.log(`  board enabled : ${after.enabled}${data.enabled !== undefined ? "   <-- changed" : ""}`);
  console.log(`  prize wheel   : ${after.spinEnabled}${data.spinEnabled !== undefined ? "   <-- changed" : ""}`);
  console.log(`  updated at    : ${after.updatedAt.toISOString()}`);

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
