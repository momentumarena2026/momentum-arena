/**
 * The rules of the challenge board.
 *
 * Pure: no database, no request, no clock of its own — every function is
 * handed the state and the moment it should judge against. That is what
 * lets the app, the server and the tests all reach the same verdict, and
 * it is the lesson from the cricket engines, which disagreed for months
 * because each surface answered these questions for itself.
 *
 * The board's whole job is to introduce two captains who each have half a
 * match. So the bias throughout is: let people talk, cap the haggling,
 * hold no inventory until somebody has actually paid.
 */

export type ChallengeSide = "CHALLENGER" | "ACCEPTOR";

/**
 * The real instant a proposed window begins.
 *
 * The arena runs to 1am, so `startHour` legitimately reaches 24 and 25 —
 * and those mean the small hours of the NEXT day. Reducing them with
 * `% 24` against the same date puts the slot 24 hours early, which made a
 * midnight challenge read as "already passed" and gave a late-night one an
 * expiry a full day before its own match.
 */
/** "5am", "1am" — for a sentence, not a schedule. */
export function hourWord(h: number): string {
  const x = h % 24;
  const ampm = x >= 12 ? "pm" : "am";
  return `${x % 12 === 0 ? 12 : x % 12}${ampm}`;
}

export function windowStart(date: string, startHour: number): Date {
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() + (startHour - 5.5) * 3600000);
}

/** Mirrors the Sport enum. Kept here so the pure rules stay database-free. */
export const KNOWN_SPORTS = ["CRICKET", "FOOTBALL", "PICKLEBALL"];

export type ChallengeStatus =
  | "OPEN"
  | "COUNTERED"
  | "AGREED"
  | "PART_PAID"
  | "CONFIRMED"
  | "SLOT_LOST"
  | "EXPIRED"
  | "WITHDRAWN";

/** The settings the venue controls. Defaults match the schema. */
export type ChallengeLimits = {
  enabled: boolean;
  /** Notice the venue needs before a slot. 0 switches the gate off. */
  minLeadMins?: number;
  /** The arena's real trading hours, so nothing here assumes 5–25. */
  openHour?: number;
  closeHour?: number;
  minPlayers: number;
  maxPlayers: number;
  maxWindows: number;
  maxCountersPerSide: number;
  ttlDays: number;
  sports?: string[];
};

export const DEFAULT_LIMITS: ChallengeLimits = {
  enabled: false,
  minLeadMins: 240,
  minPlayers: 1,
  maxPlayers: 30,
  maxWindows: 3,
  maxCountersPerSide: 1,
  ttlDays: 7,
  sports: [],
};

export type ProposedWindow = {
  /** YYYY-MM-DD, IST. */
  date: string;
  startHour: number;
  endHour: number;
  courtConfigId?: string | null;
};

/** A challenge, as far as the rules are concerned. */
export type ChallengeView = {
  status: ChallengeStatus;
  createdByUserId: string;
  acceptedByUserId: string | null;
  expiresAt: Date;
  counterCountChallenger: number;
  counterCountAcceptor: number;
};

/** Statuses a challenge can still move on from. */
const LIVE: ChallengeStatus[] = ["OPEN", "COUNTERED", "AGREED", "PART_PAID"];

export function isLive(status: ChallengeStatus): boolean {
  return LIVE.includes(status);
}

/** Which side of this challenge a user is on, if either. */
export function sideOf(c: ChallengeView, userId: string): ChallengeSide | null {
  if (c.createdByUserId === userId) return "CHALLENGER";
  if (c.acceptedByUserId === userId) return "ACCEPTOR";
  return null;
}

// ── Posting ────────────────────────────────────────────────────────

/**
 * Why this challenge cannot be posted — or null.
 *
 * Windows are the substance: a challenge offering one time is a challenge
 * that mostly expires, which is why the venue can require more than one
 * but never fewer than one.
 */
export function postRefusal(
  input: {
    sport: string;
    playerCount: number;
    windows: ProposedWindow[];
  },
  limits: ChallengeLimits,
  now: Date,
): string | null {
  if (!limits.enabled) return "The challenge board is currently switched off.";
  // Checked against the arena's real sports even when the venue has not
  // narrowed the list: an unknown string used to reach Prisma's enum cast
  // and 500 the whole board for everyone.
  if (!KNOWN_SPORTS.includes(input.sport)) {
    return "That isn't a sport the arena runs.";
  }
  if (limits.sports?.length && !limits.sports.includes(input.sport)) {
    return "Challenges aren't open for that sport yet.";
  }
  if (!Number.isInteger(input.playerCount)) return "Say how many players you have.";
  if (input.playerCount < limits.minPlayers || input.playerCount > limits.maxPlayers) {
    return `Player count must be between ${limits.minPlayers} and ${limits.maxPlayers}.`;
  }
  if (input.windows.length === 0) return "Offer at least one time you can play.";
  if (input.windows.length > limits.maxWindows) {
    return limits.maxWindows === 1
      ? "Offer one time only."
      : `Offer at most ${limits.maxWindows} times.`;
  }
  // Posting is gated by the same notice the venue needs to staff an hour.
  // The app's day picker starts at tomorrow so this was unreachable there,
  // but the API is the API.
  // windowRefusal runs FIRST, so a time in the past is reported as a time in
  // the past rather than as "settle it four hours earlier".
  for (const w of input.windows) {
    const bad = windowRefusal(w, now, limits);
    if (bad) return bad;
  }
  if (limits.minLeadMins && limits.minLeadMins > 0) {
    for (const w of input.windows) {
      const bad = leadTimeRefusal(windowStart(w.date, w.startHour), now, limits.minLeadMins);
      if (bad) return bad;
    }
  }
  // Two identical windows waste a slot the captain could have used to
  // widen their net, which is the whole point of offering several.
  const seen = new Set(input.windows.map((w) => `${w.date}@${w.startHour}`));
  if (seen.size !== input.windows.length) return "Two of those times are the same.";
  return null;
}

/** Why one proposed window is not playable — or null. */
export function windowRefusal(
  w: ProposedWindow,
  now: Date,
  limits?: ChallengeLimits,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(w.date)) return "That date isn't valid.";
  // A well-SHAPED date is not a real one. `new Date("2026-09-31")` rolls
  // silently forward to 1 October, so the API accepted a date that does not
  // exist and booked the court a day after the one that was asked for.
  const asDate = new Date(`${w.date}T00:00:00.000Z`);
  if (Number.isNaN(asDate.getTime()) || asDate.toISOString().slice(0, 10) !== w.date) {
    return "That date isn't valid.";
  }
  if (!Number.isInteger(w.startHour) || !Number.isInteger(w.endHour)) {
    return "Pick whole hours.";
  }
  if (w.endHour <= w.startHour) return "The end time must be after the start.";
  if (w.endHour - w.startHour > 6) return "A match can't run more than six hours.";
  // The arena's real hours, passed in. Hard-coding 5–25 here meant the
  // board refused a slot the arena was selling the moment the venue moved
  // its closing time — and the prize picker, which reads the real setting,
  // happily offered the hour the board refused.
  const openH = limits?.openHour ?? 5;
  const closeH = limits?.closeHour ?? 25;
  if (w.startHour < openH || w.endHour > closeH) {
    return `The arena is open ${hourWord(openH)} to ${hourWord(closeH)}.`;
  }
  // windowStart, not a `% 24` on the same date — hours 24 and 25 are the
  // small hours of the NEXT day, and reducing them in place put the slot a
  // full day early.
  if (windowStart(w.date, w.startHour).getTime() <= now.getTime()) {
    return "That time has already passed.";
  }
  return null;
}

/**
 * When a challenge stops being offerable.
 *
 * The earlier of its last window and the configured TTL. Stored on the
 * record rather than recomputed: a deadline that moves because somebody
 * changed a setting is not a deadline.
 */
export function expiryFor(
  windows: ProposedWindow[],
  limits: ChallengeLimits,
  now: Date,
): Date {
  const ttl = new Date(now.getTime() + limits.ttlDays * 24 * 60 * 60 * 1000);
  const last = windows
    .map((w) => windowStart(w.date, w.startHour))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (!last) return ttl;
  return last.getTime() < ttl.getTime() ? last : ttl;
}

// ── Taking it up ───────────────────────────────────────────────────

/**
 * Why this user cannot settle on a time WITHOUT paying — which is now
 * always, and this function exists to say so in the customer's words.
 *
 * The free accept was the last route to a matched challenge with no money
 * in it, and it stayed open after the rest of the module closed. The guard
 * below refused anybody with no side — but the POSTER has a side, so on a
 * COUNTERED challenge they could settle a suggested time for nothing: the
 * challenge went AGREED, an acceptor was recorded who had paid nothing, and
 * because AGREED is not a board status it vanished from everybody else's
 * board. Exactly the state the suggest rewrite was built to remove,
 * reachable by one tap.
 *
 * It was reachable in the app too, and worse than a server hole: the
 * button was removed from the screen in the same release, but 80% of
 * installs were still on the previous OTA and still rendering it. A server
 * rule is the only kind that reaches a build somebody has not updated.
 *
 * Every other branch was already a refusal — a stranger, an OPEN challenge,
 * an already-matched one — so closing the poster's case leaves nothing this
 * can approve. That is the correct outcome, not an oversight: a time is
 * settled by paying for it, and there is no second way. The endpoint stays
 * so an old build gets this sentence instead of silently creating the bad
 * state; it is a tombstone that explains itself.
 */
export function acceptRefusal(
  c: ChallengeView,
  userId: string,
  now: Date,
  limits: ChallengeLimits,
  win?: { date: Date; startHour: number } | null,
): string | null {
  void c;
  void userId;
  void now;
  void limits;
  void win;
  return "Take this one by paying your half — that's what settles it.";
}


/** Why this user cannot withdraw — or null. Admins bypass this entirely. */
export function withdrawRefusal(
  c: ChallengeView,
  userId: string,
  /** Whether either side has actually paid. Defaults to the cautious answer. */
  anyPaid = true,
): string | null {
  if (!isLive(c.status)) return "That challenge is already closed.";
  if (c.createdByUserId !== userId) return "Only whoever posted it can withdraw it.";
  // Only money makes a match the venue's problem. An AGREED challenge that
  // nobody has paid for is still just an arrangement, and refusing to let
  // the poster withdraw it left them unable to withdraw, unable to post
  // again, and waiting on an expiry sweep that skipped AGREED entirely.
  if (c.status === "PART_PAID" || (c.status === "AGREED" && anyPaid)) {
    return "It's already matched and paid — the venue has to unwind this one.";
  }
  return null;
}

/** The status a challenge moves to when somebody counters. */
export function statusAfterCounter(): ChallengeStatus {
  return "COUNTERED";
}

/** Has this one run out of road, at the given moment? */
export function hasExpired(c: ChallengeView, now: Date): boolean {
  return isLive(c.status) && c.expiresAt.getTime() <= now.getTime();
}

// ── Paying ─────────────────────────────────────────────────────────

/**
 * How a court's price divides between the two sides.
 *
 * Half each, and when the total is an odd number of rupees the CHALLENGER
 * pays the extra one. Somebody has to, the difference is a rupee, and the
 * poster is the side that chose to start this — but the real reason to fix
 * it in one tested function is that the two halves must always add back to
 * the total exactly. A `Math.round` on each side independently can produce
 * two halves that sum to a rupee more than the court costs, and that rupee
 * then has to come from somewhere at reconciliation time.
 */
export function splitShare(total: number): { CHALLENGER: number; ACCEPTOR: number } {
  const acceptor = Math.floor(total / 2);
  return { CHALLENGER: total - acceptor, ACCEPTOR: acceptor };
}

/**
 * The two halves once a booking exists — read off the BOOKING, not a quote.
 *
 * `splitShare` is right until the moment the court is sold. After that the
 * advance is whatever the booking says it is, and the second captain owes
 * exactly what is left of it. Re-quoting instead cost real money twice in
 * testing: with `advancePct` edited from 50 to 75 between the two halves the
 * second captain was charged ₹750 against a ₹500 ledger move and paid ₹2250
 * for a ₹2000 court; edited downwards, the venue booked ₹250 of revenue
 * nobody had paid.
 *
 * The invariant this exists to hold: the two halves add to exactly the
 * booking's advance, whatever the venue does to its price list in between.
 */
export function sharesAgainstBooking(args: {
  advanceAmount: number;
  /** What the booking's payment has already collected. */
  settled: number;
  /** The side whose money is already in. */
  paidSide: ChallengeSide;
}): { CHALLENGER: number; ACCEPTOR: number } {
  const settled = Math.min(Math.max(0, args.settled), Math.max(0, args.advanceAmount));
  const outstanding = Math.max(0, args.advanceAmount - settled);
  return args.paidSide === "CHALLENGER"
    ? { CHALLENGER: settled, ACCEPTOR: outstanding }
    : { CHALLENGER: outstanding, ACCEPTOR: settled };
}

/**
 * Why this person cannot pay their half right now — or null.
 *
 * `paidSides` is which halves are already in. The court-availability
 * question is deliberately NOT asked here: it needs the database, it can
 * change between this check and the charge, and it is the caller's job to
 * re-ask it inside the transaction that takes the money.
 */
export function payRefusal(
  c: ChallengeView,
  userId: string,
  now: Date,
  paidSides: ChallengeSide[],
): string | null {
  if (c.status === "WITHDRAWN") return "That challenge was called off.";
  if (c.status === "EXPIRED") return "That challenge expired.";
  if (c.status === "SLOT_LOST") {
    return "The court went to somebody else before both halves were in.";
  }
  // OPEN and COUNTERED reach here only when the caller is NOT taking a
  // specific time — `challengeQuote` routes an acceptance to
  // `acceptGateRefusal` instead. I briefly added an `acceptingNow` flag
  // here and it was dead on both call sites; the fix belonged one level up,
  // in which statuses count as accepting.
  if (c.status === "OPEN" || c.status === "COUNTERED") {
    return "Nobody has agreed a time yet — settle the time first.";
  }
  const side = sideOf(c, userId);
  if (!side) {
    // A stranger who was one second too slow is not "not part of this match" —
    // that reads as a permissions bug to somebody who was looking at the board
    // a moment ago. This is the refusal they actually hit, and the friendlier
    // wording added downstream in createChallengePaymentOrder never fired
    // because THIS runs first.
    return c.acceptedByUserId
      ? "Somebody else has taken this one."
      : "You're not part of this match.";
  }
  if (paidSides.includes(side)) return "You've already paid your half.";
  if (c.status === "CONFIRMED") return "This match is already paid for.";
  return null;
}

/**
 * What a payment does to the challenge.
 *
 * The venue's decision (2026-09-19, reversing 2026-09-18) is that the court
 * is bought only when BOTH halves are paid. So neither payment creates a
 * booking on its own: the first leaves the challenge PART_PAID with nothing
 * held, and the SECOND buys the hour. SLOT_LOST is therefore a real outcome
 * rather than a near-impossible one — an hour two captains are part-way
 * through buying can be sold to a walk-in — which is why every path out of
 * that case tells both captains, flags the money, and tells the arena.
 */
export function statusAfterPayment(paidSidesIncludingThis: ChallengeSide[]): ChallengeStatus {
  // DISTINCT sides, not array length. Counting the array let the same side
  // appearing twice confirm a match on one half — which is exactly what
  // happened when a caller's own freshly-claimed row was read back into the
  // list it was being compared against.
  return new Set(paidSidesIncludingThis).size >= 2 ? "CONFIRMED" : "PART_PAID";
}

// ── The wheel ──────────────────────────────────────────────────────

export type WheelSegment = { pct: number; weight: number };

/**
 * The wheel used when the venue has saved none of their own — and the one
 * `resolveWheel` falls back to when every weight is zero.
 *
 * It averages 9%, because the arena's rule is that a discounted hour must
 * still bring in ₹1,800 of a ₹2,000 court. The previous default averaged
 * 17.75% (₹1,645 an hour), which after the band moved to 5–10% would have
 * been a fallback that violates the rule AND that `wheelRefusal` refuses to
 * save — so clearing the segments would have wedged the settings page.
 * A default has to satisfy the same guard as anything typed by hand.
 *
 * Change it in the admin, not here.
 */
export const DEFAULT_WHEEL: WheelSegment[] = [
  { pct: 5, weight: 45 },
  { pct: 10, weight: 40 },
  { pct: 15, weight: 10 },
  { pct: 25, weight: 5 },
];

/** Total weight, or 0 for a wheel that cannot be spun. */
function totalWeight(segs: WheelSegment[]): number {
  return segs.reduce((s, x) => s + (x.weight > 0 ? x.weight : 0), 0);
}

/**
 * What this wheel costs on average, in percent.
 *
 * This is the number the admin is tuning against, and it is DERIVED rather
 * than configured — average, floor and ceiling are not independent, so
 * three input boxes can be set to a combination no distribution satisfies.
 * The screen shows this live as the weights are edited.
 */
export function wheelAveragePct(segs: WheelSegment[]): number {
  const total = totalWeight(segs);
  if (total <= 0) return 0;
  return segs.reduce((s, x) => s + x.pct * Math.max(0, x.weight), 0) / total;
}

/** The odds of each segment, for the admin screen and the odds disclosure. */
export function wheelOdds(segs: WheelSegment[]): { pct: number; chance: number }[] {
  const total = totalWeight(segs);
  if (total <= 0) return [];
  return segs
    .filter((x) => x.weight > 0)
    .map((x) => ({ pct: x.pct, chance: x.weight / total }));
}

/**
 * Why this wheel may not be saved — or null.
 *
 * The band check is the point: a venue tuning weights by hand will drift,
 * and the wheel that pays out 40% on average looks exactly like the one
 * that pays 18% until the month's numbers come in.
 */
export function wheelRefusal(
  segs: WheelSegment[],
  avgMinPct: number,
  avgMaxPct: number,
): string | null {
  if (!Array.isArray(segs) || segs.length === 0) return "Add at least one segment.";
  // Whole percents only. `ChallengeSpin.wonPct` and
  // `ChallengeOffer.discountPct` are Int columns, so 17.5 is truncated to
  // 17 on write — and the poster is then shown a price derived from 17.5
  // at the moment of winning and charged one derived from 17. The number
  // on the screen has to be the number in the database.
  if (segs.some((x) => !Number.isInteger(x.pct) || x.pct < 0 || x.pct > 100)) {
    return "Every segment must be a whole number between 0% and 100%.";
  }
  if (segs.some((x) => x.weight === undefined || x.weight === null)) {
    return "Every segment needs a weight.";
  }
  if (segs.some((x) => !Number.isFinite(x.weight) || x.weight < 0)) {
    return "Weights cannot be negative.";
  }
  if (totalWeight(segs) <= 0) return "At least one segment needs a weight above zero.";
  const avg = wheelAveragePct(segs);
  if (avg < avgMinPct) {
    return `This wheel averages ${avg.toFixed(1)}%, below your ${avgMinPct}% floor — players will feel it.`;
  }
  if (avg > avgMaxPct) {
    return `This wheel averages ${avg.toFixed(1)}%, above your ${avgMaxPct}% ceiling — that is what it will cost you.`;
  }
  return null;
}

/**
 * Draw a segment.
 *
 * `roll` is a number in [0, 1) supplied by the caller so this stays pure and
 * the tests can pin every boundary. The selection is honestly weighted: the
 * wheel rarely STOPS on 50% because 50% rarely WINS, not because the
 * animation is steered away from a result it already landed on. Those are
 * different things, and only the first one survives a player watching
 * closely.
 */
export function spinWheel(segs: WheelSegment[], roll: number): number {
  const live = segs.filter((x) => x.weight > 0);
  const total = totalWeight(live);
  if (total <= 0) return 0;
  const target = Math.min(Math.max(roll, 0), 0.999999999) * total;
  let seen = 0;
  for (const seg of live) {
    seen += seg.weight;
    if (target < seen) return seg.pct;
  }
  return live[live.length - 1].pct;
}

/**
 * Why a challenge cannot be posted, accepted or paid this close to the slot
 * — or null.
 *
 * The venue needs notice to staff an hour, and a match agreed twenty
 * minutes out is a court nobody turns up to.
 */
export function leadTimeRefusal(
  slotStart: Date,
  now: Date,
  minLeadMins: number,
): string | null {
  if (minLeadMins <= 0) return null;
  const mins = (slotStart.getTime() - now.getTime()) / 60000;
  if (mins >= minLeadMins) return null;
  const h = Math.floor(minLeadMins / 60);
  const m = minLeadMins % 60;
  const window = h > 0 ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
  return `Challenges have to be settled at least ${window} before the slot.`;
}

/**
 * The wheel that will ACTUALLY spin, given whatever is stored.
 *
 * Shared by the runtime and the save-time validator for the same reason as
 * `resolvePushes`: a null or empty column is not "no wheel", it is the
 * built-in wheel, and that is what pays out. Validating the column instead
 * of this let a 0–1% band save against a live 17.75% wheel.
 */
export function resolveWheel(stored: unknown): WheelSegment[] {
  if (!Array.isArray(stored) || stored.length === 0) return DEFAULT_WHEEL;
  // A segment saved without a weight — `[{pct:20}]`, reachable by writing the
  // column directly — made the total weight 0, and `spinWheel` then returned 0,
  // so EVERY spin won "0% off" while the odds disclosure came back empty. An
  // absent weight is not a zero chance; it is an unspecified one, and one is
  // the only reading that keeps the wheel winnable.
  const fixed = (stored as WheelSegment[]).map((s) => ({
    ...s,
    weight: typeof s?.weight === "number" && Number.isFinite(s.weight) ? s.weight : 1,
  }));
  return fixed.some((s) => s.weight > 0) ? fixed : DEFAULT_WHEEL;
}

/* ── The payment hold ────────────────────────────────────────────── */

/**
 * How long a stranger has to wait, in words they can act on.
 *
 * "Try again shortly" is what the board said for a wait that could be two
 * hours, which is not shortly — it is "come back after dinner". The person
 * reading it has no way to tell a thirty-second race from an abandoned
 * sheet, so they tap Pay again, get the same sentence, and conclude the
 * feature is broken. Telling them the number costs nothing and is the
 * difference between waiting and giving up.
 *
 * Relative rather than a clock time on purpose: a clock time needs the
 * venue's timezone, and this file is pure and shared with the phone.
 * "in about 40 minutes" also survives a device whose clock is wrong.
 *
 * Rounds UP. Promising "about 5 minutes" for 5 minutes 50 seconds sends
 * somebody back one minute early to the same refusal.
 */
export function holdWaitPhrase(msLeft: number): string {
  if (msLeft <= 0) return "now";
  const mins = Math.ceil(msLeft / 60000);
  if (mins <= 1) return "in under a minute";
  if (mins < 60) return `in about ${mins} minutes`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  const hourPart = `${hours} hour${hours === 1 ? "" : "s"}`;
  if (rest === 0) return `in about ${hourPart}`;
  return `in about ${hourPart} ${rest} minute${rest === 1 ? "" : "s"}`;
}

/**
 * What a stranger is told when somebody else holds the payment slot.
 *
 * One sentence, in one place, so the two refusal sites and the screen that
 * renders the hold cannot drift apart — they did: the alert said "shortly"
 * while the payload said nothing at all, and the only way to discover the
 * real wait was to read the settings table.
 */
export function heldByOtherMessage(msLeft: number): string {
  return `Someone else is paying for this right now. If they don't finish, it frees up ${holdWaitPhrase(msLeft)}.`;
}

/**
 * How long a released slot is still held for, given the venue's window.
 *
 * The grace exists so a UPI collect the customer already approved can
 * settle on THEM rather than on whoever grabs the slot next. A flat five
 * minutes was fine against a two-hour window and became useless the moment
 * the venue set the window to five: grace == window means a release can
 * never bring anything forward, so the button did nothing and the customer
 * reported it broken. They were right — a control whose only outcome is
 * "that did nothing" is broken however correct the arithmetic.
 *
 * So it scales: never more than half the window, never less than a minute.
 * At a 5-minute window a release cuts the wait to 2 minutes; at 120 it
 * still gives the full 5. The protection shrinks with the window, which is
 * the venue's own trade-off — they already accepted that a collect
 * resolving after 5 minutes can strand when they set the window there.
 *
 * DOMAIN: windows of 2 minutes or more, which is every window the admin
 * screen can save (it bounds `paymentWindowMins` at 5–1440). Below that
 * the one-minute floor meets the window and a release is a no-op again —
 * there is no sensible grace inside a one-minute hold, and the floor is
 * the more important of the two guarantees, because a zero grace releases
 * instantly and that is what strands a late collect.
 */
export function releaseGraceMins(windowMins: number, maxGraceMins: number): number {
  return Math.max(1, Math.min(maxGraceMins, Math.floor(windowMins / 2)));
}

/**
 * When a released payment slot actually opens to everyone.
 *
 * Pure, and separate from the write, because getting it backwards is easy
 * and invisible: the first version of this compared the BACKDATED stamp
 * against the existing one and wrote whenever the new value was larger —
 * which is precisely the case where it extends the hold. Releasing a slot
 * whose window had already lapsed two hours earlier resurrected it for
 * another five minutes. Caught against staging, not by reading it.
 *
 * The rule in one line: a release may only ever bring the deadline
 * FORWARD. `min(existing, now + grace)`.
 */
export function releasedFreeAt(
  existingFreeAtMs: number,
  nowMs: number,
  graceMins: number,
): number {
  return Math.min(existingFreeAtMs, nowMs + graceMins * 60000);
}

/* ── Suggesting a different time ─────────────────────────────────── */

/**
 * A window as the takeability rules need to see it.
 *
 * `approvedAt` only ever applies to a window somebody OTHER than the poster
 * proposed. The poster's own times need no approval — they are the offer.
 */
export type WindowView = {
  status: "OFFERED" | "ACCEPTED" | "DECLINED" | "SUPERSEDED";
  proposedBy: ChallengeSide;
  approvedAt: Date | null;
};

/**
 * Can anybody buy this time?
 *
 * The rule the whole "suggest a time" flow turns on. A window the poster
 * put up is on sale the moment it exists. A window somebody else suggested
 * is NOT — it is a question addressed to the poster, and it only joins the
 * board once they have said yes.
 *
 * Getting this backwards is what made a suggestion behave like a claim: the
 * old flow let a stranger propose a time, become the acceptor by doing so,
 * and take the whole challenge off the board without paying anything. One
 * tap, no money, and nobody else could see the match again.
 */
export function windowIsTakeable(w: WindowView): boolean {
  if (w.status !== "OFFERED") return false;
  return w.proposedBy === "CHALLENGER" || w.approvedAt !== null;
}

/** A suggestion still waiting for the poster's answer. */
export function windowAwaitsPoster(w: WindowView): boolean {
  return w.status === "OFFERED" && w.proposedBy === "ACCEPTOR" && w.approvedAt === null;
}

/**
 * Why this user cannot suggest a different time — or null.
 *
 * Replaces `counterRefusal`'s side arithmetic, which existed because a
 * counter used to claim the acceptor slot and therefore had to be rationed
 * per side. A suggestion claims nothing now, so the only questions left are
 * whether the board is open, whether the challenge is still live and unsold,
 * whether the poster is suggesting to themselves, and whether this person
 * has already had their say.
 *
 * Counted per PERSON, from the windows they have already proposed, rather
 * than from a per-side column: any number of strangers may each suggest a
 * time, and one of them exhausting a shared counter would silence the rest.
 */
export function suggestRefusal(
  c: ChallengeView,
  userId: string,
  /**
   * What this person has already asked, split by whether the poster has
   * answered it.
   *
   * A bare count told somebody whose suggestion was agreed to NINE HOURS
   * earlier — and who had been pushed about it — to "wait for their
   * answer". The count is what caps them; whether they are still waiting is
   * what the sentence has to say.
   */
  mine: { total: number; pending: number },
  limits: ChallengeLimits,
  now: Date,
): string | null {
  if (!limits.enabled) return "The challenge board is currently switched off.";
  if (!isLive(c.status)) return "That challenge is no longer open.";
  // Money has moved. The times are settled and this is no longer a haggle.
  if (c.status === "PART_PAID" || c.status === "AGREED") {
    return "Somebody has already paid for this match.";
  }
  if (c.expiresAt.getTime() <= now.getTime()) return "That challenge has expired.";
  if (c.createdByUserId === userId) {
    return "This is your own challenge — add a time to it instead.";
  }
  if (limits.maxCountersPerSide < 1) {
    return "Suggesting other times is switched off — take one of the times on the table, or leave it.";
  }
  if (mine.total >= limits.maxCountersPerSide) {
    return mine.pending > 0
      ? "You've already suggested a time on this one. Wait for their answer, or take a time they offered."
      : "They've answered your suggestion — take one of the times on the table.";
  }
  return null;
}

/**
 * Why this user cannot answer a suggestion — or null.
 *
 * Only the poster answers, and only a suggestion that is still waiting.
 * Both halves matter: the first stops a stranger agreeing to a time on
 * somebody else's match, and the second stops an answer landing twice,
 * which would send the suggester "they agreed" and "they can't" in
 * whichever order the taps arrived.
 */
export function suggestAnswerRefusal(
  c: ChallengeView,
  w: WindowView,
  userId: string,
  now: Date,
): string | null {
  if (c.createdByUserId !== userId) return "Only whoever posted the match can answer that.";
  if (!isLive(c.status)) return "That challenge is no longer open.";
  if (c.expiresAt.getTime() <= now.getTime()) return "That challenge has expired.";
  if (!windowAwaitsPoster(w)) return "You've already answered that one.";
  return null;
}
