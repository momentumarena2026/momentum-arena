/**
 * The gate between the model and anything real.
 *
 * A model can be wrong. That is acceptable here only because nothing it
 * says reaches availability, pricing or a hold until it has passed every
 * check below — so it can be wrong about what you MEANT, and cannot be
 * wrong in a way that costs money or books a slot that doesn't exist.
 *
 * Everything is rejected by default. Each field has to prove itself
 * against the same constraints the rest of the system already enforces:
 * the Sport enum, the 30-day horizon, the venue's 05:00-01:00 window,
 * and the maximum bookable length. A rejection is not an error — it
 * becomes a clarifying question, which is the correct answer to a
 * message we could not confidently read.
 *
 * This file is deliberately free of network, clock and database: given a
 * reading and a reference day it is a pure function, so every rejection
 * path is testable without a provider.
 */

import { Sport } from "@prisma/client";
import type { LlmReading } from "@/lib/booking-bot/llm";
import type { ParsedBooking } from "@/lib/booking-bot/parse";

/** Venue hours. 24/25 encode the post-midnight window (see parse.ts). */
const OPEN_HOUR = 5;
const CLOSE_HOUR = 25;
/** Mirrors MAX_BOOKABLE_HOURS in parse.ts. */
const MAX_HOURS = 12;

export type Validation =
  | { ok: true; parsed: ParsedBooking }
  | { ok: false; reason: string };

const SPORTS = new Set<string>(Object.values(Sport));

function isIsoDay(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * Turn a model reading into a ParsedBooking, or say why not.
 *
 * `todayIst` and `horizonIst` bound the date. They are passed in rather
 * than computed so this stays pure and so the caller's notion of "today"
 * is the single source of truth — two different answers to that question
 * inside one request is its own class of bug.
 */
export function validateLlmReading(
  reading: LlmReading | null,
  bounds: { todayIst: string; horizonIst: string },
): Validation {
  if (!reading || typeof reading !== "object") return { ok: false, reason: "no-reading" };

  // ── sport ────────────────────────────────────────────────────────
  let sport: Sport | null = null;
  if (reading.sport != null) {
    if (typeof reading.sport !== "string" || !SPORTS.has(reading.sport)) {
      // The prompt says these three exist and nothing else. A fourth is
      // the model inventing a product the venue does not sell.
      return { ok: false, reason: `bad-sport:${String(reading.sport).slice(0, 24)}` };
    }
    sport = reading.sport as Sport;
  }

  // ── date ─────────────────────────────────────────────────────────
  let date: string | null = null;
  if (reading.date != null) {
    if (!isIsoDay(reading.date)) {
      return { ok: false, reason: "bad-date-format" };
    }
    // Same window every other surface offers. A model that resolves
    // "next season" to a real-looking day must not route around the
    // 30-day horizon the slot picker enforces.
    if (reading.date < bounds.todayIst) return { ok: false, reason: "date-past" };
    if (reading.date > bounds.horizonIst) return { ok: false, reason: "date-beyond-horizon" };
    date = reading.date;
  }

  // ── hours ────────────────────────────────────────────────────────
  const s = reading.startHour;
  const e = reading.endHour;
  const hasStart = s != null;
  const hasEnd = e != null;
  let startHour: number | null = null;
  let endHour: number | null = null;

  if (hasStart !== hasEnd) {
    // Half a window is worse than none: it would be completed by a
    // default somewhere downstream and quietly become a booking nobody
    // described.
    return { ok: false, reason: "half-window" };
  }
  if (hasStart && hasEnd) {
    if (!Number.isInteger(s) || !Number.isInteger(e)) {
      return { ok: false, reason: "non-integer-hours" };
    }
    if (s! < OPEN_HOUR || e! > CLOSE_HOUR) return { ok: false, reason: "outside-venue-hours" };
    if (e! <= s!) return { ok: false, reason: "backwards-window" };
    if (e! - s! > MAX_HOURS) return { ok: false, reason: "window-too-long" };
    startHour = s!;
    endHour = e!;
  }

  // ── court size ───────────────────────────────────────────────────
  let courtSize: "HALF" | "FULL" | null = null;
  if (reading.courtSize != null) {
    if (reading.courtSize !== "HALF" && reading.courtSize !== "FULL") {
      return { ok: false, reason: "bad-court-size" };
    }
    courtSize = reading.courtSize;
  }

  const missing: ParsedBooking["missing"] = [];
  if (!sport) missing.push("sport");
  if (!date) missing.push("date");
  if (startHour == null) missing.push("time");

  return {
    ok: true,
    parsed: {
      sport,
      date,
      startHour,
      endHour,
      // The model resolves meridiems itself and is told the convention,
      // so there is no separate assumption to announce. Anything it was
      // unsure about arrives as low confidence and becomes a question
      // instead of a note on a card.
      assumedPm: false,
      assumedToday: false,
      courtSize,
      missing,
      corrections: [],
      unknown: [],
      ambiguous: [],
      unresolvedDay: false,
      // Overwritten by fillGaps from the rules' reading — whether a turn
      // contributed is a fact about the customer's message, not about
      // where the reading came from.
      contributed: true,
    },
  };
}

/**
 * Terms worth remembering, filtered.
 *
 * The model is asked for words it resolved that our vocabulary lacks.
 * Most of what comes back is noise — ordinary English, whole phrases, or
 * a word mapped to itself — and writing that into the parser's
 * vocabulary would degrade it. Only single, short, alphabetic terms with
 * a different canonical form survive, and even those land unapproved.
 */
export function usefulTerms(
  learned: unknown,
  known: Set<string>,
): { term: string; canonical: string }[] {
  if (!Array.isArray(learned)) return [];
  const out: { term: string; canonical: string }[] = [];
  for (const item of learned.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    const term = String((item as { term?: unknown }).term ?? "").toLowerCase().trim();
    const canonical = String((item as { canonical?: unknown }).canonical ?? "")
      .toLowerCase()
      .trim();
    if (!/^[a-z]{3,20}$/.test(term)) continue;
    if (!/^[a-z]{3,20}$/.test(canonical)) continue;
    if (term === canonical) continue;
    if (known.has(term)) continue;
    out.push({ term, canonical });
  }
  return out;
}
