/**
 * Switch on the Navratri creative run: the dated window plus the nine
 * lines that are only allowed to run inside it.
 *
 * ── WHY THIS NEEDS A SCRIPT AT ALL ────────────────────────────────────
 * The daily-push module already does everything required here; nothing
 * about the engine changes. What was missing is DATA, and specifically
 * one row that nobody has ever created: `DailyPushOccasion` is empty in
 * production, which is why all eighteen festival and fixture lines in
 * the library (holi, diwali, janmashtami, ipl, india-match) still read
 * `useCount: 0`. A tag with no window is never true, so a line carrying
 * it is never eligible, and nothing anywhere reports that — the rotation
 * simply never offers it. `seed-daily-push-lines.ts` warns about this at
 * the end of its run; this script is the other half, the one that fixes
 * it.
 *
 * ── WHAT MAKES NINE DAYS COME OUT DIFFERENT ───────────────────────────
 * Three behaviours in lib/daily-push-lines.ts compose to give exactly
 * what the venue asked for, and it is worth writing down because none of
 * them is obvious from the call site:
 *
 *   1. `occasionsFor` turns the window on, so `navratri` is true on each
 *      of the nine days and false on the tenth.
 *   2. `pickLine` treats a DATED occasion as topical, which sets the 82
 *      everyday lines aside entirely for the duration. Without this the
 *      festival lines would compete with the everyday pool on recency
 *      and most of them would lose.
 *   3. Within that pool it is least-recently-used, nulls first. Nine
 *      unused lines therefore go out one per day, in id order, and
 *      nothing repeats.
 *
 * This script does not take that on trust. After seeding it REPLAYS all
 * nine days through the real `occasionsFor` + `pickLine` and prints the
 * line each day would send, so a wrong count or a missing tag is visible
 * here rather than on the ninth evening of the festival.
 *
 * Idempotent. Lines are matched by title and never overwritten, so the
 * venue's edits survive a re-run; the window is upserted by tag.
 *
 *   npx tsx scripts/seed-navratri-push.ts
 *   npx tsx scripts/seed-navratri-push.ts --dry-run
 *   npx tsx scripts/seed-navratri-push.ts --allow-production   # CI only
 */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_DAILY_PUSH_LINES } from "../lib/daily-push-library";
import { occasionsFor, calendarOccasionsFor, pickLine, type LineCandidate } from "../lib/daily-push-lines";
import {
  NAVRATRI_FROM,
  NAVRATRI_TO,
  NAVRATRI_DAYS,
  NAVRATRI_DAY_TAGS,
  navratriDayTag,
  navratriDates,
} from "../lib/navratri-2026";

const db = new PrismaClient();
const PRODUCTION_ENDPOINT = "ep-dark-hat-ampi5dah";
const DRY_RUN = process.argv.includes("--dry-run");

const isNavratriLine = (tags: string[]) => tags.some((t) => NAVRATRI_DAY_TAGS.includes(t));

/** The nine lines, taken from the library so there is one source of copy. */
const NAVRATRI_LINES = DEFAULT_DAILY_PUSH_LINES.filter((l) => isNavratriLine(l.tags ?? []));

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
  if (DRY_RUN) console.log("DRY RUN — nothing will be written\n");

  // A mismatch here means the copy and the window disagree about how
  // long the festival is, which shows up as either a repeated line on
  // the last day or a line that never gets said. Cheaper to refuse.
  if (NAVRATRI_LINES.length !== NAVRATRI_DAYS) {
    throw new Error(
      `Expected ${NAVRATRI_DAYS} navratri lines in the library, found ${NAVRATRI_LINES.length}. ` +
        `Nine days needs nine lines: fewer leaves a day on the everyday pool, more leaves one unsaid.`,
    );
  }
  // Each day tag must be carried by exactly one line. Two lines on one
  // tag is a silent coin toss; zero is a day that quietly drops off the
  // festival and onto the everyday pool.
  for (const tag of NAVRATRI_DAY_TAGS) {
    const n = NAVRATRI_LINES.filter((l) => (l.tags ?? []).includes(tag)).length;
    if (n !== 1) throw new Error(`Tag ${tag} is carried by ${n} lines; it must be exactly 1.`);
  }

  // ── 1. Nine single-day windows ──────────────────────────────────────
  const days = navratriDates();
  if (days.length !== NAVRATRI_DAYS) {
    throw new Error(`The date range spans ${days.length} days, expected ${NAVRATRI_DAYS}.`);
  }

  const existingWindows = await db.dailyPushOccasion.findMany({
    where: { tag: { in: NAVRATRI_DAY_TAGS } },
    select: { id: true, tag: true },
  });
  const byTag = new Map(existingWindows.map((w) => [w.tag, w.id]));

  for (const [i, day] of days.entries()) {
    const tag = navratriDayTag(i + 1);
    // `@db.Date` takes a bare calendar date and nothing else — handing
    // one an instant is gotcha 19, which is how a window silently lands
    // on the wrong day. Start and end are the same day: that is the
    // point, a one-day window.
    const at = new Date(`${day}T00:00:00.000Z`);
    const data = { tag, label: `Navratri 2026 — day ${i + 1}`, startsOn: at, endsOn: at };
    if (DRY_RUN) continue;
    const id = byTag.get(tag);
    if (id) await db.dailyPushOccasion.update({ where: { id }, data });
    else await db.dailyPushOccasion.create({ data });
  }
  console.log(
    `${existingWindows.length ? "updated" : "created"} ${NAVRATRI_DAYS} one-day windows  ` +
      `${NAVRATRI_FROM} → ${NAVRATRI_TO} (IST)\n`,
  );

  // ── 2. The lines ────────────────────────────────────────────────────
  const present = new Set(
    (
      await db.dailyPushLine.findMany({
        where: { title: { in: NAVRATRI_LINES.map((l) => l.title) } },
        select: { title: true },
      })
    ).map((r) => r.title),
  );
  const toAdd = NAVRATRI_LINES.filter((l) => !present.has(l.title));
  if (toAdd.length > 0 && !DRY_RUN) {
    await db.dailyPushLine.createMany({
      data: toAdd.map((l) => ({ title: l.title, body: l.body, tags: l.tags ?? [] })),
    });
  }
  console.log(`lines: added ${toAdd.length}, ${present.size} already present\n`);

  // ── 3. Replay the nine days against the REAL selection logic ────────
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
  // would report "nothing eligible" for all nine days and look like a
  // failure. Supply them in memory instead.
  const windows = DRY_RUN
    ? stored.concat(
        navratriDates().map((day, i) => ({
          tag: navratriDayTag(i + 1),
          label: `Navratri 2026 — day ${i + 1}`,
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

  console.log("what the module would send, day by day:\n");
  const seen = new Set<string>();
  let clashes = 0;
  for (const day of navratriDates()) {
    const istDate = new Date(`${day}T00:00:00.000Z`);
    const occasions = occasionsFor(istDate, windows);
    const calendar = calendarOccasionsFor(istDate, windows);
    // `slotsAreFree: false` is the harsher of the two readings — it
    // withholds every `needs-slots` line. None of the nine carries that
    // tag, so if one shows up here the copy has drifted.
    const pick = pickLine(pool, { occasions, calendarOccasions: calendar, slotsAreFree: false });
    const weekday = istDate.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
    if (!pick) {
      console.log(`  ${day} ${weekday}  — NOTHING ELIGIBLE`);
      clashes++;
      continue;
    }
    if (seen.has(pick.id)) clashes++;
    seen.add(pick.id);
    const want = navratriDayTag(navratriDates().indexOf(day) + 1);
    const topical = pick.tags.includes(want) ? "" : `   ← expected the ${want} line`;
    if (!pick.tags.includes(want)) clashes++;
    console.log(`  ${day} ${weekday}  ${pick.title}${topical}`);
    console.log(`                 ${pick.body}`);
    // Mark it used, exactly as the engine does, so the next day's LRU
    // sees the same state it would see in production.
    pick.lastUsedAt = new Date(`${day}T09:30:00.000Z`);
  }

  const distinct = seen.size;
  console.log(
    `\n${distinct}/${NAVRATRI_DAYS} distinct lines across the nine days` +
      (clashes === 0 && distinct === NAVRATRI_DAYS ? "  ✓" : "  ← PROBLEM"),
  );
  if (clashes > 0 || distinct !== NAVRATRI_DAYS) {
    throw new Error(
      "The nine days do not produce nine different lines. Check the tag on each line and that the window covers all nine dates.",
    );
  }

  // The tenth day must fall back to the everyday pool — proof the window
  // actually closes rather than running on.
  const after = new Date("2026-10-20T00:00:00.000Z");
  const afterPick = pickLine(pool, {
    occasions: occasionsFor(after, windows),
    calendarOccasions: calendarOccasionsFor(after, windows),
    slotsAreFree: false,
  });
  console.log(
    `2026-10-20 (Vijayadashami, outside the window): ${afterPick?.title ?? "nothing"}` +
      (afterPick && isNavratriLine(afterPick.tags)
        ? "  ← STILL A NAVRATRI LINE, the window is not closing"
        : "  ✓ back to the everyday pool"),
  );
  if (afterPick && isNavratriLine(afterPick.tags)) {
    throw new Error("A navratri line is still winning after the window ends.");
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
