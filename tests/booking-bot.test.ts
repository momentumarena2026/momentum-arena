/**
 * Booking-bot parser + suggestion engine.
 *
 * This sits in front of a payment, so the cases below are the ones that
 * would cost a refund rather than a laugh: the wrong half of the day, a
 * range read backwards, a window that wraps past midnight, and an offer
 * made on a slot somebody else is already paying for.
 *
 * `NOW` is fixed so "tomorrow" is a fact, not a function of when CI runs.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { parseBookingText, mergeParsed, formatHourRange } from "../lib/booking-bot/parse";
import {
  isWindowFree,
  windowPrice,
  suggestAlternatives,
  firstCourtWithWindow,
  type CourtDay,
} from "../lib/booking-bot/suggest";

/** Fri 4 Sep 2026, 15:30 IST (10:00 UTC). */
const NOW = new Date("2026-09-04T10:00:00.000Z");

// ── sport ──────────────────────────────────────────────────────────
test("recognises each sport and its slang", () => {
  assert.equal(parseBookingText("book cricket", NOW).sport, "CRICKET");
  assert.equal(parseBookingText("box cricket tomorrow", NOW).sport, "CRICKET");
  assert.equal(parseBookingText("football court", NOW).sport, "FOOTBALL");
  assert.equal(parseBookingText("soccer at 7pm", NOW).sport, "FOOTBALL");
  assert.equal(parseBookingText("footy tonight", NOW).sport, "FOOTBALL");
  assert.equal(parseBookingText("pickleball", NOW).sport, "PICKLEBALL");
  assert.equal(parseBookingText("pickle ball court", NOW).sport, "PICKLEBALL");
});

test("no sport mentioned is reported as missing, never guessed", () => {
  const p = parseBookingText("tomorrow 7 to 8 pm", NOW);
  assert.equal(p.sport, null);
  assert.ok(p.missing.includes("sport"));
});

// ── the expensive one: am/pm ───────────────────────────────────────
test("explicit pm is taken literally", () => {
  const p = parseBookingText("football tomorrow 7 to 8 pm", NOW);
  assert.equal(p.startHour, 19);
  assert.equal(p.endHour, 20);
  assert.equal(p.assumedPm, false);
});

test("explicit am is honoured — the venue opens at 5", () => {
  const p = parseBookingText("cricket tomorrow 7 to 8 am", NOW);
  assert.equal(p.startHour, 7);
  assert.equal(p.endHour, 8);
  assert.equal(p.assumedPm, false);
});

test("a bare range defaults to PM but FLAGS the assumption", () => {
  // This is the single most dangerous read in the file. Defaulting is
  // acceptable only because the flag forces the bot to say so and the
  // card shows the resolved time before any money moves.
  const p = parseBookingText("football tomorrow 7 to 8", NOW);
  assert.equal(p.startHour, 19);
  assert.equal(p.endHour, 20);
  assert.equal(p.assumedPm, true, "must flag, not silently guess");
});

test("a meridiem on the end of a range applies to the start", () => {
  // "7 to 8pm" is 7pm-8pm, never 7am-8pm.
  const p = parseBookingText("cricket 7 to 8pm", NOW);
  assert.equal(p.startHour, 19);
  assert.equal(p.endHour, 20);
  assert.equal(p.assumedPm, false);
});

test("24-hour input is never re-interpreted", () => {
  const p = parseBookingText("football tomorrow 19:00-20:00", NOW);
  assert.equal(p.startHour, 19);
  assert.equal(p.endHour, 20);
  assert.equal(p.assumedPm, false);
});

test("noon and midnight are not shifted", () => {
  assert.equal(parseBookingText("cricket 12 pm", NOW).startHour, 12);
  assert.equal(parseBookingText("cricket 12 am", NOW).startHour, 0);
});

// ── ranges, durations, wrap-around ─────────────────────────────────
test("a single time books one hour", () => {
  const p = parseBookingText("football tomorrow 7pm", NOW);
  assert.equal(p.startHour, 19);
  assert.equal(p.endHour, 20);
});

test("an explicit duration is respected", () => {
  const p = parseBookingText("cricket tomorrow 7pm for 2 hours", NOW);
  assert.equal(p.startHour, 19);
  assert.equal(p.endHour, 21);
});

test("a window past midnight becomes the venue's 24/25 late hours", () => {
  // The arena runs to 1am and stores that as hour 24/25, not as the next
  // day's hour 0 — reading it as 23→1 would be a negative-length window.
  const p = parseBookingText("cricket 11pm to 1am", NOW);
  assert.equal(p.startHour, 23);
  assert.equal(p.endHour, 25);
  assert.ok(p.endHour > p.startHour, "must never invert");
});

test("separator styles all parse the same", () => {
  for (const s of ["7-8pm", "7 - 8 pm", "7 to 8 pm", "7 till 8 pm"]) {
    const p = parseBookingText(`football ${s}`, NOW);
    assert.equal(p.startHour, 19, s);
    assert.equal(p.endHour, 20, s);
  }
});

// ── dates ──────────────────────────────────────────────────────────
test("today and tomorrow resolve against IST, not the host clock", () => {
  assert.equal(parseBookingText("cricket today 7pm", NOW).date, "2026-09-04");
  assert.equal(parseBookingText("cricket tomorrow 7pm", NOW).date, "2026-09-05");
  assert.equal(parseBookingText("cricket day after tomorrow 7pm", NOW).date, "2026-09-06");
});

test("a weekday name means the NEXT one, not today", () => {
  // NOW is a Friday. "friday" must mean the 11th, not today — someone
  // booking same-day says "today".
  assert.equal(parseBookingText("cricket friday 7pm", NOW).date, "2026-09-11");
  assert.equal(parseBookingText("cricket saturday 7pm", NOW).date, "2026-09-05");
});

test("day-month forms parse, both orders", () => {
  assert.equal(parseBookingText("cricket 12 sept 7pm", NOW).date, "2026-09-12");
  assert.equal(parseBookingText("cricket sept 12 7pm", NOW).date, "2026-09-12");
  assert.equal(parseBookingText("cricket 12/9 7pm", NOW).date, "2026-09-12");
});

test("a month already gone rolls to next year", () => {
  assert.equal(parseBookingText("cricket 12 jan 7pm", NOW).date, "2027-01-12");
});

test("a time with no date means today, and says so", () => {
  const p = parseBookingText("football 7pm", NOW);
  assert.equal(p.date, "2026-09-04");
  assert.equal(p.assumedToday, true);
});

test("the full sentence from the brief parses end to end", () => {
  const p = parseBookingText("book a football court tomorrow for 7 to 8 pm", NOW);
  assert.equal(p.sport, "FOOTBALL");
  assert.equal(p.date, "2026-09-05");
  assert.equal(p.startHour, 19);
  assert.equal(p.endHour, 20);
  assert.deepEqual(p.missing, []);
});

test("gibberish asks for everything rather than inventing it", () => {
  const p = parseBookingText("hello", NOW);
  assert.deepEqual(p.missing.sort(), ["date", "sport", "time"]);
});

test("hour range formats for the confirmation card", () => {
  assert.equal(formatHourRange(19, 20), "7:00 PM – 8:00 PM");
  assert.equal(formatHourRange(7, 8), "7:00 AM – 8:00 AM");
  assert.equal(formatHourRange(23, 25), "11:00 PM – 1:00 AM");
});

// ── suggestions ────────────────────────────────────────────────────
const price = 1000;
const day = (id: string, label: string, taken: number[] = [], locked: number[] = []): CourtDay => ({
  courtConfigId: id,
  courtLabel: label,
  slots: Array.from({ length: 21 }, (_, i) => {
    const hour = i + 5; // 5am..1am, the venue's window
    const status = taken.includes(hour)
      ? ("booked" as const)
      : locked.includes(hour)
        ? ("locked" as const)
        : ("available" as const);
    return { hour, status, price };
  }),
});

test("a window is free only if every hour in it is", () => {
  const c = day("t2", "Turf 2", [20]);
  assert.equal(isWindowFree(c.slots, 19, 20), true);
  assert.equal(isWindowFree(c.slots, 19, 21), false, "20:00 is booked");
  assert.equal(windowPrice(c.slots, 19, 21), 2000);
});

test("a slot someone else is paying for is NOT offered", () => {
  // "locked" means another customer is on the payment screen. Offering it
  // risks sending two people at one slot, the second having already paid.
  const c = day("t2", "Turf 2", [], [19]);
  assert.equal(isWindowFree(c.slots, 19, 20), false);
});

test("same time on another court beats shifting the hour", () => {
  const courts = [day("t1", "Turf 1"), day("t2", "Turf 2", [19])];
  const s = suggestAlternatives(courts, { courtConfigId: "t2", startHour: 19, endHour: 20 });
  assert.equal(s[0].courtLabel, "Turf 1");
  assert.equal(s[0].startHour, 19);
  assert.equal(s[0].distanceHours, 0);
  assert.equal(s[0].differentCourt, true);
});

test("with one court, the nearest hours are offered, earlier first", () => {
  const courts = [day("t2", "Turf 2", [19])];
  const s = suggestAlternatives(courts, { courtConfigId: "t2", startHour: 19, endHour: 20 });
  assert.equal(s[0].startHour, 18, "6pm before 8pm at equal distance");
  assert.equal(s[1].startHour, 20);
});

test("suggestions never exceed the shift bound", () => {
  const courts = [day("t2", "Turf 2", [17, 18, 19, 20, 21])];
  const s = suggestAlternatives(courts, { courtConfigId: "t2", startHour: 19, endHour: 20 }, { maxShiftHours: 1 });
  assert.equal(s.length, 0, "nothing within an hour, so offer nothing");
});

test("a two-hour request only gets two free hours back", () => {
  // 18:00 free but 19:00 booked — 18-20 must not be offered.
  const courts = [day("t2", "Turf 2", [19])];
  const s = suggestAlternatives(courts, { courtConfigId: "t2", startHour: 19, endHour: 21 });
  for (const sug of s) {
    assert.equal(isWindowFree(courts[0].slots, sug.startHour, sug.endHour), true);
    assert.equal(sug.endHour - sug.startHour, 2);
  }
});

test("no court is named — take the caller's preference order, NOT the cheapest", () => {
  // Found against real staging data: cricket has a ₹2,000 full turf and a
  // ₹200 leather practice pitch. Cheapest-first answered "book a cricket
  // court" with the practice net. The caller orders by size and this must
  // honour that order even when a later court is cheaper.
  const cheapPractice = day("t9", "Leather Pitch 1");
  cheapPractice.slots = cheapPractice.slots.map((s) => ({ ...s, price: 200 }));
  const courts = [day("t1", "Full Field"), cheapPractice];
  const hit = firstCourtWithWindow(courts, 19, 20);
  assert.equal(hit?.court.courtLabel, "Full Field");
  assert.equal(hit?.price, 1000);
});

test("preference order falls through when the preferred court is busy", () => {
  const practice = day("t9", "Leather Pitch 1");
  const courts = [day("t1", "Full Field", [19]), practice];
  assert.equal(firstCourtWithWindow(courts, 19, 20)?.court.courtLabel, "Leather Pitch 1");
});

test("nothing free anywhere returns null rather than a bad offer", () => {
  const courts = [day("t2", "Turf 2", [19])];
  assert.equal(firstCourtWithWindow(courts, 19, 20), null);
});

test("a broken window is never offered as free", () => {
  // A NaN bound reached the engine once during integration testing and
  // came back as a bookable slot at ₹0 — every comparison against NaN is
  // false, so the validation loop never ran. On a payment path that is a
  // free booking, so both entry points reject it outright.
  const c = day("t2", "Turf 2");
  assert.equal(isWindowFree(c.slots, Number.NaN, Number.NaN), false);
  assert.equal(isWindowFree(c.slots, 19, Number.NaN), false);
  assert.equal(
    suggestAlternatives([c], { courtConfigId: null, startHour: Number.NaN, endHour: Number.NaN }).length,
    0,
  );
});

test("an inverted window is rejected, not silently accepted", () => {
  const c = day("t2", "Turf 2");
  assert.equal(isWindowFree(c.slots, 20, 19), false);
  assert.equal(suggestAlternatives([c], { courtConfigId: null, startHour: 20, endHour: 19 }).length, 0);
});

/**
 * Conversation memory.
 *
 * Found by driving the real app, not by any unit test: the parser is
 * stateless and correct, but the CONVERSATION was not. "football tomorrow"
 * asked for a time; tapping the "7-8 pm" chip then asked for a sport,
 * because the second message knows nothing about the first. The chip path
 * could never complete a booking — it ping-ponged forever.
 */
test("answering the bot's question keeps what it already knew", () => {
  const first = parseBookingText("football tomorrow", NOW);
  assert.deepEqual(first.missing, ["time"]);

  const second = mergeParsed(first, parseBookingText("7-8 pm", NOW));
  assert.equal(second.sport, "FOOTBALL", "sport must survive the second turn");
  assert.equal(second.date, "2026-09-05", "date must survive the second turn");
  assert.equal(second.startHour, 19);
  assert.equal(second.endHour, 20);
  assert.deepEqual(second.missing, [], "now complete — this is the bug that looped");
});

test("the other order works too — time first, then sport", () => {
  const first = parseBookingText("tomorrow 7-8 pm", NOW);
  assert.deepEqual(first.missing, ["sport"]);
  const second = mergeParsed(first, parseBookingText("Cricket", NOW));
  assert.equal(second.sport, "CRICKET");
  assert.equal(second.startHour, 19);
  assert.deepEqual(second.missing, []);
});

test("a correction overrides what was carried", () => {
  // "actually make it cricket" must win over the earlier football.
  const first = parseBookingText("football tomorrow 7-8 pm", NOW);
  const second = mergeParsed(first, parseBookingText("actually cricket", NOW));
  assert.equal(second.sport, "CRICKET");
  assert.equal(second.startHour, 19, "the rest is untouched");
});

test("a half-stated time is never assembled from two messages", () => {
  // Carrying a start from one turn and an end from another would invent a
  // window nobody asked for. Time moves as one unit or not at all.
  const carried = { ...parseBookingText("football tomorrow 7-8 pm", NOW) };
  const merged = mergeParsed(carried, parseBookingText("cricket", NOW));
  assert.equal(merged.startHour, 19);
  assert.equal(merged.endHour, 20, "both carried together, or neither");
});

test("no carried context behaves exactly like a fresh parse", () => {
  const fresh = parseBookingText("football tomorrow 7-8 pm", NOW);
  assert.deepEqual(mergeParsed(null, fresh), fresh);
});

test("a hyphenated TIME is never read as a date", () => {
  // "7-8 pm" matched the day-month pattern and became the 7th of August:
  // "football 7-8 pm" proposed a booking in 2027. The earlier separator
  // test only checked the hours, so it passed while the date was wrong.
  const p = parseBookingText("football 7-8 pm", NOW);
  assert.equal(p.startHour, 19);
  assert.equal(p.endHour, 20);
  assert.equal(p.date, "2026-09-04", "today, NOT 7 August");
  assert.equal(p.assumedToday, true);
});

test("real slash dates still parse, and zero-padded hyphen dates too", () => {
  assert.equal(parseBookingText("cricket 12/9 7pm", NOW).date, "2026-09-12");
  assert.equal(parseBookingText("cricket 12-09 7pm", NOW).date, "2026-09-12");
});

test("every separator style agrees on BOTH the hours and the date", () => {
  for (const sep of ["7-8pm", "7 - 8 pm", "7 to 8 pm", "7 till 8 pm"]) {
    const p = parseBookingText(`football tomorrow ${sep}`, NOW);
    assert.equal(p.startHour, 19, sep);
    assert.equal(p.endHour, 20, sep);
    assert.equal(p.date, "2026-09-05", `${sep} must not invent a date`);
  }
});

test("an assumed date never overrides one the customer stated", () => {
  // "7-8 pm" alone defaults to today. As an answer to "what time?" after
  // "football tomorrow", that default silently moved the booking a day
  // earlier — the customer would have paid for the wrong date.
  const first = parseBookingText("football tomorrow", NOW);
  const merged = mergeParsed(first, parseBookingText("7-8 pm", NOW));
  assert.equal(merged.date, "2026-09-05", "tomorrow, not today");
  assert.equal(merged.assumedToday, false, "nothing is being assumed any more");
});

test("but an EXPLICIT new date does override the carried one", () => {
  const first = parseBookingText("football tomorrow 7-8 pm", NOW);
  const merged = mergeParsed(first, parseBookingText("make it saturday", NOW));
  assert.equal(merged.date, "2026-09-05");
});
