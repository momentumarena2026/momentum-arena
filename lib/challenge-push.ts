/**
 * The copy the challenge promo sends, and when.
 *
 * Every string and every timing here is the venue's, not the code's. That
 * is the whole point of this file: a promo whose wording lives in a
 * TypeScript literal needs a deploy to change a word, and the person who
 * knows what to say to a Mathura cricket captain at 9pm is not the person
 * holding a git push.
 *
 * Pure — no database, no clock of its own, no sending. It decides what a
 * message SAYS and which nudges are DUE; the caller does the rest. That is
 * what lets the tests pin the boundaries that matter (a nudge firing twice,
 * a nudge firing after expiry) without a scheduler in the loop.
 */

/** A configurable message. `atMinsLeft` is absent for the won-it push. */
export type PushTemplate = {
  /** Minutes REMAINING when this fires. */
  minsLeft?: number;
  title: string;
  body: string;
};

/**
 * What a template may refer to.
 *
 * Deliberately small and all strings by the time they get here: a template
 * language that can reach into objects is a template language that can
 * throw halfway through sending a push.
 */
export type PushVars = {
  /** Minutes left before the offer dies. */
  minsLeft: number;
  /** The discount won, e.g. "20". */
  pct: number;
  /** What the hour costs after the discount, in whole rupees. */
  price: number;
  /** What the discount saves, in whole rupees. */
  saving: number;
  /** "9pm–10pm", or "" when no specific hour is on the table yet. */
  hour: string;
  /** "Sun, 20 Sep", or "". */
  date: string;
  /** "Full Field", or "". */
  court: string;
};

/**
 * Substitute `{name}` placeholders.
 *
 * An unknown placeholder is left exactly as written rather than replaced
 * with "undefined" — a typo in the admin's copy should look like a typo to
 * whoever proofreads the notification, not like a bug in the promo.
 */
export function renderPush(template: string, vars: PushVars): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = (vars as unknown as Record<string, unknown>)[key];
    return v === undefined || v === null ? whole : String(v);
  });
}

/** The placeholders the admin screen offers, so the help text cannot drift. */
export const PUSH_VARIABLES: { name: keyof PushVars; example: string; note: string }[] = [
  { name: "minsLeft", example: "5", note: "minutes left before the offer dies" },
  { name: "pct", example: "20", note: "the discount they won" },
  { name: "price", example: "1600", note: "what the hour costs after the discount" },
  { name: "saving", example: "400", note: "what the discount saves them" },
  { name: "hour", example: "9pm–10pm", note: "the hour on offer" },
  { name: "date", example: "Sun, 20 Sep", note: "the day of that hour" },
  { name: "court", example: "Full Field", note: "which court" },
];

/**
 * What the venue sends if it has not written its own.
 *
 * Kept deliberately plain. These are the words a captain reads while
 * standing on a pitch, so they lead with the number and the deadline.
 */
export const DEFAULT_WON_PUSH: PushTemplate = {
  title: "You won {pct}% off the next hour",
  body: "Ask your side — {hour} is yours for ₹{price} if you take it in the next {minsLeft} minutes.",
};

export const DEFAULT_ADJACENT_PUSHES: PushTemplate[] = [
  {
    minsLeft: 15,
    title: "{minsLeft} minutes left on your {pct}% off",
    body: "{hour} is still free. ₹{price} for the hour — decide before it goes.",
  },
  {
    minsLeft: 5,
    title: "Last call — {minsLeft} minutes",
    body: "Your {pct}% off {hour} expires shortly. ₹{price}, saving ₹{saving}.",
  },
];

export const DEFAULT_FALLBACK_PUSHES: PushTemplate[] = [
  {
    minsLeft: 60,
    title: "Your {pct}% off is still open",
    body: "Pick any hour in the next day at {pct}% off. {minsLeft} minutes left to choose.",
  },
  {
    minsLeft: 30,
    title: "{minsLeft} minutes to use your {pct}% off",
    body: "Any hour, {pct}% off. Once it lapses it's gone.",
  },
  {
    minsLeft: 10,
    title: "Last call — {minsLeft} minutes",
    body: "Your {pct}% off expires shortly. Pick an hour now.",
  },
];

/**
 * Which nudges are due right now.
 *
 * Returns templates whose marker has been REACHED but not yet sent. The
 * "reached" rather than "equals" test is what makes this survive a cron
 * that skipped a minute — a stalled runner or a slow deploy must not
 * silently eat the last-call push, which is the one that converts.
 *
 * An expired offer gets nothing: a "5 minutes left" notification arriving
 * after the offer died is worse than silence, because the player taps it
 * and finds nothing there.
 */
export function pushesDue(args: {
  templates: PushTemplate[];
  minsLeft: number;
  alreadySent: number[];
}): PushTemplate[] {
  if (args.minsLeft <= 0) return [];
  return args.templates
    .filter((t) => typeof t.minsLeft === "number")
    .filter((t) => args.minsLeft <= (t.minsLeft as number))
    .filter((t) => !args.alreadySent.includes(t.minsLeft as number))
    // Most urgent first, so a catch-up run sends "5 minutes" rather than
    // leading with a stale "15 minutes" the player has already lived past.
    .sort((a, b) => (a.minsLeft as number) - (b.minsLeft as number));
}

/**
 * Why this push schedule cannot be saved — or null.
 *
 * The window check is the one that matters: a nudge configured to fire at
 * 60 minutes left inside a 30-minute offer never fires at all, and nothing
 * else in the system would ever say so.
 */
export function pushScheduleRefusal(
  templates: PushTemplate[],
  windowMins: number,
): string | null {
  if (!Array.isArray(templates)) return "That schedule isn't a list.";
  for (const t of templates) {
    if (typeof t.minsLeft !== "number" || !Number.isFinite(t.minsLeft) || t.minsLeft <= 0) {
      return "Every nudge needs a positive number of minutes left.";
    }
    if (t.minsLeft >= windowMins) {
      return `A nudge at ${t.minsLeft} minutes left can never fire inside a ${windowMins}-minute offer.`;
    }
    if (!t.title?.trim() || !t.body?.trim()) return "Every nudge needs a title and a body.";
  }
  const seen = new Set<number>();
  for (const t of templates) {
    if (seen.has(t.minsLeft as number)) {
      return `Two nudges are both set to ${t.minsLeft} minutes left.`;
    }
    seen.add(t.minsLeft as number);
  }
  return null;
}
