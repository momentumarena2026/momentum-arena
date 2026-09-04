import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUserId } from "@/lib/auth-unified";
import { getDisplayShiftedAvailability } from "@/lib/availability";
import {
  parseBookingText,
  mergeParsed,
  formatHourRange,
  VOCABULARY,
  type ParsedBooking,
} from "@/lib/booking-bot/parse";
import {
  firstCourtWithWindow,
  orderCourtsByPreference,
  suggestAlternatives,
  type CourtDay,
} from "@/lib/booking-bot/suggest";
import { istDateKey, toIst } from "@/lib/ist";
import { readWithLlm } from "@/lib/booking-bot/llm";
import { validateLlmReading, usefulTerms } from "@/lib/booking-bot/validate";
import {
  normalizeMessage,
  cachedReading,
  logMessage,
  rememberTerms,
} from "@/lib/booking-bot/learn";

export const dynamic = "force-dynamic";

/**
 * The booking bot's one endpoint: a sentence in, a proposal out.
 *
 * It NEVER books anything and never touches money. It returns what it
 * understood plus a price, and the app renders that as a card the customer
 * confirms. Confirming runs the existing lock → pay → verify flow
 * unchanged, so there is no second booking path to keep correct — the
 * thing that makes this affordable to build and safe to trust.
 *
 * Three shapes come back:
 *
 *   needs      the sentence was short a sport, a date or a time. The app
 *              shows chips for whatever is missing rather than guessing.
 *   proposal   a real court, window and price, ready to confirm.
 *   taken      the window is gone; `suggestions` holds the nearest
 *              alternatives, which is the whole point of the feature.
 */

type Ok =
  | {
      kind: "needs";
      missing: string[];
      message: string;
      parsed: unknown;
      /**
       * Chips the SERVER chose, overriding the client's canned ones.
       * Used when the question is specific to this message — "did you
       * mean Thursday or Tuesday?" has two right answers and neither is
       * in a fixed list.
       */
      chips?: string[];
      /** BookingBotLog row, echoed back so a confirmed booking can be
       *  attributed to the reading that produced it. */
      logId?: string | null;
    }
  | {
      kind: "proposal";
      message: string;
      note: string | null;
      /** Carried forward so a refinement like "no, only half court" works. */
      parsed: unknown;
      /** BookingBotLog row. Echoed back so that a booking the customer
       *  actually completes can be attributed to the reading that
       *  produced it — the only unambiguous label the loop ever gets. */
      logId?: string | null;
      proposal: {
        sport: string;
        courtConfigId: string;
        courtLabel: string;
        date: string;
        startHour: number;
        endHour: number;
        hours: number[];
        timeLabel: string;
        price: number;
      };
    }
  | {
      kind: "taken";
      message: string;
      /** Carried forward so the next turn keeps the sport and date. */
      parsed: unknown;
      logId?: string | null;
      requested: { date: string; timeLabel: string };
      suggestions: {
        courtConfigId: string;
        courtLabel: string;
        date: string;
        startHour: number;
        endHour: number;
        hours: number[];
        timeLabel: string;
        price: number;
        differentCourt: boolean;
      }[];
    };

/** Mirrors DATE_WINDOW_DAYS in apps/mobile BookSlotsScreen — the bot must
 *  not offer dates the slot picker refuses to show. */
const BOOKING_HORIZON_DAYS = 30;

function titleCase(w: string): string {
  return w.charAt(0).toUpperCase() + w.slice(1);
}

const MISSING_COPY: Record<string, string> = {
  sport: "which sport",
  date: "which day",
  time: "what time",
};

export async function POST(request: NextRequest) {
  // Signed-in only: the proposal quotes a price, and price depends on the
  // customer (passes, coupons, reward points are applied at hold time).
  // Quoting anonymously would show a number the checkout then contradicts.
  const userId = await getAuthUserId(request).catch(() => null);
  if (!userId) {
    return NextResponse.json({ error: "Sign in to use the booking assistant" }, { status: 401 });
  }

  let body: { text?: string; context?: Partial<ParsedBooking> | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const text = (body.text ?? "").slice(0, 300);
  if (!text.trim()) {
    return NextResponse.json({ error: "Say what you'd like to book" }, { status: 400 });
  }

  const now = new Date();
  // Merge over whatever the conversation already established. Without
  // this the chip path loops forever: "football tomorrow" asks for a
  // time, and answering "7-8 pm" then asks for a sport, because each
  // message is parsed in isolation. The client hands back the last
  // incomplete reading; the server stays stateless.
  const ruleParsed = mergeParsed(body.context ?? null, parseBookingText(text, now));

  // ── Rules first, model only on what rules could not settle ────────
  //
  // The rule parser is fast, free, deterministic and already correct for
  // the sentences people mostly type. What it cannot be is COMPLETE:
  // every new phrasing found one more gap, and patching gaps only
  // terminates if the set of phrasings is finite. It isn't.
  //
  // So the model runs on the residual — the messages rules could not
  // read — and nowhere else. That keeps the common path free of a
  // network hop, keeps cost near zero, and leaves the deterministic
  // reading in hand as the fallback if the provider is slow or down.
  const today = istDateKey(now);
  const horizon = istDateKey(new Date(now.getTime() + BOOKING_HORIZON_DAYS * 86400000));
  const normalized = normalizeMessage(text);

  const needsHelp =
    ruleParsed.missing.length > 0 ||
    ruleParsed.ambiguous.length > 0 ||
    ruleParsed.unresolvedDay ||
    ruleParsed.unknown.length > 0;

  let parsed = ruleParsed;
  let route = "";
  let llmRaw: unknown = null;
  let rejected: string | null = null;
  let latencyMs: number | null = null;
  let clarify: { question: string; options: string[] } | null = null;

  if (needsHelp) {
    // A phrasing this customer base has used before, on this same day,
    // that someone actually booked. Costs nothing and skips the call —
    // this is the number that should climb as the log fills.
    const cached = await cachedReading(normalized, today);
    if (cached && typeof cached === "object") {
      parsed = mergeParsed(ruleParsed, cached as ParsedBooking);
      route = "cache-hit";
    } else {
      route = ruleParsed.ambiguous.length > 0
        ? "ambiguous"
        : ruleParsed.unresolvedDay
          ? "unresolved-day"
          : "missing";

      const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
        toIst(now).getUTCDay()
      ];
      const out = await readWithLlm(text, {
        todayIst: today,
        weekdayIst: weekday,
        // Only what the conversation established — never the customer.
        context: body.context
          ? {
              sport: body.context.sport ?? null,
              date: body.context.date ?? null,
              startHour: body.context.startHour ?? null,
              endHour: body.context.endHour ?? null,
              courtSize: body.context.courtSize ?? null,
            }
          : null,
      });
      llmRaw = out.raw;
      latencyMs = out.latencyMs;

      const verdict = validateLlmReading(out.reading, { todayIst: today, horizonIst: horizon });
      if (verdict.ok) {
        // The model's reading LAYERS OVER the rules' — anything it left
        // null keeps whatever the conversation already knew.
        parsed = mergeParsed(ruleParsed, verdict.parsed);
        // Asked to always ask before proposing when only partly
        // understood: low confidence never becomes a card.
        if (out.reading?.confidence === "low" && out.reading.clarify) {
          clarify = out.reading.clarify;
        }
        void rememberTerms(usefulTerms(out.reading?.learned, new Set(VOCABULARY.map((v) => v.word))));
      } else {
        // A reading that failed validation is discarded entirely, not
        // partially adopted. We fall back to the rules' answer, which is
        // at worst an honest question.
        rejected = verdict.reason;
      }
    }
  }

  // Fire-and-forget: the row makes tomorrow's parser better, and is
  // never worth delaying today's customer for.
  const logId = await logMessage({
    userId,
    text,
    normalized,
    parserResult: ruleParsed,
    llmResult: llmRaw,
    route,
    rejected,
    finalResult: parsed,
    latencyMs,
  }).catch(() => null);

  // ── The model said it wasn't sure ─────────────────────────────────
  //
  // Its own clarifying question, offered before any proposal. This is
  // the output that generalises: it covers phrasings nobody enumerated,
  // which is the entire reason a model is here rather than more regexes.
  if (clarify && Array.isArray(clarify.options) && clarify.options.length > 0) {
    return NextResponse.json<Ok>({
      kind: "needs",
      missing: [],
      message: String(clarify.question).slice(0, 200),
      chips: clarify.options.slice(0, 4).map((o) => String(o).slice(0, 24)),
      parsed,
      logId,
    });
  }

  // ── Ambiguity beats everything else ────────────────────────────────
  //
  // A word that matched two vocabulary entries equally well is the one
  // case where guessing is worse than asking: "turhsday" is exactly three
  // edits from both Thursday and Tuesday, and a confident answer on the
  // wrong day is far more expensive than one extra tap. Checked BEFORE
  // `missing`, because the parser will have quietly defaulted the field
  // that word was supposed to fill — the reported message came back as a
  // proposal for today.
  if (parsed.ambiguous.length > 0) {
    const a = parsed.ambiguous[0];
    const options = a.options.map(titleCase);
    return NextResponse.json<Ok>({
      kind: "needs",
      missing: [],
      message: `I couldn't tell whether "${a.word}" meant ${options.join(" or ")}.`,
      chips: options,
      parsed,
    });
  }

  // ── A named day that didn't resolve ───────────────────────────────
  //
  // "Book cricket next San 1-2" proposed today at ₹1,600 with a mild
  // "assuming today" note. "San" is three letters, so it was below the
  // correction floor and passed through unremarked, and "assuming today"
  // reads as harmless when in fact the customer had named a day. Assume
  // today only when NOTHING was said about a day.
  if (parsed.unresolvedDay) {
    const lost = parsed.unknown[0];
    return NextResponse.json<Ok>({
      kind: "needs",
      missing: ["date"],
      message: lost
        ? `I didn't understand "${lost}" — which day did you mean?`
        : "Which day did you mean?",
      parsed,
    });
  }

  if (parsed.missing.length > 0) {
    const wanted = parsed.missing.map((m) => MISSING_COPY[m]).join(" and ");
    // Name the word that defeated it. "Tell me which sport" is a useless
    // reply to a message that already named one — the customer retypes
    // the same thing and gets the same answer. Saying "I didn't
    // understand 'bskteball'" tells them exactly which word to change,
    // and incidentally tells them the sport isn't offered.
    const lost = parsed.unknown[0];
    return NextResponse.json<Ok>({
      kind: "needs",
      missing: parsed.missing,
      message: lost
        ? `I didn't understand "${lost}" — tell me ${wanted}.`
        : `Got it — just tell me ${wanted}.`,
      parsed,
    });
  }

  const { sport, date, startHour, endHour } = parsed as {
    sport: NonNullable<typeof parsed.sport>;
    date: string;
    startHour: number;
    endHour: number;
  };

  // A date in the past is a typo, not a request. Say so plainly instead
  // of returning an empty availability grid the bot would read as "taken".
  if (date < today) {
    return NextResponse.json<Ok>({
      kind: "needs",
      missing: ["date"],
      message: `${date} has already passed — which day did you mean?`,
      parsed,
    });
  }

  // An hour that has already gone today is not bookable, and saying
  // "that's booked, here's 9pm" for a 6pm slot at 8:51pm reads as though
  // somebody else took it. A tester hit exactly this and could not tell
  // whether the alternatives offered were even on the right day.
  if (date === today) {
    const istHourNow = Number(
      new Date(now.getTime() + 330 * 60000).toISOString().slice(11, 13),
    );
    if (endHour <= istHourNow) {
      return NextResponse.json<Ok>({
        kind: "needs",
        missing: ["time"],
        message: `${formatHourRange(startHour, endHour)} has already gone today — what time were you thinking?`,
        parsed,
      });
    }
  }

  // Same horizon the slot picker offers (DATE_WINDOW_DAYS = 30 in
  // BookSlotsScreen). Without this the bot would quote and hold dates no
  // other surface will show — it quoted three months out in testing —
  // which quietly routes around whatever the 30-day window is there to
  // protect (pricing changes, seasonal closures, staffing).
  if (date > horizon) {
    return NextResponse.json<Ok>({
      kind: "needs",
      missing: ["date"],
      message: `I can only book ${BOOKING_HORIZON_DAYS} days ahead — pick a nearer date and I'll check.`,
      parsed,
    });
  }

  // The bowling machine is a CRICKET config but it is a machine, not a
  // court — it has its own availability endpoint and its own flow. Left
  // in, "book cricket tomorrow" could propose the bowling machine.
  const allConfigs = orderCourtsByPreference(
    await db.courtConfig.findMany({
      where: {
        sport,
        isActive: true,
        // NOT `category: { not: "BOWLING_MACHINE" }`. On a nullable column
        // that is SQL three-valued logic: NULL != 'BOWLING_MACHINE' is
        // NULL, not true, so Prisma silently dropped every court with a
        // null category — which is Football and Pickleball, both of them.
        // The bot told every football customer nothing was ever available.
        // Caught against staging data, not by the type checker.
        OR: [{ category: null }, { category: { not: "BOWLING_MACHINE" } }],
      },
      select: { id: true, label: true, size: true },
    }),
  );
  // Honour a stated size preference. Cricket has a full turf and two
  // half-courts at different prices, so "half court" is an instruction,
  // not decoration — ignoring it answered "no, only half court" with the
  // full field again. If the preference matches nothing bookable we fall
  // back to everything rather than claiming the sport is unavailable.
  const sized =
    parsed.courtSize === "HALF"
      ? allConfigs.filter((c) => c.size === "MEDIUM" || c.size === "SMALL")
      : parsed.courtSize === "FULL"
        ? allConfigs.filter((c) => c.size === "FULL" || c.size === "XL")
        : allConfigs;
  const configs = sized.length > 0 ? sized : allConfigs;

  if (configs.length === 0) {
    return NextResponse.json<Ok>({
      kind: "needs",
      missing: ["sport"],
      message: "That sport isn't bookable right now.",
      parsed,
    });
  }

  // One availability read per court, in parallel. This is the same
  // function /api/availability serves, so the bot can never disagree with
  // the slot picker about what is free.
  const courts: CourtDay[] = await Promise.all(
    configs.map(async (c) => ({
      courtConfigId: c.id,
      courtLabel: c.label,
      slots: (await getDisplayShiftedAvailability(c.id, new Date(`${date}T00:00:00.000Z`))).map(
        (s) => ({ hour: s.hour, status: s.status, price: s.price }),
      ),
    })),
  );

  const hoursOf = (a: number, b: number) =>
    Array.from({ length: b - a }, (_, i) => a + i);
  const timeLabel = formatHourRange(startHour, endHour);

  const hit = firstCourtWithWindow(courts, startHour, endHour);
  if (hit) {
    // Surface every assumption the parser made. A customer who meant 7am
    // sees "7:00 PM" and one tap fixes it — which is the entire reason
    // defaulting is acceptable at all.
    const notes: string[] = [];
    // Spelling corrections first — they changed what was asked for, which
    // matters more than how a bare hour was read. A correction the
    // customer cannot see is the one failure mode of tolerant matching.
    for (const c of parsed.corrections) {
      notes.push(`I read "${c.from}" as ${titleCase(c.to)}`);
    }
    if (parsed.assumedPm) notes.push("I've read that as PM");
    if (parsed.assumedToday) notes.push("assuming today");

    return NextResponse.json<Ok>({
      kind: "proposal",
      parsed,
      logId,
      message: `${hit.court.courtLabel} is free.`,
      // NOT "tap Change if not": there is no Change control on the card,
      // and pointing at a button that doesn't exist is worse than saying
      // nothing — it reads as though the assumption has been handled.
      // Retyping is the actual correction path, and the conversation
      // carries context, so "cricket" + "thursday" is enough.
      note: notes.length ? `${notes.join(", ")} — just say the day or time to change it.` : null,
      proposal: {
        sport,
        courtConfigId: hit.court.courtConfigId,
        courtLabel: hit.court.courtLabel,
        date,
        startHour,
        endHour,
        hours: hoursOf(startHour, endHour),
        timeLabel,
        price: hit.price,
      },
    });
  }

  const suggestions = suggestAlternatives(
    courts,
    { courtConfigId: null, startHour, endHour },
    { maxShiftHours: 3, limit: 3 },
  );

  return NextResponse.json<Ok>({
    kind: "taken",
    parsed,
    logId,
    message:
      suggestions.length > 0
        ? `${timeLabel} is booked. Closest I have:`
        : `${timeLabel} is booked, and nothing close is free either. Try another day?`,
    requested: { date, timeLabel },
    suggestions: suggestions.map((s) => ({
      courtConfigId: s.courtConfigId,
      courtLabel: s.courtLabel,
      date,
      startHour: s.startHour,
      endHour: s.endHour,
      hours: hoursOf(s.startHour, s.endHour),
      timeLabel: formatHourRange(s.startHour, s.endHour),
      price: s.price,
      differentCourt: s.differentCourt,
    })),
  });
}
