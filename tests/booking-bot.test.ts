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

import {
  parseBookingText,
  mergeParsed,
  formatHourRange,
  fillGaps,
  VOCABULARY,
} from "../lib/booking-bot/parse";
import { spellcheck, editDistance } from "../lib/booking-bot/fuzzy";
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

test("an impossible duration asks, it does not quietly shrink", () => {
  // "6am for 20 hours" fell through the duration branch into the
  // single-hour branch and came back as 6-7 AM: the customer asked for
  // twenty hours, would have been quoted one, and the price looked
  // plausible enough to pay. Found by running the scenario matrix.
  const p = parseBookingText("football tomorrow 6am for 20 hours", NOW);
  assert.equal(p.startHour, null);
  assert.equal(p.endHour, null);
  assert.ok(p.missing.includes("time"), "must ask rather than assume 1 hour");
});

test("durations inside the limit still work", () => {
  for (const [h, end] of [[1, 20], [2, 21], [12, 31]] as const) {
    const p = parseBookingText(`football tomorrow 7pm for ${h} hours`, NOW);
    assert.equal(p.startHour, 19, `${h}h`);
    assert.equal(p.endHour, end, `${h}h`);
  }
});

/**
 * Findings from an independent tester who had never seen the code.
 * Both of these silently sold something other than what was typed.
 */
test("a backwards range asks instead of silently flipping", () => {
  // Typed "8 to 7 pm" (meaning 6-7, fat-fingered). The range was rejected
  // for being backwards, then the SINGLE-time branch matched the trailing
  // "7 pm" and quietly booked 7-8 PM. The customer would never have known
  // the app chose a different hour than the one they asked for.
  const p = parseBookingText("football tomorrow 8 to 7 pm", NOW);
  assert.equal(p.startHour, null);
  assert.equal(p.endHour, null);
  assert.ok(p.missing.includes("time"));
});

test("a genuine overnight range still works", () => {
  // The fix must not break "11pm to 1am", where the meridiems differ and
  // wrapping past midnight is exactly what was meant.
  const p = parseBookingText("cricket tomorrow 11pm to 1am", NOW);
  assert.equal(p.startHour, 23);
  assert.equal(p.endHour, 25);
});

test("a bare '11 to 1' is genuinely ambiguous, so it asks", () => {
  // No meridiem, so both ends default to PM: 23 to 13, which is nonsense.
  // 11am-1pm and 11pm-1am are both plausible and the text cannot settle
  // it, so asking beats guessing on a payment path.
  const p = parseBookingText("cricket tomorrow 11 to 1", NOW);
  assert.equal(p.startHour, null);
  assert.ok(p.missing.includes("time"));
});

test("spelling out the meridiems resolves that ambiguity", () => {
  const am = parseBookingText("cricket tomorrow 11 am to 1 pm", NOW);
  assert.equal(am.startHour, 11);
  assert.equal(am.endHour, 13);
});

test("yesterday parses as yesterday, not as today", () => {
  // Unrecognised, "yesterday 5 to 6 pm" fell through to today-by-default
  // and the tester was offered today's slots with no indication the day
  // had changed under them.
  const p = parseBookingText("cricket yesterday 5 to 6 pm", NOW);
  assert.equal(p.date, "2026-09-03", "the day before NOW");
  assert.equal(p.assumedToday, false);
});

test("an unavailable slot does not erase the sport and day", () => {
  // Reported from use: "cricket tomorrow 4am" comes back unavailable with
  // alternatives, and answering "6am" then asked for the sport and date
  // again — the client only carried context on a "needs" reply, not on
  // "taken". A slot being taken does not un-say what you asked for.
  const first = parseBookingText("cricket tomorrow 4 am", NOW);
  assert.deepEqual(first.missing, [], "fully specified, just unavailable");

  const second = mergeParsed(first, parseBookingText("6 am", NOW));
  assert.equal(second.sport, "CRICKET");
  assert.equal(second.date, "2026-09-05");
  assert.equal(second.startHour, 6);
  assert.deepEqual(second.missing, []);
});

/**
 * Refining a proposal. Reported from use: shown a full field and
 * answering "no only half court" threw the entire conversation away.
 */
test("a refinement after a proposal keeps everything already said", () => {
  const offered = parseBookingText("cricket tomorrow 7 to 8 pm", NOW);
  assert.deepEqual(offered.missing, []);

  // The reply carries no sport, no day, no time — only a preference.
  const refined = mergeParsed(offered, parseBookingText("no only half court", NOW));
  assert.equal(refined.sport, "CRICKET", "sport must survive");
  assert.equal(refined.date, "2026-09-05", "day must survive");
  assert.equal(refined.startHour, 19, "time must survive");
  assert.equal(refined.courtSize, "HALF", "and the preference registers");
  assert.deepEqual(refined.missing, [], "not back to square one");
});

test("court size is understood, and is optional", () => {
  assert.equal(parseBookingText("cricket tomorrow 7pm half court", NOW).courtSize, "HALF");
  assert.equal(parseBookingText("cricket tomorrow 7pm full field", NOW).courtSize, "FULL");
  // Most people never say one, and must never be asked for it.
  const plain = parseBookingText("cricket tomorrow 7pm", NOW);
  assert.equal(plain.courtSize, null);
  assert.deepEqual(plain.missing, []);
});

test("switching the preference back to full works too", () => {
  const half = parseBookingText("cricket tomorrow 7pm half court", NOW);
  const full = mergeParsed(half, parseBookingText("actually full field", NOW));
  assert.equal(full.courtSize, "FULL");
  assert.equal(full.startHour, 19);
});

/**
 * Digit ranges are ambiguous between a time and a day-month. Reported
 * from the app: "next thursday 8-10 pm" answered "I can only book 30 days
 * ahead", because "8-10" was read as the 8th of October.
 */
test("'8-10 pm' is a time, not the 8th of October", () => {
  const p = parseBookingText("book cricket for next thursday 8-10 pm", NOW);
  assert.equal(p.startHour, 20);
  assert.equal(p.endHour, 22);
  assert.equal(p.date, "2026-09-10", "next Thursday, not October");
});

test("the typo'd weekday still gets a sensible answer", () => {
  // The reported message had "turhsday". The weekday is unreadable, so the
  // date falls back to today — but the TIME must still be a time, and the
  // request must not be rejected as out of range.
  const p = parseBookingText("book cricket for next turhsday 8-10 pm", NOW);
  assert.equal(p.startHour, 20);
  assert.equal(p.endHour, 22);
  assert.equal(p.date, "2026-09-04", "today, not 8 October");
  assert.equal(p.assumedToday, true);
});

test("a real date beside a time still parses, both intact", () => {
  const p = parseBookingText("cricket 12/9 8-10 pm", NOW);
  assert.equal(p.date, "2026-09-12");
  assert.equal(p.startHour, 20);
  assert.equal(p.endHour, 22);
});

test("a bare hyphen date with no time is still a date", () => {
  const p = parseBookingText("cricket 12-09", NOW);
  assert.equal(p.date, "2026-09-12");
});

// ── spelling tolerance ─────────────────────────────────────────────
//
// The reported failure was "book cricket for next turhsday 8-10 pm".
// Two separate defects met in it: "8-10" parsed as a date (above), and
// "turhsday" matched no weekday. These cover the second.

test("ordinary misspellings are corrected and reported", () => {
  const p = parseBookingText("book footbal tomorow 7 to 8 pm", NOW);
  assert.equal(p.sport, "FOOTBALL");
  assert.equal(p.date, "2026-09-05");
  assert.equal(p.startHour, 19);
  assert.deepEqual(p.corrections, [
    { from: "footbal", to: "football" },
    { from: "tomorow", to: "tomorrow" },
  ]);
});

test("a correction is never silent — the bot has to be able to say it", () => {
  // The whole safety argument for tolerant matching is that a wrong
  // correction costs one tap because it is shown. If corrections ever
  // stop being reported, that argument is gone.
  const p = parseBookingText("criket saturdy 7 pm", NOW);
  assert.equal(p.sport, "CRICKET");
  assert.ok(p.corrections.some((c) => c.from === "saturdy" && c.to === "saturday"));
});

test("an equidistant word is ASKED about, never guessed", () => {
  // "turhsday" is exactly 2 edits from thursday AND from tuesday. This is
  // the case where picking one is the worst option: the customer gets a
  // confident proposal on a day they never asked for.
  const p = parseBookingText("book cricket for next turhsday 8-10 pm", NOW);
  assert.equal(p.corrections.length, 0, "must not silently correct a tie");
  assert.equal(p.ambiguous.length, 1);
  assert.equal(p.ambiguous[0].word, "turhsday");
  assert.deepEqual(p.ambiguous[0].options.slice().sort(), ["thursday", "tuesday"]);
});

test("two spellings of ONE day are not an ambiguity", () => {
  // "sat" and "saturday" are two vocabulary entries and one meaning.
  // Judging ties on spelling rather than meaning would ask the customer
  // to choose between Saturday and Saturday.
  for (const word of ["saturdy", "saterday", "satuday"]) {
    const p = parseBookingText(`cricket ${word} 7 pm`, NOW);
    assert.equal(p.ambiguous.length, 0, word);
    assert.equal(p.date, "2026-09-05", word);
  }
});

test("a word matching nothing is named back to the customer", () => {
  // "Tell me which sport" is a useless reply to a message that already
  // named one. The unknown word is what the bot needs in order to say
  // something the customer can act on.
  const p = parseBookingText("book bskteball tomorrow 7 pm", NOW);
  assert.equal(p.sport, null);
  assert.deepEqual(p.missing, ["sport"]);
  assert.deepEqual(p.unknown, ["bskteball"]);
});

test("ordinary chat filler is not treated as an unrecognised word", () => {
  // `unknown` drives escalation to the comprehension layer, so filler
  // landing in it would spend a model call on "yaar".
  const p = parseBookingText("lets book cricket tomorrow 7 pm yaar", NOW);
  assert.deepEqual(p.missing, []);
  assert.deepEqual(p.unknown, []);
});

test("unrecognised words are reported even when nothing is missing", () => {
  // The circular gate that let a gibberish message through: `unknown`
  // used to be emptied whenever `missing` was empty, and the route used
  // `unknown` to decide whether to escalate. A sentence that completed
  // itself from carried context therefore never got a second opinion.
  const carried = parseBookingText("cricket tomorrow 7 pm", NOW);
  const merged = mergeParsed(carried, parseBookingText("minh sham bake", NOW));
  assert.deepEqual(merged.missing, [], "context filled every field");
  assert.ok(merged.unknown.length > 0, "and the gibberish is still reported");
});

/**
 * The guard that keeps the corrector from doing harm.
 *
 * Fuzzy matching is only safe while it leaves correct input alone. "day"
 * sits ONE edit from "may", and an early version rewrote "day after
 * tomorrow" to "may after tomorrow" — the phrase stopped matching and the
 * bot booked tomorrow instead, a whole day wrong. Any future widening of
 * the vocabulary or the edit budget has to keep this list untouched.
 */
test("correct sentences pass through the corrector unchanged", () => {
  const corpus = [
    "book a cricket court tomorrow 7 to 8 pm",
    "football day after tomorrow 6-7 pm",
    "i want the full field on saturday night 9 pm",
    "pickleball today 6 am for 2 hours",
    "half court cricket next friday 8 to 10 pm",
    "book me a slot at 7pm tomorrow for football",
    "cricket 12/9 7 pm please",
    "футбол" .normalize(), // non-latin passes through untouched
  ];
  for (const line of corpus) {
    const r = spellcheck(line, VOCABULARY);
    assert.equal(r.text, line, `corrupted: ${line}`);
    assert.deepEqual(r.corrections, [], `spurious correction in: ${line}`);
  }
});

test("edit distance abandons work once the budget is blown", () => {
  assert.equal(editDistance("thursday", "thursday", 3), 0);
  assert.equal(editDistance("turhsday", "thursday", 3), 2, "insert an h, delete the stray one");
  assert.equal(editDistance("cricket", "football", 2), 3, "over budget → max+1");
});

/**
 * VOCABULARY mirrors the parser's own tables and regexes. A canonical
 * form the parsers no longer recognise would mean corrections rewrite
 * words INTO something unparseable — the corrector would quietly make
 * messages worse. This is the parity test CLAUDE.md requires for any
 * pair of files that must stay in sync.
 */
test("every canonical vocabulary form is still parseable", () => {
  const canonical = [...new Set(VOCABULARY.map((v) => v.canonical))];
  for (const word of canonical) {
    // Size words are deliberately only meaningful with their noun —
    // parseCourtSize wants "half court", not a bare "half", so that a
    // stray adjective can't silently downgrade a booking. Give them one.
    const phrase = ["half", "full"].includes(word) ? `${word} court` : word;
    // Month names need a day number to mean anything, which is the
    // parser's rule, not this test's.
    const withDay = /^(january|february|march|april|may|june|july|august|september|october|november|december)$/.test(word)
      ? `12 ${phrase}`
      : phrase;
    const p = parseBookingText(`${withDay} 7 pm`, NOW);
    const recognised =
      p.sport != null ||
      p.courtSize != null ||
      // A day or month name resolves to a date other than the "no date
      // given, assume today" fallback.
      !p.assumedToday;
    assert.ok(recognised, `"${word}" is in VOCABULARY but nothing parses it`);
  }
});

// ── separator tolerance ────────────────────────────────────────────

test("the same window written five ways parses identically", () => {
  // None of these is more correct than the others, and every one the
  // parser refuses is a customer who thinks the feature is broken.
  for (const w of ["7-8 pm", "7 to 8 pm", "7/8 pm", "7~8 pm", "7 till 8 pm"]) {
    const p = parseBookingText(`football tomorrow ${w}`, NOW);
    assert.equal(p.startHour, 19, w);
    assert.equal(p.endHour, 20, w);
    assert.equal(p.date, "2026-09-05", w);
  }
});

test("a slash between bare numbers is still a date, not a time", () => {
  // The cost of accepting "/" as a range separator: "12/9" would read as
  // noon-to-9pm, which fits inside the bookable window, so nothing
  // downstream would have caught it.
  const p = parseBookingText("football 12/9 7 pm", NOW);
  assert.equal(p.date, "2026-09-12");
  assert.equal(p.startHour, 19);
  assert.equal(p.endHour, 20);
});

/**
 * "Book cricket next San 1-2" came back as a confident proposal for
 * TODAY at 1 PM. Three failures stacked: "San" was below the correction
 * floor so it vanished without a word, no date resolved, and the parser
 * fell back to today with only a mild "assuming today" note — one tap
 * from a booking on the wrong day.
 */
test("a named day that didn't resolve is asked about, not assumed away", () => {
  const p = parseBookingText("book cricket next San 1-2", NOW);
  assert.equal(p.unresolvedDay, true, '"next" means a day was named');
  assert.deepEqual(p.unknown, ["San"], "the word that defeated it is reported");
});

test("saying nothing about a day still defaults to today", () => {
  // The distinction that makes the rule safe: today is a fair assumption
  // when no day was mentioned at all, and only then.
  const p = parseBookingText("book cricket 7 to 8 pm", NOW);
  assert.equal(p.unresolvedDay, false);
  assert.equal(p.assumedToday, true);
  assert.equal(p.date, "2026-09-04");
});

test("a day that DID resolve is never treated as unresolved", () => {
  for (const line of ["cricket next friday 7 pm", "cricket next week friday 7 pm"]) {
    const p = parseBookingText(line, NOW);
    assert.equal(p.unresolvedDay, false, line);
    assert.equal(p.date, "2026-09-11", line);
  }
});

test("an answer from an earlier turn settles an unresolved day", () => {
  const first = parseBookingText("book cricket next San 1-2", NOW);
  assert.equal(first.unresolvedDay, true);
  const merged = mergeParsed(first, parseBookingText("sunday", NOW));
  assert.equal(merged.unresolvedDay, false, "the question has been answered");
  assert.equal(merged.date, "2026-09-06");
  assert.equal(merged.startHour, 13, "the time survives the correction");
});

// ── the model fills gaps; it does not overrule the rules ───────────

/**
 * Found on device, and the worst failure of the lot: the rules read
 * "monday ko kardo shaam ko 8-9 cricket" perfectly — Monday the 7th,
 * 20:00-21:00 — and the model, handed the previous turn's context,
 * echoed that context back as Sunday the 6th, 19:00-20:00. A plain merge
 * treated the model as the fresher source and replaced three correct
 * fields with three wrong ones, then offered it ready to pay.
 */
test("an explicit rule reading survives a contradicting model reading", () => {
  const rules = parseBookingText("monday ko shaam ko 8-9 cricket", NOW);
  assert.equal(rules.date, "2026-09-07", "precondition: rules read Monday");
  assert.equal(rules.startHour, 20);

  const model = { ...rules, date: "2026-09-06", startHour: 19, endHour: 20 };
  const out = fillGaps(rules, model);

  assert.equal(out.date, "2026-09-07", "the customer said Monday");
  assert.equal(out.startHour, 20, "and said 8-9");
  assert.equal(out.endHour, 21);
});

test("the model fills what the rules could not read", () => {
  const rules = parseBookingText("cricket kal shaam", NOW);
  assert.ok(rules.startHour == null, "precondition: rules find no time");
  const model = { ...rules, date: "2026-09-05", startHour: 18, endHour: 20 };
  const out = fillGaps(rules, model);
  assert.equal(out.startHour, 18, "the gap is the model's to fill");
  assert.equal(out.endHour, 20);
  assert.deepEqual(out.missing, []);
});

test("a date the rules only ASSUMED is the model's to correct", () => {
  // assumedToday is the rules admitting they guessed. That is precisely
  // the case the model was brought in for, so it must win there.
  const rules = parseBookingText("cricket 7 pm", NOW);
  assert.equal(rules.assumedToday, true);
  const out = fillGaps(rules, { ...rules, date: "2026-09-09", assumedToday: false });
  assert.equal(out.date, "2026-09-09");
  assert.equal(out.assumedToday, false, "no longer an assumption");
});

test("the rules' own doubts are not erased by a confident model", () => {
  // "mundy" is equidistant from Monday and Sunday. The model answered
  // Sunday with high confidence, the flag was dropped in the merge, and
  // the question never reached the customer — a silent booking on the
  // wrong day.
  const rules = parseBookingText("mundy ko 7-8 cricket", NOW);
  assert.equal(rules.ambiguous.length, 1, "precondition: rules are unsure");
  const out = fillGaps(rules, { ...rules, date: "2026-09-06", ambiguous: [] });
  assert.equal(out.ambiguous.length, 1, "still unsure, so still asks");
});

test("a half window from the model is refused, not spliced in", () => {
  const rules = parseBookingText("cricket tomorrow", NOW);
  const out = fillGaps(rules, { ...rules, startHour: 19, endHour: null });
  assert.equal(out.startHour, null, "half a window invents the other half");
  assert.ok(out.missing.includes("time"));
});
