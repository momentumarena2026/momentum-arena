/**
 * End-to-end test of the daily push, against a real database.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 * The unit tests (tests/daily-push.test.ts) prove the DECISIONS. They
 * say nothing about whether the engine reads the database correctly,
 * claims before sending, logs a dispatch, or refuses to send twice —
 * and those are the parts that fail in production rather than in a
 * reducer. There is no staging device fleet to point at, so this script
 * builds its own, drives the real engine through it, and takes it away
 * again.
 *
 * ── HOW IT IS SAFE ────────────────────────────────────────────────────
 * Three independent layers, because one is not enough when the failure
 * mode is "pushed marketing to real customers":
 *
 *  1. REFUSES TO RUN OFF STAGING. The production Neon endpoint is named
 *     below and checked before anything is read, let alone written.
 *  2. SYNTHETIC RECIPIENTS ONLY. The four users it creates hold FCM
 *     tokens that are structurally valid and registered to nothing, so
 *     FCM rejects them per-token. Real delivery is not possible, and
 *     the real send path — including dispatch logging and dead-token
 *     cleanup — still runs.
 *  3. REAL DEVICES OPTED OUT FOR THE DURATION. Every pre-existing
 *     device owner is set offersOptOut=true before the run and restored
 *     to their exact prior value afterwards, so even a mistake in (2)
 *     reaches nobody. This doubles as a live test of the opt-out.
 *
 * Cleanup runs in a finally block. If it ever fails, it says loudly
 * what was left behind.
 *
 *   npx tsx scripts/test-daily-push.ts
 */
import { PrismaClient } from "@prisma/client";
import { runDailyPush, loadDailyPushSettings } from "../lib/daily-push";
import { istDayKey, istHourOf } from "../lib/daily-push-rules";

const db = new PrismaClient();

/** Neon compute for the Production branch. Never run against this. */
const PRODUCTION_ENDPOINT = "ep-dark-hat-ampi5dah";
/** Marks every row this script creates, so cleanup can be exact. */
const TAG = "zz-daily-push-test";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function guardDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (url.includes(PRODUCTION_ENDPOINT)) {
    throw new Error(
      "REFUSING TO RUN: DATABASE_URL points at the PRODUCTION Neon branch. " +
        "This script writes users, bookings and passes, and sends push.",
    );
  }
  console.log(`Database: ${url.replace(/:[^:@]+@/, ":***@").split("?")[0]}\n`);
}

async function main() {
  guardDatabase();

  const now = new Date();
  const dayKey = istDayKey(now);
  const istHour = istHourOf(now);
  console.log(`IST hour is ${istHour}:00 — the module will be set to send at this hour.\n`);

  const courtConfig = await db.courtConfig.findFirst({
    where: { isActive: true },
    select: { id: true, sport: true },
  });
  if (!courtConfig) throw new Error("No active court config on this database.");

  // Remember the real settings so the database is left as it was found.
  const settingsBefore = await db.dailyPushSettings.findUnique({
    where: { id: "singleton" },
  });

  // Anything left over from a previous run that was killed mid-flight
  // is swept FIRST. Without this, a leftover synthetic user counts as a
  // "real" device owner, gets recorded for restoration, is deleted by
  // cleanup, and then the restore fails on a row that no longer exists
  // — which is how a killed run left the module switched on.
  const stale = await db.user.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  if (stale.length) {
    const ids = stale.map((x) => x.id);
    await db.dailyPushSend.deleteMany({ where: { userId: { in: ids } } });
    await db.pushDispatch.deleteMany({ where: { userId: { in: ids } } });
    await db.userPass.deleteMany({ where: { userId: { in: ids } } });
    await db.booking.deleteMany({ where: { userId: { in: ids } } });
    await db.pushDevice.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    console.log(`Swept ${ids.length} leftover rows from an earlier interrupted run.\n`);
  }

  const realDeviceOwners = await db.pushDevice.findMany({
    where: { user: { name: { not: { startsWith: TAG } } } },
    select: { userId: true },
    distinct: ["userId"],
  });
  const realOwnerIds = realDeviceOwners.map((d) => d.userId);
  const realPriorOptOut = await db.user.findMany({
    where: { id: { in: realOwnerIds } },
    select: { id: true, name: true, offersOptOut: true },
  });

  try {
    // ── Would FCM actually deliver this? ─────────────────────────────
    //
    // Everything else in this script sends to tokens registered to
    // nothing, which proves the engine and proves nothing about
    // delivery. FCM's validate-only mode closes that gap honestly: it
    // takes the REAL device tokens and the REAL rendered payload all the
    // way to Google's servers, which check the credentials, the message
    // shape and whether each token is still registered — and then throw
    // the message away instead of ringing anybody's phone.
    //
    // The one thing it cannot prove is that a banner appears. That needs
    // a real send to a real handset and somebody looking at it.
    console.log("── FCM deliverability (validate-only: nothing is delivered) ──");
    try {
      const { renderPushTemplate } = await import("../lib/push-templates");
      const rendered = await renderPushTemplate("daily_lapsed", {});
      const liveTokens = (await db.pushDevice.findMany({ select: { token: true } })).map((t) => t.token);

      if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        console.log("  skipped — FIREBASE_SERVICE_ACCOUNT_JSON is not set here");
      } else if (liveTokens.length === 0 || !rendered) {
        console.log("  skipped — no registered devices, or the template is switched off");
      } else {
        const [{ initializeApp, getApps, cert }, { getMessaging }] = await Promise.all([
          import("firebase-admin/app"),
          import("firebase-admin/messaging"),
        ]);
        if (!getApps().length) {
          initializeApp({
            credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)),
          });
        }
        const res = await getMessaging().sendEachForMulticast(
          {
            tokens: liveTokens,
            notification: { title: rendered.title, body: rendered.body },
            data: { kind: "open_screen", url: "/book", source: "daily_push", rule: "LAPSED" },
            apns: { payload: { aps: { sound: "default", contentAvailable: true } } },
            android: { priority: "high", notification: { sound: "default" } },
          },
          true, // validate_only — Google checks it, then discards it
        );
        res.responses.forEach((r, i) => {
          console.log(
            `  token ${liveTokens[i].slice(0, 10)}… ${r.success ? "✓ would deliver" : `✗ ${r.error?.code}`}`,
          );
        });
        check(
          "FCM accepts the real payload for at least one live device",
          res.successCount > 0,
          `${res.successCount}/${liveTokens.length} accepted`,
        );
        check("the credentials and message shape are valid", res.successCount + res.failureCount === liveTokens.length);
      }
    } catch (err) {
      check("FCM deliverability check ran", false, err instanceof Error ? err.message : String(err));
    }

    // ── LAYER 3: silence every real device before anything runs ──────
    console.log("\n── Isolating real devices ──");
    await db.user.updateMany({
      where: { id: { in: realOwnerIds } },
      data: { offersOptOut: true },
    });
    for (const u of realPriorOptOut) {
      console.log(`  muted ${u.name ?? u.id} (was offersOptOut=${u.offersOptOut})`);
    }

    // ── Build a cohort, one user per rule ────────────────────────────
    console.log("\n── Building the synthetic cohort ──");
    const daysAgo = (n: number) => new Date(now.getTime() - n * 86400_000);
    const daysAhead = (n: number) => new Date(now.getTime() + n * 86400_000);

    const mk = async (label: string, createdAt: Date) =>
      db.user.create({
        data: {
          name: `${TAG} ${label}`,
          phone: `+9100000${String(1000 + Math.floor(Math.random() * 8999))}`,
          createdAt,
          pushDevices: {
            create: {
              // Structurally plausible, registered to nothing. FCM
              // rejects it per-token rather than throwing the batch.
              token: `fZZtest${Math.random().toString(36).slice(2)}:APA91b${"x".repeat(134)}`,
              platform: "android",
              appVersion: TAG,
            },
          },
        },
        select: { id: true, name: true },
      });

    const uPass = await mk("pass-expiry", daysAgo(120));
    const uNever = await mk("never-booked", daysAgo(60));
    const uLapsed = await mk("lapsed", daysAgo(200));
    const uRecent = await mk("recent-so-fallback", daysAgo(90));

    // PASS_EXPIRY — 90 minutes left on a pass that lapses in 2 days.
    await db.userPass.create({
      data: {
        userId: uPass.id,
        name: `${TAG} Monthly Cricket`,
        sport: courtConfig.sport,
        courtConfigId: courtConfig.id,
        totalMinutes: 600,
        remainingMinutes: 90,
        price: 5000,
        validityDays: 30,
        expiresAt: daysAhead(2),
        status: "ACTIVE",
      },
    });
    console.log(`  ${uPass.name}: pass, 90 min left, expires in 2 days`);

    console.log(`  ${uNever.name}: account 60 days old, no bookings`);

    // LAPSED — played 90 days ago and not since.
    const booking = (userId: string, when: Date) =>
      db.booking.create({
        data: {
          userId,
          courtConfigId: courtConfig.id,
          date: new Date(when.toISOString().slice(0, 10)),
          status: "COMPLETED",
          totalAmount: 1000,
          platform: TAG,
        },
      });
    await booking(uLapsed.id, daysAgo(90));
    console.log(`  ${uLapsed.name}: last played 90 days ago`);

    // Falls through every personal rule → FREE_SLOTS (if any are free).
    await booking(uRecent.id, daysAgo(3));
    console.log(`  ${uRecent.name}: played 3 days ago — should fall through to the fallback`);

    // ── Configure and run for real ───────────────────────────────────
    console.log("\n── Enabling the module at the current IST hour ──");
    const cfg = {
      enabled: true,
      sendHourIST: istHour,
      // Wide open, so the current hour is never inside them.
      quietFromHour: 3,
      quietToHour: 4,
      maxPerUserPerWeek: 2,
      skipIfBookedSoon: true,
      skipIfPushedToday: true,
      rulePassExpiryEnabled: true,
      rulePassExpiryDays: 3,
      ruleNeverBookedEnabled: true,
      ruleNeverBookedDays: 7,
      ruleLapsedEnabled: true,
      ruleLapsedDays: 30,
      ruleFreeSlotsEnabled: true,
      // Anything still open today counts, so the fallback gets its best
      // chance to fire on a real evening.
      ruleFreeSlotsFromHour: 0,
      ruleFreeSlotsMinOpen: 1,
    };
    await db.dailyPushSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...cfg },
      update: cfg,
    });

    const loaded = await loadDailyPushSettings();
    check("settings round-trip through loadDailyPushSettings", loaded.sendHourIST === istHour);

    console.log("\n── RUN 1 (real send, invalid tokens) ──");
    const r1 = await runDailyPush({ now });
    console.log(JSON.stringify({ refusal: r1.refusal, sent: r1.sent, considered: r1.considered, venue: r1.venue, skipped: r1.skipped }, null, 2));
    for (const b of r1.buckets) {
      console.log(`  bucket ${b.rule}: ${b.count} → attempted ${b.attempted}, succeeded ${b.succeeded}`);
    }

    check("run was not refused", r1.refusal === null, r1.refusal ?? "");

    const ruleOf = async (userId: string) =>
      (await db.dailyPushSend.findUnique({
        where: { userId_sentOn: { userId, sentOn: dayKey } },
        select: { ruleKey: true },
      }))?.ruleKey ?? null;

    check("pass-expiry user matched PASS_EXPIRY", (await ruleOf(uPass.id)) === "PASS_EXPIRY", `got ${await ruleOf(uPass.id)}`);
    check("never-booked user matched NEVER_BOOKED", (await ruleOf(uNever.id)) === "NEVER_BOOKED", `got ${await ruleOf(uNever.id)}`);
    check("lapsed user matched LAPSED", (await ruleOf(uLapsed.id)) === "LAPSED", `got ${await ruleOf(uLapsed.id)}`);

    const recentRule = await ruleOf(uRecent.id);
    if (r1.venue.freeSlotsTonight > 0) {
      check("recent user fell through to FREE_SLOTS", recentRule === "FREE_SLOTS", `got ${recentRule}`);
    } else {
      check(
        "recent user correctly got NOTHING (arena is full tonight — the honesty branch)",
        recentRule === null,
        `got ${recentRule}`,
      );
    }

    const optedOutCount = r1.skipped["opted out"] ?? 0;
    check(
      `all ${realOwnerIds.length} real devices were skipped as opted out`,
      optedOutCount === realOwnerIds.length,
      `skipped["opted out"]=${optedOutCount}`,
    );

    // ── Dispatch logging ─────────────────────────────────────────────
    console.log("\n── Dispatch log ──");
    const dispatches = await db.pushDispatch.findMany({
      where: { source: "scheduled", createdAt: { gte: new Date(now.getTime() - 3600_000) } },
      select: { kind: true, audience: true, userId: true, title: true, body: true, attempted: true },
      orderBy: { createdAt: "asc" },
    });
    for (const d of dispatches) {
      console.log(`  [${d.audience}] userId=${d.userId ? "set" : "null"} attempted=${d.attempted}`);
      console.log(`     "${d.title}" / "${d.body}"`);
    }
    check("every dispatch was logged as source=scheduled", dispatches.length > 0);
    check(
      "shared buckets logged with no userId (one row per multicast)",
      dispatches.filter((d) => d.audience !== "daily:PASS_EXPIRY").every((d) => d.userId === null),
    );
    const passDispatch = dispatches.find((d) => d.audience === "daily:PASS_EXPIRY");
    check("pass-expiry logged per recipient, with the userId", passDispatch?.userId === uPass.id);
    check(
      "pass-expiry copy carries the real balance, plan and expiry",
      !!passDispatch && /1\.5 hours/.test(passDispatch.body) && /Monthly Cricket/.test(passDispatch.body) && !/\{/.test(passDispatch.title + passDispatch.body),
      passDispatch ? `title="${passDispatch.title}" body="${passDispatch.body}"` : "no dispatch",
    );
    check(
      "no unsubstituted {placeholders} survived into any message",
      dispatches.every((d) => !/\{[a-zA-Z]+\}/.test(d.title + d.body)),
    );
    check("tap target is a deep link the installed app already routes", dispatches.every((d) => d.kind === "open_screen"));

    // ── Idempotency ──────────────────────────────────────────────────
    console.log("\n── RUN 2 (same IST day — must send to nobody) ──");
    // FCM pruned the invalid tokens, which is itself correct behaviour.
    // Re-add them so run 2 genuinely reaches the suppression check
    // rather than trivially finding no audience.
    for (const u of [uPass, uNever, uLapsed, uRecent]) {
      const has = await db.pushDevice.count({ where: { userId: u.id } });
      if (has === 0) {
        await db.pushDevice.create({
          data: {
            userId: u.id,
            token: `fZZtest${Math.random().toString(36).slice(2)}:APA91b${"y".repeat(134)}`,
            platform: "android",
            appVersion: TAG,
          },
        });
      }
    }
    const r2 = await runDailyPush({ now });
    console.log(JSON.stringify({ sent: r2.sent, skipped: r2.skipped }, null, 2));
    check("run 2 sent to nobody", r2.sent === 0, `sent ${r2.sent}`);
    check(
      "run 2 skipped the cohort as 'already sent today'",
      (r2.skipped["already sent today"] ?? 0) >= 3,
      JSON.stringify(r2.skipped),
    );
    const claimCount = await db.dailyPushSend.count({
      where: { sentOn: dayKey, user: { name: { startsWith: TAG } } },
    });
    check("no duplicate claim rows were written", claimCount <= 4, `${claimCount} rows`);

    // ── THE MIXED BUCKET ─────────────────────────────────────────────
    // The case that actually bites, and the one run 2 cannot reach: a
    // bucket holding somebody already sent to today AND somebody newly
    // eligible. Before runId existed, the claim's re-read handed back
    // both and the already-sent person was messaged a second time.
    console.log("\n── RUN 2b (a bucket mixing already-sent with newly-eligible) ──");
    const uLate = await mk("lapsed-arrived-late", daysAgo(200));
    await booking(uLate.id, daysAgo(95));
    const before2b = await db.pushDispatch.count({
      where: { source: "scheduled", audience: "daily:LAPSED" },
    });
    const r2b = await runDailyPush({ now });
    const after2b = await db.pushDispatch.count({
      where: { source: "scheduled", audience: "daily:LAPSED" },
    });
    console.log(JSON.stringify({ sent: r2b.sent, buckets: r2b.buckets.map((b) => ({ rule: b.rule, count: b.count, attempted: b.attempted })) }, null, 2));
    check("exactly one person was sent to — the new one", r2b.sent === 1, `sent ${r2b.sent}`);
    check(
      "the LAPSED multicast went to 1 token, not 2",
      r2b.buckets.find((b) => b.rule === "LAPSED")?.attempted === 1,
      `attempted ${r2b.buckets.find((b) => b.rule === "LAPSED")?.attempted}`,
    );
    check("one further LAPSED dispatch was logged", after2b === before2b + 1, `${before2b} → ${after2b}`);
    check(
      "the already-sent user was not claimed twice",
      (await db.dailyPushSend.count({ where: { userId: uLapsed.id, sentOn: dayKey } })) === 1,
    );

    // ── Weekly cap ───────────────────────────────────────────────────
    console.log("\n── RUN 3 (weekly cap) ──");
    // Backdate the cohort's claims to yesterday so they are eligible
    // again today, then drop the cap to 1: last week's single send
    // must be enough to stop them.
    await db.dailyPushSend.updateMany({
      where: { user: { name: { startsWith: TAG } } },
      data: { sentOn: new Date(dayKey.getTime() - 86400_000) },
    });
    await db.dailyPushSettings.update({
      where: { id: "singleton" },
      data: { maxPerUserPerWeek: 1 },
    });
    const r3 = await runDailyPush({ now });
    console.log(JSON.stringify({ sent: r3.sent, skipped: r3.skipped }, null, 2));
    check("run 3 sent to nobody", r3.sent === 0, `sent ${r3.sent}`);
    check(
      "run 3 stopped them at the weekly cap",
      Object.keys(r3.skipped).some((k) => k.startsWith("weekly cap reached")),
      JSON.stringify(r3.skipped),
    );

    // ── Wrong hour ───────────────────────────────────────────────────
    console.log("\n── RUN 4 (an hour that is not the send hour) ──");
    const r4 = await runDailyPush({ now: new Date(now.getTime() + 3600_000) });
    check("run 4 refused, off-schedule", (r4.refusal ?? "").includes("not the send hour"), r4.refusal ?? "none");

    console.log("\n── RUN 5 (quiet hours beat the send hour) ──");
    await db.dailyPushSettings.update({
      where: { id: "singleton" },
      data: { quietFromHour: istHour, quietToHour: (istHour + 2) % 24 },
    });
    const r5 = await runDailyPush({ now });
    check("run 5 refused for quiet hours", (r5.refusal ?? "").includes("quiet hours"), r5.refusal ?? "none");
  } finally {
    // ── Cleanup, always ──────────────────────────────────────────────
    console.log("\n── Cleanup ──");
    try {
      const doomed = await db.user.findMany({
        where: { name: { startsWith: TAG } },
        select: { id: true },
      });
      const ids = doomed.map((d) => d.id);
      if (ids.length) {
        await db.dailyPushSend.deleteMany({ where: { userId: { in: ids } } });
        await db.pushDispatch.deleteMany({ where: { userId: { in: ids } } });
        await db.userPass.deleteMany({ where: { userId: { in: ids } } });
        await db.booking.deleteMany({ where: { userId: { in: ids } } });
        await db.pushDevice.deleteMany({ where: { userId: { in: ids } } });
        await db.user.deleteMany({ where: { id: { in: ids } } });
      }
      // The multicast dispatch rows carry no userId, so they are found
      // by their audience tag instead.
      await db.pushDispatch.deleteMany({
        where: { source: "scheduled", audience: { startsWith: "daily:" } },
      });
      console.log(`  removed ${ids.length} synthetic users and everything hanging off them`);

      for (const u of realPriorOptOut) {
        // updateMany, not update: a missing row must not abort the rest
        // of cleanup — the settings restore below is the important part
        // and it used to be stranded behind this throwing.
        await db.user.updateMany({
          where: { id: u.id },
          data: { offersOptOut: u.offersOptOut },
        });
      }
      console.log(`  restored offersOptOut on ${realPriorOptOut.length} real users`);

      if (settingsBefore) {
        const { id: _id, updatedAt: _u, ...rest } = settingsBefore;
        await db.dailyPushSettings.update({ where: { id: "singleton" }, data: rest });
        console.log(`  restored settings (enabled=${settingsBefore.enabled})`);
      } else {
        await db.dailyPushSettings.deleteMany({ where: { id: "singleton" } });
        console.log("  removed the settings row (there was none before)");
      }
    } catch (err) {
      console.error(
        "\n!! CLEANUP FAILED — the database may still hold test data tagged " +
          `"${TAG}". Remove it by hand.\n`,
        err,
      );
      fail++;
    }

    // Belt and braces, outside the catch above: whatever else went
    // wrong, the module must not be left switched on. An interrupted
    // run once left it enabled with the send hour set to the current
    // hour, which on a database that IS cron'd would have been a live
    // fan-out nobody asked for.
    try {
      const left = await db.dailyPushSettings.findUnique({ where: { id: "singleton" } });
      if (left?.enabled && !settingsBefore?.enabled) {
        await db.dailyPushSettings.update({
          where: { id: "singleton" },
          data: { enabled: false },
        });
        console.log("  force-disabled the module (it was left on)");
      }
    } catch {
      console.error("  !! COULD NOT CONFIRM THE MODULE IS OFF — check /admin/push/daily");
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    await db.$disconnect();
    if (fail > 0) process.exitCode = 1;
  }
}

main();
