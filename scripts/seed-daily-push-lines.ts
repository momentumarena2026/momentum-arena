/**
 * Install the starting creative library.
 *
 * Idempotent by title: a line already in the database is left exactly
 * as it is, including its edits, its tags and its rotation state. This
 * script adds what is missing and never overwrites, so running it again
 * after the venue has rewritten half the copy is safe.
 *
 * Refuses to touch production unless told to in as many words. Adding
 * rows to the production library is a deliberate act, and the guard
 * exists so it cannot be one somebody performs by having the wrong
 * DATABASE_URL exported. The GitHub workflow passes the flag; a
 * terminal almost never should.
 *
 *   npx tsx scripts/seed-daily-push-lines.ts                     # add what's missing
 *   npx tsx scripts/seed-daily-push-lines.ts --list              # show what is there
 *   npx tsx scripts/seed-daily-push-lines.ts --allow-production  # CI only
 */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_DAILY_PUSH_LINES } from "../lib/daily-push-library";
import { NEEDS_SLOTS } from "../lib/daily-push-lines";

const db = new PrismaClient();
const PRODUCTION_ENDPOINT = "ep-dark-hat-ampi5dah";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL is not set.");
  const isProduction = url.includes(PRODUCTION_ENDPOINT);
  const listOnly = process.argv.includes("--list");

  // The guard is on WRITING, not on looking. It was on the whole script
  // to begin with, which failed the workflow's own "show what is now
  // installed" step immediately after a successful seed — a red run over
  // a read-only listing, on work that had in fact succeeded. Refusing to
  // let somebody READ production content protects nothing and hides the
  // confirmation they came for.
  if (isProduction && !listOnly && !process.argv.includes("--allow-production")) {
    throw new Error(
      "REFUSING TO RUN: that is the PRODUCTION branch. Pass --allow-production if you mean it.",
    );
  }
  if (isProduction && !listOnly) console.log("Writing to PRODUCTION, explicitly allowed.\n");

  if (listOnly) {
    const rows = await db.dailyPushLine.findMany({
      orderBy: [{ enabled: "desc" }, { lastUsedAt: "asc" }],
      select: { title: true, body: true, tags: true, enabled: true, useCount: true, lastUsedAt: true },
    });
    console.log(`${rows.length} lines\n`);
    for (const r of rows) {
      const tag = r.tags.length ? `  [${r.tags.join(", ")}]` : "";
      const used = r.lastUsedAt ? ` · used ${r.useCount}x, last ${r.lastUsedAt.toISOString().slice(0, 10)}` : " · never used";
      console.log(`${r.enabled ? " " : "✗"} ${r.title}${tag}${used}`);
      console.log(`    ${r.body}`);
    }
    await db.$disconnect();
    return;
  }

  const existing = new Set(
    (await db.dailyPushLine.findMany({ select: { title: true } })).map((r) => r.title),
  );

  const toAdd = DEFAULT_DAILY_PUSH_LINES.filter((l) => !existing.has(l.title));
  if (toAdd.length > 0) {
    await db.dailyPushLine.createMany({
      data: toAdd.map((l) => ({ title: l.title, body: l.body, tags: l.tags ?? [] })),
    });
  }

  const total = await db.dailyPushLine.count();
  const claims = await db.dailyPushLine.count({ where: { tags: { has: NEEDS_SLOTS } } });
  console.log(`added ${toAdd.length}, skipped ${DEFAULT_DAILY_PUSH_LINES.length - toAdd.length} already present`);
  console.log(`library now holds ${total} lines (${claims} of them claim free slots and are gated on real availability)`);

  // Which occasion tags are used by lines but have no dated window?
  // Day-of-week and season are computed, so only the calendar ones can
  // be missing — and a festival line with no date never fires, quietly.
  const COMPUTED = new Set([
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "weekend", "weekday", "monsoon", "winter", "summer", "pleasant", NEEDS_SLOTS,
  ]);
  const used = new Set<string>();
  for (const l of await db.dailyPushLine.findMany({ select: { tags: true } })) {
    for (const t of l.tags) if (!COMPUTED.has(t)) used.add(t);
  }
  const dated = new Set((await db.dailyPushOccasion.findMany({ select: { tag: true } })).map((o) => o.tag));
  const missing = [...used].filter((t) => !dated.has(t)).sort();
  if (missing.length) {
    console.log(
      `\nThese tags have lines but no dates, so they will never fire:\n  ${missing.join(", ")}\n` +
        `Add windows in the admin (Daily push → Occasions). They are lunar or\n` +
        `fixture-dependent, which is exactly why they are not hard-coded.`,
    );
  }
  await db.$disconnect();
}

main();
