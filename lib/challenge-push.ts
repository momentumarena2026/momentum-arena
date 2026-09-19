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
export function renderPush(
  template: string,
  vars: PushVars | LifecycleVars | Record<string, string | number>,
): string {
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
  body: "Ask your side — {date} {hour} is yours for ₹{price} if you take it in the next {minsLeft} minutes.",
};

export const DEFAULT_ADJACENT_PUSHES: PushTemplate[] = [
  {
    minsLeft: 15,
    title: "{minsLeft} minutes left on your {pct}% off",
    body: "{date} {hour} is still free. ₹{price} for the hour — decide before it goes.",
  },
  {
    minsLeft: 5,
    title: "Last call — {minsLeft} minutes",
    body: "Your {pct}% off {date} {hour} expires shortly. ₹{price}, saving ₹{saving}.",
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
    // INTEGER, not merely finite. `ChallengeOffer.remindedAt` is an Int[],
    // so Postgres rounds 10.5 to 11 on write — and the dedupe test then
    // asks whether [11] includes 10.5, which is false forever. A per-minute
    // cron turns that into one push every minute for the life of the offer.
    if (typeof t.minsLeft !== "number" || !Number.isInteger(t.minsLeft) || t.minsLeft <= 0) {
      return "Every nudge needs a whole positive number of minutes left.";
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

/**
 * The nudge schedule that will ACTUALLY send, given whatever is stored.
 *
 * One function, used by the runtime and by the save-time validator, because
 * they have to agree and twice now they have not: a null column meant
 * "nothing to check" to the validator while the runtime substituted the
 * built-in schedule and sent it. The distinction that matters is between
 * ABSENT (fall back) and EMPTY (the venue turned nudges off) — collapsing
 * those two is what made "no nudges" unconfigurable.
 */
export function resolvePushes(stored: unknown, fallback: PushTemplate[]): PushTemplate[] {
  return Array.isArray(stored) ? (stored as PushTemplate[]) : fallback;
}

/**
 * What the MATCH-LIFECYCLE messages may refer to.
 *
 * Separate from `PushVars` because the two sets have almost nothing in
 * common: a prize nudge is about a discount and a deadline, and "your half is
 * due" is about a court, a price and the other captain. One merged set would
 * advertise `{pct}` on a message that can never have a discount in it.
 */
export type LifecycleVars = {
  /** The other captain's name, or "The other captain". */
  name: string;
  /** The team that posted, or their name. */
  team: string;
  /** "9pm–10pm". */
  hour: string;
  /** "Sun, 20 Sep". */
  date: string;
  /** "Full Field". */
  court: string;
  /** What this person owes or paid, in whole rupees. */
  amount: number;
  /** The whole court, in whole rupees. */
  total: number;
  /** What is still due at the venue on the day. */
  balance: number;
};

export const LIFECYCLE_VARIABLES: { name: keyof LifecycleVars; example: string; note: string }[] = [
  { name: "name", example: "Rahul", note: "the other captain" },
  { name: "team", example: "Mathura Strikers", note: "the team that posted" },
  { name: "hour", example: "9pm–10pm", note: "the agreed hour" },
  { name: "date", example: "Sun, 20 Sep", note: "the day of the match" },
  { name: "court", example: "Full Field", note: "which court" },
  { name: "amount", example: "500", note: "what this person owes or paid" },
  { name: "total", example: "2000", note: "the whole court" },
  { name: "balance", example: "1000", note: "still due at the venue on the day" },
];

/**
 * The five messages a match sends as it moves.
 *
 * These were hard-coded strings in three different files. The module's whole
 * premise is that the person who knows what to say to a Mathura cricket
 * captain at 9pm does not need a developer — and these are the messages that
 * actually reach a captain, so leaving them in TypeScript put the most-read
 * copy in the module beyond the venue's reach.
 */
export const DEFAULT_LIFECYCLE_PUSHES: Record<LifecyclePush, PushTemplate> = {
  agreed: {
    title: "Match on — your half is due",
    body: "{name} is in for {date} {hour}. Whoever pays their half first blocks the court; the match is confirmed once both halves are in.",
  },
  payHalf: {
    title: "Your half is due — the hour isn't held yet",
    body: "{name} has paid their half for {date} {hour}. The court is NOT held until both halves are in, so pay your ₹{amount} to lock it before somebody else books it.",
  },
  confirmed: {
    title: "Match confirmed",
    body: "Both halves are in and {court} is booked for {date} {hour}. ₹{balance} at the venue on the day. See you there.",
  },
  slotLost: {
    title: "{date} {hour} has gone",
    body: "Somebody else booked that hour before both halves were in. Anything you paid is being refunded in full. Agree another time and we'll try again.",
  },
  refundOwed: {
    title: "We owe you a refund",
    body: "Your payment went through but the match could not be held. The arena will refund you in full.",
  },
};

export type LifecyclePush = "agreed" | "payHalf" | "confirmed" | "slotLost" | "refundOwed";

/** How each of the five reads in the admin screen. */
export const LIFECYCLE_LABELS: Record<LifecyclePush, { title: string; desc: string }> = {
  agreed: {
    title: "A time is agreed",
    desc: "To both captains, the moment somebody accepts a time. Nobody has paid yet.",
  },
  payHalf: {
    title: "The other side paid — your half is due",
    desc: "To the captain who still owes, once the other half is in. The hour is NOT held yet at this point — this is the message the whole flow depends on, and it should say so.",
  },
  confirmed: { title: "Match confirmed", desc: "To both captains once both halves are in." },
  slotLost: {
    title: "The hour went",
    desc: "To BOTH captains when somebody else booked the court before both halves were in. Anyone who had paid is refunded, and you get your own notification saying whose money to return.",
  },
  refundOwed: {
    title: "A refund is owed",
    desc: "To one captain when their payment landed on a match that could no longer be held.",
  },
};

/**
 * One stored template, or the built-in.
 *
 * Deliberately unlike `resolvePushes`: an EMPTY object is not a way to switch
 * a lifecycle message off. "Your half is due" is transactional — a captain
 * who is never told is a captain whose money sits there while the hour they
 * were buying gets sold to somebody else — so there is no off, only
 * different words.
 */
export function resolveTemplate(stored: unknown, fallback: PushTemplate): PushTemplate {
  if (!stored || typeof stored !== "object") return fallback;
  const t = stored as Partial<PushTemplate>;
  return t.title?.trim() && t.body?.trim()
    ? { title: t.title, body: t.body }
    : fallback;
}

/** Why this single message cannot be saved — or null. */
export function templateRefusal(t: unknown): string | null {
  if (!t || typeof t !== "object") return "That message isn't a title and a body.";
  const x = t as Partial<PushTemplate>;
  if (!x.title?.trim() || !x.body?.trim()) return "A message needs a title and a body.";
  if (x.title.length > 120) return "That title is too long to send (120 characters).";
  if (x.body.length > 300) return "That body is too long to send (300 characters).";
  return null;
}

/**
 * What the ARENA is told when it owes somebody their money back.
 *
 * Separate from the customer templates and from their variable list. This is
 * the only message in the module that may carry a phone number, and it needs
 * one — an owner reading "we owe Rahul ₹500" at 9pm has to be able to ring
 * Rahul without going and finding him in the admin panel first.
 */
export type OwnerVars = {
  /** Who is owed. */
  name: string;
  /** Their number, so the arena can just call. */
  phone: string;
  /** How much, in whole rupees. */
  amount: number;
  /** "9pm–10pm". */
  hour: string;
  /** "Sun, 20 Sep". */
  date: string;
  /** "Full Field". */
  court: string;
};

export const OWNER_VARIABLES: { name: keyof OwnerVars; example: string; note: string }[] = [
  { name: "name", example: "Rahul", note: "who is owed the money" },
  { name: "phone", example: "98765 43210", note: "their number, so you can ring them" },
  { name: "amount", example: "500", note: "how much you owe them" },
  { name: "hour", example: "9pm–10pm", note: "the hour that fell through" },
  { name: "date", example: "Sun, 20 Sep", note: "the day it was for" },
  { name: "court", example: "Full Field", note: "which court" },
];

export const DEFAULT_OWNER_REFUND_PUSH: PushTemplate = {
  title: "Refund owed — ₹{amount} to {name}",
  body: "{date} {hour} on {court} was booked by somebody else before both captains had paid. Refund ₹{amount} to {name} ({phone}).",
};
