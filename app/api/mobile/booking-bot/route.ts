import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUserId } from "@/lib/auth-unified";
import { getDisplayShiftedAvailability } from "@/lib/availability";
import {
  parseBookingText,
  mergeParsed,
  formatHourRange,
  type ParsedBooking,
} from "@/lib/booking-bot/parse";
import {
  firstCourtWithWindow,
  orderCourtsByPreference,
  suggestAlternatives,
  type CourtDay,
} from "@/lib/booking-bot/suggest";
import { istDateKey } from "@/lib/ist";

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
  | { kind: "needs"; missing: string[]; message: string; parsed: unknown }
  | {
      kind: "proposal";
      message: string;
      note: string | null;
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
  const parsed = mergeParsed(body.context ?? null, parseBookingText(text, now));

  if (parsed.missing.length > 0) {
    const wanted = parsed.missing.map((m) => MISSING_COPY[m]).join(" and ");
    return NextResponse.json<Ok>({
      kind: "needs",
      missing: parsed.missing,
      message: `Got it — just tell me ${wanted}.`,
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
  if (date < istDateKey(now)) {
    return NextResponse.json<Ok>({
      kind: "needs",
      missing: ["date"],
      message: `${date} has already passed — which day did you mean?`,
      parsed,
    });
  }

  // The bowling machine is a CRICKET config but it is a machine, not a
  // court — it has its own availability endpoint and its own flow. Left
  // in, "book cricket tomorrow" could propose the bowling machine.
  const configs = orderCourtsByPreference(
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
    if (parsed.assumedPm) notes.push("I've read that as PM");
    if (parsed.assumedToday) notes.push("assuming today");

    return NextResponse.json<Ok>({
      kind: "proposal",
      message: `${hit.court.courtLabel} is free.`,
      note: notes.length ? `${notes.join(", ")} — tap Change if not.` : null,
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
