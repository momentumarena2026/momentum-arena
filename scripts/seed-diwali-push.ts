/**
 * Switch on the Diwali Bumper creative run: twelve single-day windows,
 * the twelve lines allowed inside them, and the 7 PM send hour.
 *
 * ── WHAT THIS CHANGES THAT IS NOT A LINE ──────────────────────────────
 * `DailyPushSettings.sendHourIST`. The venue asked for the campaign to
 * go out at 7 PM IST; production was on 15 (3 PM). The cron fires every
 * hour at :30 UTC — exactly the top of the IST hour — and the handler
 * returns early unless the IST hour matches the setting, so this is the
 * only thing that decides when the push lands.
 *
 * Re-running RE-ASSERTS 19. That is deliberate for the duration of a
 * campaign the venue specified a time for, but it means an admin who
 * changes the hour in /admin/push/daily will have it changed back by a
 * re-run. `--keep-send-hour` skips it.
 *
 * ── WHY THIS NEEDS A SCRIPT AT ALL ────────────────────────────────────
 * The daily-push engine needs no changes; what is missing is DATA. A
 * tag with no `DailyPushOccasion` window is never true, so a line
 * carrying one is never eligible and nothing reports it — the rotation
 * simply never offers it. Three `diwali`-tagged lines have sat in the
 * library at useCount 0 for exactly that reason.
 *
 * ── WHAT MAKES TWELVE DAYS COME OUT IN ORDER ──────────────────────────
 * Three behaviours in lib/daily-push-lines.ts compose to give it:
 *
 *   1. `occasionsFor` turns each one-day window on, so `diwali-d4` is
 *      true on 4 Nov and false every other day.
 *   2. `pickLine` treats a DATED occasion as topical, which sets the
 *      everyday pool aside for the duration. Without this the campaign
 *      lines would compete with ~90 everyday lines on recency and most
 *      would lose.
 *   3. Within the topical pool it is least-recently-used, nulls first —
 *      and with one tag true per day the pool has exactly one member,
 *      so LRU never gets a say. That is the point: the Navratri run
 *      showed that a shared tag leaves the order to a cuid tie-break,
 *      which put the last-day line on day one.
 *
 * This script does not take that on trust. After seeding it REPLAYS all
 * twelve days through the real `occasionsFor` + `pickLine` and prints
 * what each evening would send, so a wrong tag is visible here rather
 * than on the last night of the offer. It also replays 12 Nov to prove
 * the windows actually close.
 *
 * Idempotent. Lines are matched by title and never overwritten, so the
 * venue's edits survive a re-run; windows are upserted by tag.
 *
 *   npx tsx scripts/seed-diwali-push.ts --dry-run
 *   npx tsx scripts/seed-diwali-push.ts
 *   npx tsx scripts/seed-diwali-push.ts --allow-production   # CI only
 */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_DAILY_PUSH_LINES } from "../lib/daily-push-library";
import {
  occasionsFor,
  calendarOccasionsFor,
  pickLine,
  type LineCandidate,
} from "../lib/daily-push-lines";
import {
  DIWALI_DAY_TAGS,
  DIWALI_DISCOUNT_FROM,
  DIWALI_DISCOUNT_TO,
  DIWALI_FLAT_RATE,
  DIWALI_PUSH_DAYS,
  DIWALI_PUSH_FROM,
  DIWALI_PUSH_TO,
  DIWALI_TEASER_TAG,
  diwaliDayTag,
  diwaliPushDates,
} from "../lib/diwali-2026";

const db = new PrismaClient();
const PRODUCTION_ENDPOINT = "ep-dark-hat-ampi5dah";
const DRY_RUN = process.argv.includes("--dry-run");
const KEEP_SEND_HOUR = process.argv.includes("--keep-send-hour");
const SEND_HOUR_IST = 19; // 7 PM, as asked for.

const isDiwaliLine = (tags: string[]) => tags.some((t) => DIWALI_DAY_TAGS.includes(t));

/** The twelve lines, taken from the library so there is one source of copy. */
const DIWALI_LINES = DEFAULT_DAILY_PUSH_LINES.filter((l) => isDiwaliLine(l.tags ?? []));

/** Label for a push day: d0 is the teaser, dN is the Nth day of the offer. */
function labelFor(day: number): string {
  return day === 0
    ? "Diwali Bumper 2026 — teaser (eve)"
    : `Diwali Bumper 2026 — day ${day}`;
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL is not set.");
  const isProduction = url.includes(PRODUCTION_ENDPOINT);
  if (isProduction && !DRY_RUN && !process.argv.includes("--allow-production")) {
    throw new Error(
      "REFUSING TO RUN: that is the PRODUCTION branch. Pass --allow-production if you mean it.",
    );
  }
  console.log(`database: ${url.match(/@([^/?]+)/)?.[1] ?? "unknown"}`);
  console.log(
    `offer    : ₹${DIWALI_FLAT_RATE}/hr on play dates ${DIWALI_DISCOUNT_FROM} → ${DIWALI_DISCOUNT_TO} (IST)`,
  );
  console.log(`pushes   : ${DIWALI_PUSH_FROM} → ${DIWALI_PUSH_TO}, ${SEND_HOUR_IST}:00 IST\n`);
  if (DRY_RUN) console.log("DRY RUN — nothing will be written\n");

  // ── 0. Guards that are cheaper than a wrong evening ─────────────────
  if (DIWALI_LINES.length !== DIWALI_PUSH_DAYS) {
    throw new Error(
      `Expected ${DIWALI_PUSH_DAYS} diwali lines in the library, found ${DIWALI_LINES.length}. ` +
        `Twelve push days needs twelve lines: fewer leaves a day on the everyday pool, more leaves one unsaid.`,
    );
  }
  for (const tag of DIWALI_DAY_TAGS) {
    const n = DIWALI_LINES.filter((l) => (l.tags ?? []).includes(tag)).length;
    if (n !== 1) throw new Error(`Tag ${tag} is carried by ${n} lines; it must be exactly 1.`);
  }

  // The teaser runs the evening BEFORE the offer opens, so it may not
  // claim the rate is live today. Checked here as well as in the test
  // suite because this is the script that actually arms it.
  const teaser = DIWALI_LINES.find((l) => (l.tags ?? []).includes(DIWALI_TEASER_TAG))!;
  if (/\baaj\b/i.test(teaser.body) || /\baaj\b/i.test(teaser.title)) {
    throw new Error(
      `The ${DIWALI_TEASER_TAG} teaser says "aaj" — it runs on ${DIWALI_PUSH_FROM}, the day BEFORE ` +
        `the offer opens on ${DIWALI_DISCOUNT_FROM}. It must promise tomorrow.\n  ${teaser.title} / ${teaser.body}`,
    );
  }

  // A title collision is the silent failure mode of this seeder: lines
  // are matched by title, so a Diwali title that already exists on a
  // DIFFERENT line would make the run skip creating it, and the day
  // tag would never land on anything.
  const colliding = await db.dailyPushLine.findMany({
    where: { title: { in: DIWALI_LINES.map((l) => l.title) } },
    select: { title: true, tags: true },
  });
  const wrongOwner = colliding.filter((r) => !isDiwaliLine(r.tags));
  if (wrongOwner.length > 0) {
    throw new Error(
      `These titles already exist on non-Diwali lines, so the day tags would never be attached:\n` +
        wrongOwner.map((r) => `  "${r.title}"  tags=[${r.tags.join(", ")}]`).join("\n") +
        `\nRename the copy in lib/daily-push-library.ts.`,
    );
  }

  // A bare `diwali` window would drop three legacy lines into the same
  // topical pool and turn the day-by-day sequencing back into a coin
  // toss. Refuse rather than produce a run that looks right in the
  // replay below only because of a tie-break.
  const bare = await db.dailyPushOccasion.findFirst({ where: { tag: "diwali" } });
  if (bare) {
    throw new Error(
      `A window exists for the bare \`diwali\` tag (${bare.label}). Three legacy lines carry it, ` +
        `and they would compete with the dated campaign lines. Delete that window — the campaign ` +
        `uses ${DIWALI_TEASER_TAG}…${diwaliDayTag(DIWALI_PUSH_DAYS - 1)} instead.`,
    );
  }

  // ── 1. Twelve single-day windows ────────────────────────────────────
  const days = diwaliPushDates();
  if (days.length !== DIWALI_PUSH_DAYS) {
    throw new Error(`The push range spans ${days.length} days, expected ${DIWALI_PUSH_DAYS}.`);
  }

  const existingWindows = await db.dailyPushOccasion.findMany({
    where: { tag: { in: DIWALI_DAY_TAGS } },
    select: { id: true, tag: true },
  });
  const byTag = new Map(existingWindows.map((w) => [w.tag, w.id]));

  for (const [i, day] of days.entries()) {
    const tag = diwaliDayTag(i);
    // `@db.Date` takes a bare calendar date and nothing else — handing
    // one an instant is gotcha 19, which is how a window silently lands
    // on the wrong day. Start and end are the same day: that is the
    // point, a one-day window.
    const at = new Date(`${day}T00:00:00.000Z`);
    const data = { tag, label: labelFor(i), startsOn: at, endsOn: at };
    if (DRY_RUN) continue;
    const id = byTag.get(tag);
    if (id) await db.dailyPushOccasion.update({ where: { id }, data });
    else await db.dailyPushOccasion.create({ data });
  }
  console.log(
    `windows: ${existingWindows.length ? "updated" : "created"} ${DIWALI_PUSH_DAYS}  ` +
      `${DIWALI_PUSH_FROM} → ${DIWALI_PUSH_TO} (IST)`,
  );

  // ── 2. The lines ────────────────────────────────────────────────────
  const present = new Set(colliding.map((r) => r.title));
  const toAdd = DIWALI_LINES.filter((l) => !present.has(l.title));
  if (toAdd.length > 0 && !DRY_RUN) {
    await db.dailyPushLine.createMany({
      data: toAdd.map((l) => ({ title: l.title, body: l.body, tags: l.tags ?? [] })),
    });
  }
  console.log(`lines  : added ${toAdd.length}, ${present.size} already present`);

  // ── 3. The send hour ────────────────────────────────────────────────
  const settings = await db.dailyPushSettings.findUnique({ where: { id: "singleton" } });
  if (!settings) {
    throw new Error(
      "DailyPushSettings has no singleton row. Open /admin/push/daily once to create it, then re-run.",
    );
  }
  if (KEEP_SEND_HOUR) {
    console.log(`sendHour: left at ${settings.sendHourIST}:00 IST (--keep-send-hour)`);
  } else if (settings.sendHourIST === SEND_HOUR_IST) {
    console.log(`sendHour: already ${SEND_HOUR_IST}:00 IST`);
  } else {
    if (!DRY_RUN) {
      await db.dailyPushSettings.update({
        where: { id: "singleton" },
        data: { sendHourIST: SEND_HOUR_IST },
      });
    }
    console.log(
      `sendHour: ${settings.sendHourIST}:00 → ${SEND_HOUR_IST}:00 IST  ` +
        `${DRY_RUN ? "(would change)" : "CHANGED"}`,
    );
  }
  if (!settings.enabled) {
    console.log(
      "\n⚠ DailyPushSettings.enabled is FALSE — nothing will send at all, whatever is seeded here. " +
        "Turn the module on at /admin/push/daily.",
    );
  }
  // The weekly cap is what decides whether "daily" is actually daily
  // for one person. At 7 it permits one a day; below that, most people
  // get a subset of the twelve and the countdown lines may not reach
  // the same person who got the opener.
  if (settings.maxPerUserPerWeek < 7) {
    console.log(
      `\n⚠ maxPerUserPerWeek is ${settings.maxPerUserPerWeek}. The campaign runs daily, but no ONE ` +
        `person will receive more than ${settings.maxPerUserPerWeek} pushes a week — the countdown ` +
        `lines will not reach everyone who got the opener. Raise it to 7 for a daily campaign.`,
    );
  }
  console.log("");

  // ── 4. Replay every day against the REAL selection logic ────────────
  //
  // Read back from the database rather than from the library file: what
  // matters is what the engine will see, including any line the venue
  // has since disabled or re-tagged.
  const live = await db.dailyPushLine.findMany({
    select: { id: true, title: true, body: true, tags: true, enabled: true, lastUsedAt: true },
  });
  const stored = await db.dailyPushOccasion.findMany({
    select: { tag: true, label: true, startsOn: true, endsOn: true },
  });
  // On a dry run the windows are not in the database yet, so the replay
  // would report "nothing eligible" for every day and look like a
  // failure. Supply them in memory instead.
  const windows = DRY_RUN
    ? stored.concat(
        days.map((day, i) => ({
          tag: diwaliDayTag(i),
          label: labelFor(i),
          startsOn: new Date(`${day}T00:00:00.000Z`),
          endsOn: new Date(`${day}T00:00:00.000Z`),
        })),
      )
    : stored;

  const pool: LineCandidate[] = live.map((l) => ({ ...l }));
  if (DRY_RUN) {
    for (const l of toAdd) {
      pool.push({
        id: `pending-${l.title}`,
        title: l.title,
        body: l.body,
        tags: l.tags ?? [],
        enabled: true,
        lastUsedAt: null,
      });
    }
  }

  console.log(`what the module would send at ${SEND_HOUR_IST}:00 IST, day by day:\n`);
  const seen = new Set<string>();
  let problems = 0;
  for (const [i, day] of days.entries()) {
    const istDate = new Date(`${day}T00:00:00.000Z`);
    const occasions = occasionsFor(istDate, windows);
    const calendar = calendarOccasionsFor(istDate, windows);
    // `slotsAreFree: false` is the harsher of the two readings — it
    // withholds every `needs-slots` line. None of the twelve carries
    // that tag, so if one shows up here the copy has drifted.
    const pick = pickLine(pool, { occasions, calendarOccasions: calendar, slotsAreFree: false });
    const weekday = istDate.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
    const want = diwaliDayTag(i);
    if (!pick) {
      console.log(`  ${day} ${weekday}  — NOTHING ELIGIBLE`);
      problems++;
      continue;
    }
    if (seen.has(pick.id)) problems++;
    seen.add(pick.id);
    const off = pick.tags.includes(want) ? "" : `   ← expected the ${want} line`;
    if (!pick.tags.includes(want)) problems++;
    console.log(`  ${day} ${weekday}  ${pick.title}${off}`);
    console.log(`                 ${pick.body}`);
    // Mark it used, exactly as the engine does, so the next day's LRU
    // sees the same state it would see in production.
    pick.lastUsedAt = new Date(`${day}T13:30:00.000Z`);
  }

  console.log(
    `\n${seen.size}/${DIWALI_PUSH_DAYS} distinct lines across the run` +
      (problems === 0 && seen.size === DIWALI_PUSH_DAYS ? "  ✓" : "  ← PROBLEM"),
  );
  if (problems > 0 || seen.size !== DIWALI_PUSH_DAYS) {
    throw new Error(
      "The run does not produce one distinct, correctly-dated line per day. Check the tag on each line and that every window landed.",
    );
  }

  // The day after must fall back to the everyday pool — proof the
  // windows actually close rather than running on.
  const after = new Date("2026-11-12T00:00:00.000Z");
  const afterPick = pickLine(pool, {
    occasions: occasionsFor(after, windows),
    calendarOccasions: calendarOccasionsFor(after, windows),
    slotsAreFree: false,
  });
  console.log(
    `2026-11-12 (offer over): ${afterPick?.title ?? "nothing"}` +
      (afterPick && isDiwaliLine(afterPick.tags)
        ? "  ← STILL A DIWALI LINE, the windows are not closing"
        : "  ✓ back to the everyday pool"),
  );
  if (afterPick && isDiwaliLine(afterPick.tags)) {
    throw new Error("A diwali campaign line is still winning after the windows end.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
