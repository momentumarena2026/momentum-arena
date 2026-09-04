/**
 * The gate between a probabilistic component and a payment.
 *
 * The model is allowed to be wrong about what the customer MEANT. It is
 * not allowed to be wrong in a way that reaches availability, pricing or
 * a hold. Every case below is a value a language model can plausibly
 * emit — a fourth sport, a date past the horizon, a backwards window —
 * and every one of them must be refused rather than partially adopted.
 *
 * These run with no API key and no network: validation is a pure
 * function of a reading and a pair of date bounds, which is exactly why
 * it can be trusted as the gate.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { validateLlmReading, usefulTerms } from "../lib/booking-bot/validate";
import { normalizeMessage } from "../lib/booking-bot/learn";
import type { LlmReading } from "../lib/booking-bot/llm";

const BOUNDS = { todayIst: "2026-09-04", horizonIst: "2026-10-04" };

const good = (over: Partial<LlmReading> = {}): LlmReading => ({
  sport: "CRICKET" as LlmReading["sport"],
  date: "2026-09-10",
  startHour: 19,
  endHour: 21,
  courtSize: null,
  confidence: "high",
  clarify: null,
  learned: [],
  ...over,
});

test("a clean reading passes through", () => {
  const v = validateLlmReading(good(), BOUNDS);
  assert.equal(v.ok, true);
  if (!v.ok) return;
  assert.equal(v.parsed.sport, "CRICKET");
  assert.equal(v.parsed.date, "2026-09-10");
  assert.deepEqual(v.parsed.missing, []);
});

test("a sport the venue does not sell is refused", () => {
  // Models invent plausible neighbours. The venue runs three sports.
  for (const sport of ["TENNIS", "BADMINTON", "cricket", "", "CRICKET "]) {
    const v = validateLlmReading(good({ sport: sport as LlmReading["sport"] }), BOUNDS);
    assert.equal(v.ok, false, sport);
  }
});

test("a date outside the bookable window is refused", () => {
  // The 30-day horizon protects pricing changes and seasonal closures.
  // A model resolving "next season" to a real-looking day must not
  // route around what every other surface enforces.
  assert.equal(validateLlmReading(good({ date: "2026-12-25" }), BOUNDS).ok, false);
  assert.equal(validateLlmReading(good({ date: "2026-09-03" }), BOUNDS).ok, false);
  assert.equal(validateLlmReading(good({ date: "10-09-2026" }), BOUNDS).ok, false);
  assert.equal(validateLlmReading(good({ date: "next friday" as string }), BOUNDS).ok, false);
});

test("a window the venue cannot sell is refused", () => {
  assert.equal(validateLlmReading(good({ startHour: 2, endHour: 4 }), BOUNDS).ok, false, "before open");
  assert.equal(validateLlmReading(good({ startHour: 20, endHour: 30 }), BOUNDS).ok, false, "past close");
  assert.equal(validateLlmReading(good({ startHour: 21, endHour: 19 }), BOUNDS).ok, false, "backwards");
  assert.equal(validateLlmReading(good({ startHour: 19, endHour: 19 }), BOUNDS).ok, false, "zero length");
  assert.equal(validateLlmReading(good({ startHour: 6, endHour: 24 }), BOUNDS).ok, false, "too long");
  assert.equal(validateLlmReading(good({ startHour: 19.5 as number, endHour: 21 }), BOUNDS).ok, false, "fractional");
});

test("half a window is refused rather than completed", () => {
  // A lone startHour would be finished off by a default somewhere
  // downstream and quietly become a booking nobody described.
  assert.equal(validateLlmReading(good({ endHour: null }), BOUNDS).ok, false);
  assert.equal(validateLlmReading(good({ startHour: null }), BOUNDS).ok, false);
});

test("a partial reading is allowed — it just becomes a question", () => {
  // Not knowing is fine. Inventing is not. A null field lands in
  // `missing` and the bot asks.
  const v = validateLlmReading(good({ sport: null, date: null }), BOUNDS);
  assert.equal(v.ok, true);
  if (!v.ok) return;
  assert.deepEqual(v.parsed.missing.sort(), ["date", "sport"]);
});

test("nothing at all is refused, not treated as empty", () => {
  assert.equal(validateLlmReading(null, BOUNDS).ok, false);
  assert.equal(validateLlmReading(undefined as never, BOUNDS).ok, false);
});

test("a rejected reading never carries assumption flags", () => {
  // The model resolves meridiems itself, so there is no assumption to
  // announce — and a flag set here would put a note on a card claiming
  // the rule parser had guessed something it never saw.
  const v = validateLlmReading(good(), BOUNDS);
  assert.equal(v.ok, true);
  if (!v.ok) return;
  assert.equal(v.parsed.assumedPm, false);
  assert.equal(v.parsed.assumedToday, false);
  assert.equal(v.parsed.unresolvedDay, false);
});

// ── learned vocabulary ─────────────────────────────────────────────

test("only real, novel single words are remembered", () => {
  const known = new Set(["cricket", "evening"]);
  const terms = usefulTerms(
    [
      { term: "shaam", canonical: "evening" },     // keep
      { term: "cricket", canonical: "cricket" },   // already known
      { term: "turf", canonical: "turf" },         // maps to itself
      { term: "kal shaam", canonical: "tomorrow" },// a phrase, not a word
      { term: "a", canonical: "evening" },         // too short
      { term: "x".repeat(40), canonical: "evening" }, // absurd
      { term: "SUBAH", canonical: "Morning" },     // case-normalised, keep
      "nonsense",                                   // not an object
    ],
    known,
  );
  assert.deepEqual(terms, [
    { term: "shaam", canonical: "evening" },
    { term: "subah", canonical: "morning" },
  ]);
});

test("garbage in the learned field is ignored, not thrown on", () => {
  assert.deepEqual(usefulTerms(null, new Set()), []);
  assert.deepEqual(usefulTerms("nope" as never, new Set()), []);
  assert.deepEqual(usefulTerms([null, undefined, 5] as never, new Set()), []);
});

// ── cache key ──────────────────────────────────────────────────────

test("phrasings that differ only in noise share a cache key", () => {
  const a = normalizeMessage("Book Cricket tomorrow, 7-8 PM!!");
  const b = normalizeMessage("  book   cricket tomorrow 7-8 pm ");
  assert.equal(a, b);
});

test("the cache key keeps what actually distinguishes a booking", () => {
  assert.notEqual(normalizeMessage("cricket 7-8 pm"), normalizeMessage("cricket 8-9 pm"));
  assert.notEqual(normalizeMessage("cricket tomorrow"), normalizeMessage("cricket today"));
  // Relative words are deliberately left in rather than resolved: the
  // caller scopes the cache per IST day, so "tomorrow" cached today
  // must never be served tomorrow.
  assert.match(normalizeMessage("cricket tomorrow 7 pm"), /tomorrow/);
});
