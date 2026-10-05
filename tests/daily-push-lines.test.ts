/**
 * Choosing today's creative line.
 *
 * The two things worth guarding here are the two ways this feature can
 * embarrass the venue: a line that claims free courts on a full night,
 * and a festival line that loses a coin toss on the one day it lands.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NEEDS_SLOTS,
  seasonTag,
  occasionsFor,
  lineIsEligible,
  pickLine,
  libraryRefusal,
  type LineCandidate,
  type LineContext,
} from "../lib/daily-push-lines";
import { istDayKey } from "../lib/daily-push-rules";

const line = (over: Partial<LineCandidate> & { id: string }): LineCandidate => ({
  title: "t",
  body: "b",
  tags: [],
  enabled: true,
  lastUsedAt: null,
  ...over,
});

const ctx = (over: Partial<LineContext> = {}): LineContext => ({
  occasions: ["monday", "winter", "weekday"],
  // Empty by default: weekday and season are AMBIENT, not calendar
  // occasions, and only calendar ones set the everyday pool aside.
  calendarOccasions: [],
  slotsAreFree: true,
  ...over,
});

/** IST calendar date for a given wall-clock IST day. */
const istDay = (iso: string) => istDayKey(new Date(`${iso}T06:00:00.000Z`));

// ── Occasions ──────────────────────────────────────────────────────────

test("seasons map to how Mathura actually feels, by month", () => {
  assert.equal(seasonTag(6), "monsoon"); // July
  assert.equal(seasonTag(8), "monsoon"); // September
  assert.equal(seasonTag(11), "winter"); // December
  assert.equal(seasonTag(0), "winter"); // January
  assert.equal(seasonTag(1), "winter"); // February
  assert.equal(seasonTag(3), "summer"); // April
  assert.equal(seasonTag(5), "summer"); // June
  assert.equal(seasonTag(2), "pleasant"); // March
  assert.equal(seasonTag(9), "pleasant"); // October
});

test("every month lands in exactly one season", () => {
  const seen = new Set<string>();
  for (let m = 0; m < 12; m++) seen.add(seasonTag(m));
  assert.deepEqual([...seen].sort(), ["monsoon", "pleasant", "summer", "winter"]);
});

test("weekday, weekend and season are computed without a table", () => {
  // 26 Sep 2026 is a Saturday.
  const sat = occasionsFor(istDay("2026-09-26"), []);
  assert.ok(sat.includes("saturday"));
  assert.ok(sat.includes("weekend"));
  assert.ok(sat.includes("monsoon"));
  assert.ok(!sat.includes("weekday"));

  const mon = occasionsFor(istDay("2026-09-28"), []);
  assert.ok(mon.includes("monday"));
  assert.ok(mon.includes("weekday"));
  assert.ok(!mon.includes("weekend"));
});

test("a dated window switches its tag on, inclusive at both ends", () => {
  const holi = {
    tag: "holi",
    label: "Holi",
    startsOn: istDay("2027-03-22"),
    endsOn: istDay("2027-03-23"),
  };
  assert.ok(occasionsFor(istDay("2027-03-22"), [holi]).includes("holi"), "first day");
  assert.ok(occasionsFor(istDay("2027-03-23"), [holi]).includes("holi"), "last day");
  assert.ok(!occasionsFor(istDay("2027-03-21"), [holi]).includes("holi"), "day before");
  assert.ok(!occasionsFor(istDay("2027-03-24"), [holi]).includes("holi"), "day after");
});

test("with no windows maintained, festival tags simply never fire", () => {
  // The honest failure: a year with no rows is a visible nothing, not a
  // wrong something. Nothing throws, nothing guesses a lunar date.
  const tags = occasionsFor(istDay("2029-03-22"), []);
  assert.ok(!tags.includes("holi"));
  assert.ok(tags.length > 0, "computed tags still work");
});

// ── Eligibility ────────────────────────────────────────────────────────

test("an untagged line is the everyday pool and always qualifies", () => {
  assert.equal(lineIsEligible(line({ id: "a" }), ctx()), true);
});

test("a switched-off line never runs", () => {
  assert.equal(lineIsEligible(line({ id: "a", enabled: false }), ctx()), false);
});

test("an occasion-tagged line only runs on its occasion", () => {
  const holiLine = line({ id: "a", tags: ["holi"] });
  assert.equal(lineIsEligible(holiLine, ctx()), false);
  assert.equal(lineIsEligible(holiLine, ctx({ occasions: ["holi", "tuesday"] })), true);
});

test("any one matching tag is enough", () => {
  const l = line({ id: "a", tags: ["monsoon", "monday"] });
  assert.equal(lineIsEligible(l, ctx({ occasions: ["monday", "winter"] })), true);
  assert.equal(lineIsEligible(l, ctx({ occasions: ["friday", "summer"] })), false);
});

test("needs-slots is a HARD gate — the line that could make us lie", () => {
  const claim = line({ id: "a", tags: [NEEDS_SLOTS] });
  assert.equal(lineIsEligible(claim, ctx({ slotsAreFree: true })), true);
  assert.equal(lineIsEligible(claim, ctx({ slotsAreFree: false })), false);
});

test("needs-slots does not accidentally make a line 'tagged' for occasions", () => {
  // A line carrying ONLY needs-slots must still be part of the everyday
  // pool on a night with space — not filtered out for having no
  // occasion match.
  const claim = line({ id: "a", tags: [NEEDS_SLOTS] });
  assert.equal(lineIsEligible(claim, ctx({ occasions: ["monday"], slotsAreFree: true })), true);
});

test("needs-slots combined with an occasion needs both", () => {
  const l = line({ id: "a", tags: [NEEDS_SLOTS, "friday"] });
  assert.equal(lineIsEligible(l, ctx({ occasions: ["friday"], slotsAreFree: true })), true);
  assert.equal(lineIsEligible(l, ctx({ occasions: ["friday"], slotsAreFree: false })), false, "full night");
  assert.equal(lineIsEligible(l, ctx({ occasions: ["monday"], slotsAreFree: true })), false, "wrong day");
});

// ── Selection ──────────────────────────────────────────────────────────

test("a DATED occasion beats generic — a festival line cannot lose a coin toss", () => {
  const generic = line({ id: "generic", lastUsedAt: null });
  const holi = line({ id: "holi", tags: ["holi"], lastUsedAt: new Date("2026-01-01") });
  // The generic line is LRU-older (never used) and would win on
  // recency alone. On Holi it must not.
  const picked = pickLine(
    [generic, holi],
    ctx({ occasions: ["holi", "monday"], calendarOccasions: ["holi"] }),
  );
  assert.equal(picked?.id, "holi");
});

test("an AMBIENT tag does not starve the everyday pool", () => {
  // THE BUG THIS PINS. Weekday and season are tags that are always true
  // of some line, so treating them as topical meant the topical pool was
  // never empty and the generic pool was never reached. On the real
  // library that was 44 of 82 lines unable to run on any day of the
  // year, and the rotation squeezed into three or four.
  const everyday = line({ id: "everyday", lastUsedAt: null });
  const monday = line({ id: "monday", tags: ["monday"], lastUsedAt: new Date("2026-01-01") });
  const picked = pickLine([monday, everyday], ctx({ occasions: ["monday"], calendarOccasions: [] }));
  assert.equal(picked?.id, "everyday", "the never-used everyday line must win on recency");
});

test("a monday line still only runs on a monday", () => {
  // Demoting ambient tags must not make them meaningless: the line is
  // still ineligible on the wrong day, it simply no longer monopolises
  // the right one.
  const monday = line({ id: "monday", tags: ["monday"] });
  assert.equal(pickLine([monday], ctx({ occasions: ["monday"] }))?.id, "monday");
  assert.equal(pickLine([monday], ctx({ occasions: ["tuesday"] })), null);
});

test("over a fortnight the everyday pool actually cycles", () => {
  // The property the venue noticed was missing. Ambient-tagged lines and
  // untagged ones compete together, so a fortnight should produce a
  // fortnight of different copy rather than the same handful.
  const pool: LineCandidate[] = [
    ...Array.from({ length: 10 }, (_, i) => line({ id: `e${i}` })),
    line({ id: "mon", tags: ["monday"] }),
  ];
  const seen: string[] = [];
  let clock = new Date("2026-01-05T00:00:00.000Z").getTime();
  for (let d = 0; d < 11; d++) {
    const picked = pickLine(pool, ctx({ occasions: ["monday"], calendarOccasions: [] }));
    assert.ok(picked);
    seen.push(picked!.id);
    picked!.lastUsedAt = new Date(clock);
    clock += 86400_000;
  }
  assert.equal(new Set(seen).size, 11, "every line should go out once before any repeats");
});

test("within a pool, least recently used wins, never-used first", () => {
  const a = line({ id: "a", lastUsedAt: new Date("2026-09-01") });
  const b = line({ id: "b", lastUsedAt: new Date("2026-08-01") });
  const fresh = line({ id: "c", lastUsedAt: null });
  assert.equal(pickLine([a, b, fresh], ctx())?.id, "c", "never used goes first");
  assert.equal(pickLine([a, b], ctx())?.id, "b", "then the oldest");
});

test("the whole pool cycles before anything repeats", () => {
  // The property the venue will actually notice. Walk the library
  // forward, stamping each pick, and assert every line went out once
  // before any went twice.
  const pool: LineCandidate[] = Array.from({ length: 12 }, (_, i) =>
    line({ id: `l${String(i).padStart(2, "0")}` }),
  );
  const order: string[] = [];
  let clock = new Date("2026-01-01T00:00:00.000Z").getTime();
  for (let day = 0; day < 12; day++) {
    const picked = pickLine(pool, ctx());
    assert.ok(picked, "pool should never run dry");
    order.push(picked!.id);
    picked!.lastUsedAt = new Date(clock);
    clock += 86400_000;
  }
  assert.equal(new Set(order).size, 12, "no line repeated inside one cycle");

  // ...and the 13th day comes back to the first one used.
  const next = pickLine(pool, ctx());
  assert.equal(next?.id, order[0]);
});

test("selection is deterministic — two runs on one day agree", () => {
  const pool = [line({ id: "b" }), line({ id: "a" }), line({ id: "c" })];
  assert.equal(pickLine(pool, ctx())?.id, pickLine([...pool].reverse(), ctx())?.id);
});

test("an empty or fully ineligible library returns null rather than guessing", () => {
  assert.equal(pickLine([], ctx()), null);
  assert.equal(pickLine([line({ id: "a", enabled: false })], ctx()), null);
  assert.equal(
    pickLine([line({ id: "a", tags: ["holi"] })], ctx({ occasions: ["monday"] })),
    null,
  );
});

// ── The admin's explanation ────────────────────────────────────────────

test("libraryRefusal names which of the three problems it is", () => {
  assert.match(libraryRefusal([], ctx()) ?? "", /empty/);
  assert.match(
    libraryRefusal([line({ id: "a", enabled: false })], ctx()) ?? "",
    /switched off/,
  );
  assert.match(
    libraryRefusal([line({ id: "a", tags: ["holi"] })], ctx({ occasions: ["monday"] })) ?? "",
    /No line is eligible today/,
  );
  assert.equal(libraryRefusal([line({ id: "a" })], ctx()), null);
});

test("a full evening is reported as a reason, not a crash", () => {
  const onlyClaims = [line({ id: "a", tags: [NEEDS_SLOTS] })];
  assert.match(libraryRefusal(onlyClaims, ctx({ slotsAreFree: false })) ?? "", /full evening/);
  assert.equal(libraryRefusal(onlyClaims, ctx({ slotsAreFree: true })), null);
});
