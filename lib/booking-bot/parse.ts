/**
 * Natural-language parsing for the booking bot.
 *
 * "book a football court tomorrow 7 to 8 pm"
 *   → { sport: FOOTBALL, date: 2026-09-05, startHour: 19, endHour: 20 }
 *
 * ── The rule this file exists to enforce ─────────────────────────────
 *
 * A parse result is a PROPOSAL, never a booking. Nothing here reserves a
 * slot or moves money. The bot renders what it understood as a card the
 * customer confirms, so a misread costs one tap instead of a refund on a
 * court nobody wanted. Every ambiguity below is therefore resolved to a
 * *best guess plus a flag*, not to a question — the card shows the guess
 * in full, and the flag tells the bot to say it out loud.
 *
 * ── Why a hand-written parser and not an LLM ─────────────────────────
 *
 * The domain is three sports, a date and an hour range. That is small
 * enough to enumerate and exhaustively test, which matters more here than
 * phrasing coverage: this sits in front of a payment. It also runs with no
 * network call, no per-message cost, and no third-party dependency — which
 * is the arena's stated preference. When confidence is low the bot falls
 * back to chips rather than guessing, so the failure mode is one extra tap.
 *
 * Runs SERVER-side on purpose. One implementation, testable under
 * node:test, improvable without shipping an app update — and no second
 * copy in apps/mobile to keep in sync.
 */

import { Sport } from "@prisma/client";
import { istDateKey, toIst } from "@/lib/ist";

export type ParsedBooking = {
  sport: Sport | null;
  /** IST calendar day, "YYYY-MM-DD". */
  date: string | null;
  /** 24h, venue-relative. 24/25 mean the post-midnight late window. */
  startHour: number | null;
  /** Exclusive. 19→20 is a single 7-8pm hour. */
  endHour: number | null;
  /**
   * "7 to 8" with no am/pm. Resolved to PM (see resolveMeridiem) but
   * flagged so the bot can offer the other reading in one tap.
   */
  assumedPm: boolean;
  /** The date wasn't stated; today was assumed. */
  assumedToday: boolean;
  /**
   * A court-size preference, when one was stated.
   *
   * Cricket runs a full turf and two half-courts at different prices, so
   * "half court" is a real instruction. Before this the words were simply
   * dropped and the bot answered "no, only half court" with the full
   * field again, as though nothing had been said — worse than asking.
   */
  courtSize: "HALF" | "FULL" | null;
  /** What still has to be asked for. Empty = ready to price. */
  missing: ("sport" | "date" | "time")[];
};

const SPORT_WORDS: [RegExp, Sport][] = [
  // Longest/most specific first — "box cricket" must not match on "box".
  [/\b(box\s*cricket|cricket|kricket)\b/i, Sport.CRICKET],
  [/\b(football|foot\s*ball|soccer|footy|futsal)\b/i, Sport.FOOTBALL],
  [/\b(pickle\s*ball|pickle|pickel\s*ball)\b/i, Sport.PICKLEBALL],
];

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

/** "2026-09-05" from an IST-day offset relative to `now`. */
function dayKeyFromOffset(now: Date, days: number): string {
  const ist = toIst(now);
  ist.setUTCDate(ist.getUTCDate() + days);
  return ist.toISOString().slice(0, 10);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * A bare hour with no am/pm.
 *
 * The venue runs 5am to 1am, so both readings are legal and the text
 * cannot settle it. Default to PM for 1-11 because that is where the
 * demand is — evening is the arena's peak by a wide margin, and a
 * customer typing "7" at any hour of the day almost always means 7pm.
 * 12 stays noon; anything already 13+ is unambiguous.
 *
 * The guess is always surfaced (`assumedPm`) rather than hidden, which is
 * what makes defaulting acceptable at all.
 */
function resolveMeridiem(
  hour: number,
  meridiem: "am" | "pm" | null,
): { hour: number; assumed: boolean } {
  if (meridiem === "am") return { hour: hour === 12 ? 0 : hour, assumed: false };
  if (meridiem === "pm") return { hour: hour === 12 ? 12 : hour + 12, assumed: false };
  if (hour >= 13) return { hour, assumed: false };
  if (hour === 12) return { hour: 12, assumed: false };
  if (hour >= 1 && hour <= 11) return { hour: hour + 12, assumed: true };
  return { hour, assumed: false }; // 0 = midnight, already explicit
}

/** "half court", "full field", "medium" — a size, not a sport. */
function parseCourtSize(text: string): "HALF" | "FULL" | null {
  if (/\b(half\s*(court|field|pitch)?|medium|aadha)\b/i.test(text)) return "HALF";
  if (/\b(full\s*(court|field|ground|pitch)|whole\s*(court|field)|poora)\b/i.test(text)) return "FULL";
  return null;
}

function parseSport(text: string): Sport | null {
  for (const [re, sport] of SPORT_WORDS) if (re.test(text)) return sport;
  return null;
}

function parseDate(text: string, now: Date): { date: string | null; assumedToday: boolean } {
  if (/\bday\s*after\s*tomorrow\b/i.test(text)) return { date: dayKeyFromOffset(now, 2), assumedToday: false };
  if (/\b(tomorrow|tmrw|tmr|kal)\b/i.test(text)) return { date: dayKeyFromOffset(now, 1), assumedToday: false };
  if (/\b(today|tonight|aaj)\b/i.test(text)) return { date: dayKeyFromOffset(now, 0), assumedToday: false };
  // Recognised ONLY so the route can say "that has passed". Unparsed, it
  // fell through to the today-by-default branch and a tester asking for
  // "yesterday 5 to 6 pm" was quietly offered slots on today instead.
  if (/\b(yesterday|kal\s+tha|beeta)\b/i.test(text)) return { date: dayKeyFromOffset(now, -1), assumedToday: false };
  if (/\bday\s*before\s*yesterday\b/i.test(text)) return { date: dayKeyFromOffset(now, -2), assumedToday: false };

  // Weekday name → the NEXT such day. "monday" said on a Monday means the
  // Monday coming, not today: someone booking same-day says "today".
  const wd = text.match(/\b(next\s+)?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thu|friday|fri|saturday|sat)\b/i);
  if (wd) {
    const target = WEEKDAYS[wd[2].toLowerCase()];
    const todayDow = toIst(now).getUTCDay();
    let delta = (target - todayDow + 7) % 7;
    if (delta === 0) delta = 7;
    if (wd[1]) delta = delta <= 7 ? delta : delta; // "next monday" == the coming Monday here
    return { date: dayKeyFromOffset(now, delta), assumedToday: false };
  }

  // "12 sept", "sept 12", "12 september"
  const dm = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b/i)
    ?? text.match(/\b(?:(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+(\d{1,2})(?:st|nd|rd|th)?)\b/i);
  if (dm) {
    const isDayFirst = /^\d/.test(dm[1]);
    const day = Number(isDayFirst ? dm[1] : dm[2]);
    const mon = MONTHS[(isDayFirst ? dm[2] : dm[1]).toLowerCase()];
    if (day >= 1 && day <= 31 && mon != null) {
      const istNow = toIst(now);
      let year = istNow.getUTCFullYear();
      // A month already past this year means they mean next year.
      if (mon < istNow.getUTCMonth()) year += 1;
      return { date: `${year}-${pad(mon + 1)}-${pad(day)}`, assumedToday: false };
    }
  }

  // "12/9" or "12-09" — day first, Indian convention.
  //
  // A hyphen only counts when the month is zero-padded ("12-09"), because
  // "7-8 pm" is a TIME and the naive pattern read it as the 7th of August:
  // "football 7-8 pm" proposed a booking in August 2027. Caught on device.
  // A slash is unambiguous, so "12/9" still works either way.
  const slash =
    text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/) ??
    text.match(/\b(\d{1,2})-(\d{2})(?:-(\d{2,4}))?\b/);
  if (slash) {
    const day = Number(slash[1]);
    const mon = Number(slash[2]) - 1;
    if (day >= 1 && day <= 31 && mon >= 0 && mon <= 11) {
      const istNow = toIst(now);
      let year = slash[3] ? Number(slash[3]) : istNow.getUTCFullYear();
      if (year < 100) year += 2000;
      if (!slash[3] && mon < istNow.getUTCMonth()) year += 1;
      return { date: `${year}-${pad(mon + 1)}-${pad(day)}`, assumedToday: false };
    }
  }

  return { date: null, assumedToday: false };
}

/**
 * The longest single booking the bot will quote. The venue's own window is
 * 5am-1am (20 hours), but a request longer than this is far more likely a
 * typo than a genuine all-day hire, and an all-day hire is a conversation
 * with the venue rather than a chat message.
 */
const MAX_BOOKABLE_HOURS = 12;

type TimeParse = { startHour: number; endHour: number; assumedPm: boolean } | null;

function parseTime(text: string): TimeParse {
  const t = text.toLowerCase();

  // 1. Explicit range: "7-8pm", "7 to 8 pm", "7pm to 8pm", "19:00-20:00"
  const range = t.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|till|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/,
  );
  if (range) {
    const endMer = (range[6] as "am" | "pm" | undefined) ?? null;
    // "7 to 8pm" — the meridiem on the end applies to the start too.
    const startMer = (range[3] as "am" | "pm" | undefined) ?? endMer ?? null;
    const s = resolveMeridiem(Number(range[1]), startMer);
    const e = resolveMeridiem(Number(range[4]), endMer ?? startMer);
    let endHour = e.hour;
    // "11pm to 1am" wraps past midnight; the venue models that as 24/25.
    // But only when the END has its own am/pm, or neither side does — an
    // explicit "8 to 7 pm" is a typo, not a booking until 7am tomorrow.
    const bothPm = startMer != null && endMer != null && startMer === endMer;
    if (endHour <= s.hour) {
      if (bothPm) {
        // "8 to 7 pm" — same meridiem, backwards. A tester typed exactly
        // this and the parser silently sold them 7-8 PM: it fell through
        // to the single-time branch, which matched the "7 pm" at the end.
        // Somebody who meant 6-7 and typed 8-7 would never have known.
        return null;
      }
      endHour += 24;
    }
    if (endHour - s.hour > 0 && endHour - s.hour <= MAX_BOOKABLE_HOURS) {
      return { startHour: s.hour, endHour, assumedPm: s.assumed || e.assumed };
    }
    // An explicit range we cannot honour must not fall through to the
    // single-time branch and quietly become something else.
    return null;
  }

  // 2. Single time + explicit duration: "7pm for 2 hours"
  const dur = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:for\s+)?(\d{1,2})\s*(?:hours?|hrs?|hr)\b/);
  if (dur) {
    const s = resolveMeridiem(Number(dur[1]), (dur[3] as "am" | "pm" | undefined) ?? null);
    const hours = Number(dur[4]);
    if (hours >= 1 && hours <= MAX_BOOKABLE_HOURS) {
      return { startHour: s.hour, endHour: s.hour + hours, assumedPm: s.assumed };
    }
    // An explicit duration we cannot honour must NOT fall through to the
    // single-hour branch below. "6am for 20 hours" silently became a
    // one-hour booking at a plausible price — the customer asked for
    // twenty and would have paid for one. Refusing to read a time here
    // makes the bot ask instead of quietly selling the wrong thing.
    return null;
  }

  // 3. Bare single time → one hour. "7pm", "19:00", "at 7"
  const single = t.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/)
    ?? t.match(/\b(\d{1,2}):(\d{2})\b/)
    ?? t.match(/\b(?:at|from)\s+(\d{1,2})\b/);
  if (single) {
    const s = resolveMeridiem(Number(single[1]), (single[3] as "am" | "pm" | undefined) ?? null);
    return { startHour: s.hour, endHour: s.hour + 1, assumedPm: s.assumed };
  }

  return null;
}

/**
 * Parse one message into a booking proposal.
 *
 * `now` is injected rather than read from the clock so "tomorrow" is
 * testable and so the caller decides the reference instant.
 */
export function parseBookingText(text: string, now: Date = new Date()): ParsedBooking {
  const clean = (text ?? "").trim();
  const sport = parseSport(clean);
  const courtSize = parseCourtSize(clean);
  const { date } = parseDate(clean, now);
  const time = parseTime(clean);

  // No date but a time given → they mean today. Whether that hour has
  // already passed is the caller's problem: it needs availability to
  // answer usefully ("7pm today is gone — tomorrow instead?").
  const resolvedDate = date ?? (time ? istDateKey(now) : null);
  const assumedToday = !date && !!time;

  const missing: ParsedBooking["missing"] = [];
  if (!sport) missing.push("sport");
  if (!resolvedDate) missing.push("date");
  if (!time) missing.push("time");

  return {
    sport,
    date: resolvedDate,
    startHour: time?.startHour ?? null,
    endHour: time?.endHour ?? null,
    assumedPm: time?.assumedPm ?? false,
    assumedToday,
    courtSize,
    // Deliberately NOT in `missing`: a size preference is optional. Most
    // people never state one and should not be asked for it.
    missing,
  };
}

/**
 * Merge a fresh parse over what the conversation already knew.
 *
 * The parser is stateless by design — one sentence in, one reading out.
 * That is right for the parser and WRONG for the conversation: on device,
 * "football tomorrow" asked for a time, and tapping the "7-8 pm" chip
 * then asked for a sport, because the second message knows nothing about
 * the first. The chip path could never complete a booking; it ping-ponged
 * forever. Unit tests all passed, because each parse in isolation was
 * correct.
 *
 * So the CLIENT carries the last incomplete reading and sends it back,
 * and this merges the two. New values always win — "actually make it
 * cricket" must override an earlier football — and anything the new
 * sentence is silent about is inherited.
 *
 * Server stays stateless: no session, no store, nothing to expire. The
 * context is just the previous answer handed back.
 */
export function mergeParsed(
  carried: Partial<ParsedBooking> | null | undefined,
  fresh: ParsedBooking,
): ParsedBooking {
  if (!carried) return fresh;

  const sport = fresh.sport ?? carried.sport ?? null;

  // An ASSUMPTION never overrides something the customer actually said.
  // A bare "7-8 pm" defaults its date to today, which is right on its own
  // but wrong as an answer to "what time?" after "football tomorrow" — it
  // silently moved the booking a day earlier. Only an explicit date wins.
  const freshDateIsReal = fresh.date != null && !fresh.assumedToday;
  const date = freshDateIsReal ? fresh.date : (carried.date ?? fresh.date ?? null);
  // Time is one unit: a half-carried window (start from one message, end
  // from another) would silently invent a booking nobody asked for.
  const hasFreshTime = fresh.startHour != null && fresh.endHour != null;
  const startHour = hasFreshTime ? fresh.startHour : (carried.startHour ?? null);
  const endHour = hasFreshTime ? fresh.endHour : (carried.endHour ?? null);

  const missing: ParsedBooking["missing"] = [];
  if (!sport) missing.push("sport");
  if (!date) missing.push("date");
  if (startHour == null || endHour == null) missing.push("time");

  return {
    sport,
    date,
    startHour,
    endHour,
    // Flags describe THIS reading; a carried assumption was already shown
    // on the message that made it, and repeating it every turn is noise.
    assumedPm: hasFreshTime ? fresh.assumedPm : (carried.assumedPm ?? false),
    courtSize: fresh.courtSize ?? carried.courtSize ?? null,
    // Only "today" by assumption if nothing better was carried.
    assumedToday: freshDateIsReal ? false : (carried.date ? false : fresh.assumedToday),
    missing,
  };
}

/** "7:00–8:00 PM" for the confirmation card. Handles the 24/25 late window. *//** "7:00–8:00 PM" for the confirmation card. Handles the 24/25 late window. */
export function formatHourRange(startHour: number, endHour: number): string {
  const label = (h: number) => {
    const wall = h % 24;
    const mer = wall < 12 ? "AM" : "PM";
    const twelve = wall % 12 === 0 ? 12 : wall % 12;
    return `${twelve}:00 ${mer}`;
  };
  return `${label(startHour)} – ${label(endHour)}`;
}
