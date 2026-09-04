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
import {
  spellcheck,
  type Ambiguity,
  type Correction,
  type VocabEntry,
} from "@/lib/booking-bot/fuzzy";

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
  /**
   * Misspellings that were corrected before parsing, so the bot can say
   * which reading it took. Never applied silently — see lib/booking-bot/
   * fuzzy.ts for why a visible correction is the whole safety argument.
   */
  corrections: Correction[];
  /**
   * Content words that matched nothing. Lets the bot say "I didn't
   * understand 'X'" instead of a generic "tell me which day", which
   * leaves the customer guessing at which word to change.
   */
  unknown: string[];
  /**
   * Words that matched several vocabulary entries equally well, with the
   * candidates. The bot asks instead of guessing — this is the "I'm not
   * sure what you meant" path, and it is reached by real messages:
   * "turhsday" is equidistant from Thursday and Tuesday.
   */
  ambiguous: Ambiguity[];
  /**
   * The customer signalled a day ("next ...", "coming ...") but nothing
   * in the message resolved to one.
   *
   * Distinct from a plain missing date. Saying nothing about a day means
   * today is a fair assumption; naming a day the parser could not read
   * means the assumption is a guess stacked on a failure. "Book cricket
   * next San 1-2" came back as a confident proposal for today, with only
   * a mild "assuming today" note — one tap from the wrong booking.
   */
  unresolvedDay: boolean;
  /**
   * Did THIS message add or change anything?
   *
   * False means the parser could take nothing from what was typed, and
   * the reading is entirely inherited from earlier turns. Without this
   * the bot cannot tell a rejection from silence: "nahi bowling machine"
   * parsed to all-nulls, inherited the previous proposal wholesale, and
   * came back as the identical offer the customer had just refused.
   *
   * Always true for a first message — there is nothing to contribute to.
   */
  contributed: boolean;
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

/**
 * Every word worth spell-correcting, derived from the tables above rather
 * than listed again — a second copy would drift the moment a sport or an
 * alias is added, and drift here means a word silently stops being
 * correctable with nothing failing.
 *
 * Only the sport and keyword spellings are literal, because those live in
 * regexes rather than in a keyed table. The parity test in
 * tests/booking-bot.test.ts asserts each one is still recognised by the
 * regex it mirrors.
 */
export const VOCABULARY: VocabEntry[] = (() => {
  // Each alias carries the canonical spelling it MEANS, so a tie between
  // two spellings of one day ("sat" / "saturday") is not mistaken for a
  // real ambiguity — and so a correction always rewrites to a form the
  // parsers below actually recognise.
  const dayName = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const monthName = ["january", "february", "march", "april", "may", "june", "july",
    "august", "september", "october", "november", "december"];

  const entries: VocabEntry[] = [
    ...Object.entries(WEEKDAYS).map(([word, dow]) => ({ word, canonical: dayName[dow] })),
    ...Object.entries(MONTHS).map(([word, m]) => ({ word, canonical: monthName[m] })),
  ];

  // Sports, relative days and size words live in regexes rather than in a
  // keyed table, so their aliases are listed here. The parity test in
  // tests/booking-bot.test.ts asserts every canonical form below is still
  // recognised by the parser it feeds.
  const aliasGroups: string[][] = [
    ["cricket", "kricket"],
    ["football", "soccer", "footy", "futsal"],
    ["pickleball", "pickle"],
    ["today", "tonight", "aaj"],
    ["tomorrow", "tmrw", "kal"],
    ["yesterday"],
    ["half", "aadha"],
    ["full", "whole", "poora"],
  ];
  for (const group of aliasGroups) {
    for (const word of group) entries.push({ word, canonical: group[0] });
  }
  return entries;
})();

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
/**
 * Which half of the day the customer named, if they named one.
 *
 * The parser had no concept of this at all, and it cost a real booking:
 * "boling machine kal subja 7 se 8" — subah, morning — was proposed as
 * 7 PM, because a bare hour defaults to PM and nothing looked at the
 * word that said otherwise. Worse, "morning" and "evening" were on the
 * do-not-correct list, so they were neither parsed NOR reported as
 * unrecognised: the message resolved fully and was never questioned.
 *
 * A closed list of about a dozen words, in both languages the venue's
 * customers actually use.
 */
type PartOfDay = "morning" | "afternoon" | "evening" | "night" | null;

/** Every spelling the resolver below understands, for un-flagging. */
const PART_OF_DAY_WORDS =
  /^(morning|subah|subha|subja|savere|sawere|afternoon|dopahar|dopeher|evening|shaam|sham|shyam|night|raat|tonight)$/i;

function parsePartOfDay(text: string): PartOfDay {
  if (/\b(morning|subah|subha|subja|savere|sawere)\b/i.test(text)) return "morning";
  if (/\b(afternoon|dopahar|dopeher)\b/i.test(text)) return "afternoon";
  if (/\b(evening|shaam|sham|shyam)\b/i.test(text)) return "evening";
  if (/\b(night|raat|raat\s*ko|tonight)\b/i.test(text)) return "night";
  return null;
}

function resolveMeridiem(
  hour: number,
  meridiem: "am" | "pm" | null,
  /**
   * A stated part of day OVERRIDES the PM default — that is the whole
   * point of reading it. An explicit "am"/"pm" still wins over both,
   * because that is the customer being unambiguous.
   */
  partOfDay: PartOfDay = null,
): { hour: number; assumed: boolean } {
  if (meridiem == null && partOfDay != null && hour >= 1 && hour <= 12) {
    // Morning keeps 1-11 as-is and reads 12 as noon; the rest are PM
    // shapes. Not an assumption: they said which half of the day.
    if (partOfDay === "morning") return { hour: hour === 12 ? 12 : hour, assumed: false };
    if (partOfDay === "afternoon") return { hour: hour === 12 ? 12 : hour + 12, assumed: false };
    if (partOfDay === "evening" || partOfDay === "night") {
      return { hour: hour === 12 ? 0 : hour + 12, assumed: false };
    }
  }
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

/**
 * The bowling machine is a real thing the venue sells and the one thing
 * this surface cannot book.
 *
 * It is a 30-minute product on a zone-blocking strip with its own screen,
 * so the bot's court query deliberately filters it out. But filtering it
 * out of the RESULTS is not the same as understanding the request: a
 * customer asked for it twice and was twice offered a ₹2,000 cricket
 * turf they had explicitly refused, because nothing here could even tell
 * that the machine had been named.
 *
 * Recognising it lets the bot say where to go instead, which is the only
 * useful answer.
 */
const BOWL_WORD = /\b(bowling|bowlin|boling|bolling|bowl)\b/i;
const MACHINE_WORD = /\b(machine|machin|m\/c)\b/i;

export function mentionsBowlingMachine(text: string): boolean {
  // Named outright.
  if (BOWL_WORD.test(text) && MACHINE_WORD.test(text)) return true;
  // "bowling" on its own means the machine here — but only when no sport
  // is named, so "football bowling" is not hijacked into a redirect.
  return BOWL_WORD.test(text) && parseSport(text) == null;
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

type TimeParse = {
  startHour: number;
  endHour: number;
  assumedPm: boolean;
  /** [start, end) of the matched text, so parseDate can skip it. */
  span: [number, number];
} | null;

function parseTime(text: string, partOfDay: PartOfDay = null): TimeParse {
  const t = text.toLowerCase();

  // 1. Explicit range: "7-8pm", "7 to 8 pm", "7pm to 8pm", "19:00-20:00"
  //
  // Separator-agnostic on purpose. The same window gets written as
  // "7-8 pm", "7 to 8 pm", "7/8 pm", "7~8 pm" and "7 till 8", and none
  // of those is more correct than the others. Every separator the
  // parser refuses is a customer who concludes the feature is broken.
  const range = t.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(-|–|—|\/|~|\.\.|to|till|until|se)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/,
  );
  if (range) {
    // The price of accepting more separators is that two of them are also
    // DATE separators, so a date can now look like a time. The numbers
    // alone cannot settle it — "12/9" and "12-09" both sit inside
    // MAX_BOOKABLE_HOURS as noon-to-9pm, so nothing downstream would
    // object. The tell is how people actually write: a slash between bare
    // numbers is a date ("12/9"), and a hyphen with a zero-padded second
    // operand is a date ("12-09"), while both take an am/pm when they are
    // meant as times. Blank the span and look for a time elsewhere in the
    // sentence, so "cricket 12-09 at 7 pm" still finds both.
    const sep = range[4];
    const noMeridiem = range[3] == null && range[7] == null;
    if (noMeridiem && (sep === "/" || (sep === "-" && /^0\d$/.test(range[5])))) {
      const masked =
        t.slice(0, range.index!) +
        " ".repeat(range[0].length) +
        t.slice(range.index! + range[0].length);
      // Indices are preserved by the blanking, so any span found in the
      // masked text still points at the original string.
      return parseTime(masked, partOfDay);
    }

    const endMer = (range[7] as "am" | "pm" | undefined) ?? null;
    // "7 to 8pm" — the meridiem on the end applies to the start too.
    const startMer = (range[3] as "am" | "pm" | undefined) ?? endMer ?? null;
    const s = resolveMeridiem(Number(range[1]), startMer, partOfDay);
    const e = resolveMeridiem(Number(range[5]), endMer ?? startMer, partOfDay);
    let endHour = e.hour;
    // "11pm to 1am" wraps past midnight; the venue models that as 24/25.
    // But only when the END has its own am/pm, or neither side does — an
    // explicit "8 to 7 pm" is a typo, not a booking until 7am tomorrow.
    // 12 after a late start is MIDNIGHT, not noon. Every spelling of the
    // last sellable hour was unparseable — "11 to 12", "11 to 12 pm",
    // "11pm to 12" all returned null, because resolveMeridiem makes a
    // pm-12 into 12:00 and the backwards-typo guard below then ate it.
    // The venue closes at 01:00 and 11 PM to midnight is a real hour it
    // was silently refusing to sell.
    if (e.hour === 12 && s.hour >= 13) endHour = 24;
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
      return {
        startHour: s.hour,
        endHour,
        assumedPm: s.assumed || e.assumed,
        span: [range.index!, range.index! + range[0].length],
      };
    }
    // An explicit range we cannot honour must not fall through to the
    // single-time branch and quietly become something else.
    return null;
  }

  // 2. Single time + explicit duration: "7pm for 2 hours"
  const dur = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:for\s+)?(\d{1,2})\s*(?:hours?|hrs?|hr)\b/);
  if (dur) {
    const s = resolveMeridiem(Number(dur[1]), (dur[3] as "am" | "pm" | undefined) ?? null, partOfDay);
    const hours = Number(dur[4]);
    if (hours >= 1 && hours <= MAX_BOOKABLE_HOURS) {
      return {
        startHour: s.hour,
        endHour: s.hour + hours,
        assumedPm: s.assumed,
        span: [dur.index!, dur.index! + dur[0].length],
      };
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
    const s = resolveMeridiem(Number(single[1]), (single[3] as "am" | "pm" | undefined) ?? null, partOfDay);
    return {
      startHour: s.hour,
      endHour: s.hour + 1,
      assumedPm: s.assumed,
      span: [single.index!, single.index! + single[0].length],
    };
  }

  return null;
}

/**
 * Parse one message into a booking proposal.
 *
 * `now` is injected rather than read from the clock so "tomorrow" is
 * testable and so the caller decides the reference instant.
 */
export function parseBookingText(
  text: string,
  now: Date = new Date(),
  /**
   * Vocabulary LEARNED from the comprehension layer and approved by a
   * human (BookingBotTerm). This is the whole point of the learning
   * loop: once a word is here the rules resolve it with no model call,
   * for free, forever. Passed in rather than fetched so this file stays
   * pure and testable — the caller owns the database.
   */
  extraVocab: VocabEntry[] = [],
): ParsedBooking {
  const raw = (text ?? "").trim();

  // Spell-correct FIRST, against a sixty-word closed vocabulary. The
  // reported failure was "turhsday", and the general shape of it is that
  // every word this parser matches on comes from a short fixed list, so
  // an exact-match requirement was doing all the damage. Corrections are
  // carried out of here and said out loud rather than applied quietly.
  const checked = spellcheck(raw, extraVocab.length ? [...VOCABULARY, ...extraVocab] : VOCABULARY);
  const clean = checked.text;

  const sport = parseSport(clean);
  const courtSize = parseCourtSize(clean);

  // TIME FIRST, then blank out the text it consumed before looking for a
  // date. Digit ranges are ambiguous between the two — "8-10 pm" is a
  // time, but the day-month pattern reads it as the 8th of October, and
  // "next thursday 8-10 pm" was answered with "I can only book 30 days
  // ahead" because October is 33 days out. An earlier attempt required a
  // zero-padded month, which "8-10" satisfies, so it slipped through.
  //
  // Removing the matched span is the general fix rather than another
  // guess at which shapes are dates: whatever the time pattern claimed
  // cannot also be a date, whichever way it happens to be written.
  const partOfDay = parsePartOfDay(clean);
  const time = parseTime(clean, partOfDay);
  const forDate = time
    ? clean.slice(0, time.span[0]) + " ".repeat(time.span[1] - time.span[0]) + clean.slice(time.span[1])
    : clean;
  const { date } = parseDate(forDate, now);

  // No date but a time given → they mean today. Whether that hour has
  // already passed is the caller's problem: it needs availability to
  // answer usefully ("7pm today is gone — tomorrow instead?").
  const resolvedDate = date ?? (time ? istDateKey(now) : null);
  const assumedToday = !date && !!time;

  // "next"/"coming" are the words people use when they are about to name
  // a day. If one is present and no date came out, the day they named is
  // the thing that failed — ask, rather than quietly defaulting to today.
  // Words that promise a day without naming one. "next"/"coming" were
  // already here; "weekend" and a bare "day after" are the same shape and
  // were quietly resolving to TODAY — someone asking for "day after 7 to
  // 8" means the day after tomorrow and was being offered this evening.
  const unresolvedDay =
    !date && /\b(next|coming|upcoming|weekend|weekday|day\s*after|iss\s*week)\b/i.test(clean);

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
    corrections: checked.corrections,
    // Only worth reporting when something is actually missing. A message
    // the parser fully understood does not need "I didn't know what
    // 'lets' meant" appended to it.
    // ALWAYS populated. An earlier version emptied this whenever nothing
    // was missing, on the grounds that a fully-understood message needs
    // no "I didn't know what 'lets' meant" appended to it. That is true
    // of the MESSAGE and false of the field: the route also uses this to
    // decide whether a sentence needs a second opinion, and suppressing
    // it made that check circular. "Minh's all sham 6 bake cricket"
    // completed itself from carried context, reported no unknown words
    // because nothing was missing, and so was never escalated — it came
    // back as a confident ₹1,600 proposal. Deciding what to SAY is the
    // route's job; this field just reports what happened.
    // A part-of-day word we RESOLVED is understood, not unrecognised.
    // Leaving it in would send "cricket tomorrow evening 7 to 8" to the
    // comprehension layer every time for a word the rules just handled.
    unknown: partOfDay
      ? checked.unknown.filter((w) => !PART_OF_DAY_WORDS.test(w))
      : checked.unknown,
    ambiguous: checked.ambiguous,
    unresolvedDay,
    // A lone parse has nothing to contribute TO. mergeParsed decides
    // this properly once there is a previous reading to compare against.
    contributed: true,
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

  // Did the new message actually say anything? Every field it filled is
  // one it introduced or changed; if it filled none, the reading above is
  // purely inherited, and answering with it repeats ourselves at a
  // customer who may have just told us we were wrong.
  const contributed =
    fresh.sport != null ||
    freshDateIsReal ||
    hasFreshTime ||
    fresh.courtSize != null ||
    fresh.ambiguous.length > 0;

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
    // Corrections describe the message just typed, like the other flags —
    // re-announcing a correction from three turns ago would be noise.
    corrections: fresh.corrections,
    unknown: fresh.unknown,
    ambiguous: fresh.ambiguous,
    // A day carried from an earlier turn settles it — the unread word in
    // THIS message no longer matters.
    unresolvedDay: date == null ? fresh.unresolvedDay : false,
    contributed,
  };
}

/**
 * Would approving this term actually change anything?
 *
 * A learned term rewrites a word INTO its canonical form, so it only
 * helps if the parser understands the canonical. "criket" → "cricket"
 * pays off immediately; "shaam" → "evening" does not, because nothing
 * here resolves "evening" to an hour — the rules would still have to
 * ask, and the model would still be called.
 *
 * Surfaced in the admin review screen so a reviewer approves terms that
 * do something rather than terms that merely look correct.
 */
export function isParseableTerm(canonical: string): boolean {
  const word = canonical.toLowerCase().trim();
  if (!word) return false;
  // Size words are only meaningful with their noun, and month names need
  // a day — the same shapes the parity test allows for.
  const phrase = word === "half" || word === "full" ? `${word} court` : word;
  const probe = MONTHS[phrase] != null ? `12 ${phrase}` : phrase;
  const p = parseBookingText(`${probe} 7 pm`, new Date());
  return p.sport != null || p.courtSize != null || !p.assumedToday;
}

/**
 * Layer a model reading UNDER the rule parser's, not over it.
 *
 * The model fills gaps. It does not overrule a value the rules read
 * straight out of the customer's words.
 *
 * This was learnt the expensive way. "monday ko kardo shaam ko 8-9
 * cricket" was parsed correctly by the rules — Monday the 7th, 20:00 to
 * 21:00, cricket — and the model, which had been handed the previous
 * turn's context, echoed that context instead of re-reading the message
 * and answered Sunday the 6th, 19:00 to 20:00. A plain merge treated the
 * model as the fresher, better source and replaced three correct fields
 * with three wrong ones. The customer had explicitly said Monday and
 * eight-to-nine, and was shown Sunday, seven-to-eight, ready to pay.
 *
 * So the precedence is: an explicit reading beats an inferred one. Rules
 * win wherever they resolved a field from a real token; the model wins
 * only where the rules had nothing, or where the rules ADMITTED to
 * guessing (assumedToday, unresolvedDay) — which is exactly the set of
 * cases the model was brought in for.
 *
 * The rules' own doubts survive too. `ambiguous` and `unknown` describe
 * the message, and the model produces neither; dropping them let a
 * flagged ambiguity ("mundy" — Monday or Sunday?) turn into a silent
 * booking on the wrong day.
 */
export function fillGaps(rules: ParsedBooking, model: ParsedBooking): ParsedBooking {
  // A date the rules resolved from a real day word, rather than defaulted
  // to today or failed to read, is not up for revision.
  const rulesDateIsFirm = rules.date != null && !rules.assumedToday && !rules.unresolvedDay;
  const date = rulesDateIsFirm ? rules.date : (model.date ?? rules.date);
  const dateFromModel = !rulesDateIsFirm && model.date != null;

  // Time moves as a unit. Half from each source would invent a window
  // nobody asked for.
  //
  // `assumedPm` counts as the rules ADMITTING a guess, exactly like
  // assumedToday, and an earlier version left it out of that set. That
  // omission cost a real booking: "kal subja 7 se 8" (tomorrow morning)
  // was read by the model as 07:00-08:00 and thrown away in favour of
  // the rules' PM *default* of 19:00-20:00 — twelve hours from what was
  // asked for, on a card that said "I've read that as PM" and was
  // confirmed anyway. An explicit "7 to 8 am" is not an assumption and
  // still wins.
  const rulesHasTime = rules.startHour != null && rules.endHour != null;
  const rulesTimeIsFirm = rulesHasTime && !rules.assumedPm;
  const modelHasTime = model.startHour != null && model.endHour != null;
  const useModelTime = !rulesTimeIsFirm && modelHasTime;
  const startHour = useModelTime ? model.startHour : rules.startHour;
  const endHour = useModelTime ? model.endHour : rules.endHour;

  const sport = rules.sport ?? model.sport;

  const missing: ParsedBooking["missing"] = [];
  if (!sport) missing.push("sport");
  if (!date) missing.push("date");
  if (startHour == null || endHour == null) missing.push("time");

  return {
    sport,
    date,
    startHour,
    endHour,
    // A flag describes the source it came from. The model resolves
    // meridiems itself and is given today's date, so its values carry no
    // assumption to announce.
    assumedPm: useModelTime ? false : rules.assumedPm,
    assumedToday: dateFromModel ? false : rules.assumedToday,
    courtSize: rules.courtSize ?? model.courtSize,
    missing,
    corrections: rules.corrections,
    unknown: rules.unknown,
    ambiguous: rules.ambiguous,
    // Answered only if the model actually produced the day that was
    // missing. Otherwise the question still stands.
    unresolvedDay: dateFromModel ? false : rules.unresolvedDay,
    // A model reading is not the customer saying something new — whether
    // this TURN contributed is a fact about the message, not the source.
    contributed: rules.contributed,
  };
}

/** "7:00–8:00 PM" for the confirmation card. Handles the 24/25 late window. */
export function formatHourRange(startHour: number, endHour: number): string {
  const label = (h: number) => {
    const wall = h % 24;
    const mer = wall < 12 ? "AM" : "PM";
    const twelve = wall % 12 === 0 ? 12 : wall % 12;
    return `${twelve}:00 ${mer}`;
  };
  return `${label(startHour)} – ${label(endHour)}`;
}
