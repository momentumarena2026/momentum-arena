/**
 * The Diwali Bumper campaign's dates and copy must agree with each other.
 *
 * ── WHAT CAN GO WRONG HERE, AND HAS GONE WRONG BEFORE ─────────────────
 * This campaign quotes a RUPEE FIGURE in a push notification. The
 * library's standing rule is no prices, for one reason: a line that
 * implies an offer can run on a day the offer is not live, and then the
 * counter has to honour a screenshot. Two things keep that from
 * happening here, and both are assertions rather than intentions:
 *
 *   the WINDOWS   each line carries a single-day tag, and the windows
 *                 for those tags are built from the same constants as
 *                 the coupon's play-date condition.
 *   the TEASER    one line runs the evening BEFORE the offer opens, so
 *                 it is the one place where the copy and the discount
 *                 genuinely disagree. It must promise tomorrow.
 *
 * The Navratri run established the other half of this: with a single
 * shared tag, LRU breaks ties on a cuid, and the first replay put the
 * last-day line on day one. Order here carries a festival calendar on
 * top of a countdown, so it is checked day by day.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIWALI_DAY_TAGS,
  DIWALI_DISCOUNT_DAYS,
  DIWALI_DISCOUNT_FROM,
  DIWALI_DISCOUNT_TO,
  DIWALI_FLAT_RATE,
  DIWALI_PUSH_DAYS,
  DIWALI_PUSH_FROM,
  DIWALI_PUSH_TO,
  DIWALI_TEASER_TAG,
  diwaliDayTag,
  diwaliDiscountDates,
  diwaliPushDates,
} from "../lib/diwali-2026";
import { DEFAULT_DAILY_PUSH_LINES } from "../lib/daily-push-library";

const CAMPAIGN = DEFAULT_DAILY_PUSH_LINES.filter((l) =>
  (l.tags ?? []).some((t) => DIWALI_DAY_TAGS.includes(t)),
);

/** The line carrying a given day tag. */
function lineFor(tag: string) {
  const hits = CAMPAIGN.filter((l) => (l.tags ?? []).includes(tag));
  assert.equal(hits.length, 1, `${tag} must be carried by exactly one line, found ${hits.length}`);
  return hits[0];
}

test("the two windows are the lengths the venue asked for", () => {
  assert.equal(diwaliDiscountDates().length, DIWALI_DISCOUNT_DAYS);
  assert.equal(diwaliPushDates().length, DIWALI_PUSH_DAYS);
  assert.equal(diwaliDiscountDates().at(0), DIWALI_DISCOUNT_FROM);
  assert.equal(diwaliDiscountDates().at(-1), DIWALI_DISCOUNT_TO);
});

test("the pushes open exactly one day early and close with the offer", () => {
  // The teaser day is the whole reason the push window is longer. One
  // day, not two: a second day of "kal se" would be a lie on the first
  // of them.
  const eve = new Date(`${DIWALI_DISCOUNT_FROM}T00:00:00.000Z`);
  eve.setUTCDate(eve.getUTCDate() - 1);
  assert.equal(
    DIWALI_PUSH_FROM,
    eve.toISOString().slice(0, 10),
    "the push window must start the day before the discount, not earlier",
  );
  assert.equal(
    DIWALI_PUSH_TO,
    DIWALI_DISCOUNT_TO,
    "the pushes must stop when the offer does — a push after the last play date advertises nothing",
  );
});

test("every push day has exactly one tag, and one line carries it", () => {
  assert.equal(DIWALI_DAY_TAGS.length, DIWALI_PUSH_DAYS);
  assert.deepEqual(
    DIWALI_DAY_TAGS,
    diwaliPushDates().map((_, i) => diwaliDayTag(i)),
    "tags must run d0…dN in push-date order — the seeder pairs them by index",
  );
  assert.equal(
    CAMPAIGN.length,
    DIWALI_PUSH_DAYS,
    `${DIWALI_PUSH_DAYS} push days needs ${DIWALI_PUSH_DAYS} lines: fewer leaves a day on the ` +
      `everyday pool, more leaves one unsaid`,
  );
  for (const tag of DIWALI_DAY_TAGS) lineFor(tag);
});

test("the teaser promises tomorrow, never today", () => {
  // The one line that runs while the offer is not yet live. "aaj" here
  // is a discount claimed a day early, in writing, on a lock screen.
  const teaser = lineFor(DIWALI_TEASER_TAG);
  const text = `${teaser.title} ${teaser.body}`;
  assert.doesNotMatch(
    text,
    /\baaj\b/i,
    `the ${DIWALI_TEASER_TAG} line runs on ${DIWALI_PUSH_FROM}, before the offer opens on ` +
      `${DIWALI_DISCOUNT_FROM} — it cannot say "aaj": ${text}`,
  );
  assert.match(
    text,
    /\bkal\b|november/i,
    "the teaser must point at a future date, or it reads as an offer that is already running",
  );
});

test("the last two days count down, inclusive of themselves", () => {
  // "kal raat tak" on the penultimate day; "aaj" on the final one. Get
  // these the wrong way round and the offer appears to end a day early.
  const penultimate = lineFor(diwaliDayTag(DIWALI_PUSH_DAYS - 2));
  const last = lineFor(diwaliDayTag(DIWALI_PUSH_DAYS - 1));
  assert.match(
    `${penultimate.title} ${penultimate.body}`,
    /\bkal\b/i,
    "the second-to-last day should say the offer ends tomorrow",
  );
  assert.match(
    `${last.title} ${last.body}`,
    /\baaj\b/i,
    "the last day should say the offer ends today",
  );
});

test("every line quotes the rate the coupon actually gives", () => {
  // The figure lives in lib/diwali-2026.ts. If somebody changes the
  // offer to 1400 and forgets the copy, twelve lock screens keep
  // quoting 1500 — so the copy is checked against the constant.
  const quoted = CAMPAIGN.filter((l) => /₹\s?\d/.test(`${l.title} ${l.body}`));
  assert.ok(quoted.length > 0, "a bumper-discount campaign that never mentions the rate is not one");
  for (const l of quoted) {
    const figures = [...`${l.title} ${l.body}`.matchAll(/₹\s?(\d+)/g)].map((m) => Number(m[1]));
    for (const f of figures) {
      assert.equal(
        f,
        DIWALI_FLAT_RATE,
        `"${l.title}" quotes ₹${f} but the offer is ₹${DIWALI_FLAT_RATE} — ` +
          `update lib/daily-push-library.ts or DIWALI_FLAT_RATE, whichever is wrong`,
      );
    }
  }
});

test("no campaign line claims the courts are free", () => {
  // `needs-slots` is the only tag gated on real availability. A
  // campaign line carrying it would be withheld on a busy evening,
  // which silently drops that day out of the sequence — and a line
  // asserting open courts on a full night is the lie that tag exists
  // to prevent.
  for (const l of CAMPAIGN) {
    assert.ok(
      !(l.tags ?? []).includes("needs-slots"),
      `"${l.title}" carries needs-slots; a dated campaign line must run whatever the availability`,
    );
  }
});

test("the copy follows the house rules it is allowed to follow", () => {
  const seen = new Set<string>();
  for (const l of CAMPAIGN) {
    // Titles are matched by the seeder and are the dedupe key in the
    // database, so a duplicate would make one day's tag land nowhere.
    assert.ok(!seen.has(l.title), `duplicate campaign title "${l.title}"`);
    seen.add(l.title);
    // ~40 chars is what an iOS lock screen shows before truncating.
    assert.ok(
      l.title.length <= 40,
      `"${l.title}" is ${l.title.length} chars; titles stay under 40 or iOS truncates them`,
    );
    assert.ok(!l.title.includes("!") && !l.body.includes("!"), `"${l.title}" uses an exclamation mark`);
    assert.equal(l.title, l.title.toLowerCase(), `"${l.title}" is not lowercase`);
  }
});

test("campaign titles do not collide with the rest of the library", () => {
  // The seeder matches by title. A Diwali title that already belongs to
  // an everyday line would be skipped on create, and that day's tag
  // would never be attached to anything.
  const others = DEFAULT_DAILY_PUSH_LINES.filter((l) => !CAMPAIGN.includes(l)).map((l) => l.title);
  for (const l of CAMPAIGN) {
    assert.ok(
      !others.includes(l.title),
      `"${l.title}" is already used by a non-campaign line — the seeder would never create the dated one`,
    );
  }
});
