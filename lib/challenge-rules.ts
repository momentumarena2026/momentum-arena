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
function hourWord(h: number): string {
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
    return `Offer at most ${limits.maxWindows} times.`;
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
  for (const w of input.windows) {
    const bad = windowRefusal(w, now);
    if (bad) return bad;
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

/** Why this user cannot accept this window — or null. */
export function acceptRefusal(
  c: ChallengeView,
  userId: string,
  now: Date,
  /**
   * REQUIRED. A board that is switched off must stop new commitments, not
   * merely hide its own screen — a notification deep-link drops the user
   * straight onto the detail view, where Accept was still live. This was
   * optional, which meant a caller could omit it and silently reopen that
   * hole; there is no default worth having here.
   */
  limits: ChallengeLimits,
  /** The window being settled on, so its start can be checked. */
  win?: { date: Date; startHour: number } | null,
): string | null {
  if (!limits.enabled) return "The challenge board is currently switched off.";
  if (!isLive(c.status)) return "That challenge is no longer open.";
  if (c.status === "AGREED" || c.status === "PART_PAID") {
    return "That challenge has already been matched.";
  }
  // You cannot take up your OWN offer — but once somebody has countered,
  // the ball is back with the poster and accepting is precisely what they
  // are meant to do. Guarding on the author alone locked the poster out of
  // settling their own negotiation.
  if (c.status === "OPEN" && c.createdByUserId === userId) {
    return "You can't accept your own challenge.";
  }
  // A countered challenge belongs to the two already in it.
  if (c.status === "COUNTERED" && sideOf(c, userId) === null) {
    return "Someone else is already negotiating this one.";
  }
  // THE FREE-ACCEPT HOLE. Accepting is paying, so this path exists only for
  // somebody ALREADY in the match settling on a time — the poster taking a
  // counter, or an acceptor taking a counter back. A stranger reaching it
  // took a challenge off the board for nothing, and because a matched
  // challenge cannot be withdrawn, posted again, or expired, one free API
  // call removed a captain from the board permanently.
  if (sideOf(c, userId) === null) {
    return "Take this one by paying your half — that's what settles it.";
  }
  // The window being settled on must still be far enough out. Without this
  // the poster could free-accept a counter 3.5 hours away and both sides
  // then paid straight through the gate.
  if (win && limits.minLeadMins) {
    const start = new Date(win.date.getTime() + (win.startHour - 5.5) * 3600000);
    const late = leadTimeRefusal(start, now, limits.minLeadMins);
    if (late) return late;
  }
  if (c.expiresAt.getTime() <= now.getTime()) return "That challenge has expired.";
  return null;
}

/**
 * Why this user cannot counter-propose — or null.
 *
 * Capped per side so the board does not turn into a chat app. Once both
 * have used their counter it is take-it-or-leave-it, which is usually
 * when a match actually gets made.
 */
export function counterRefusal(
  c: ChallengeView,
  userId: string,
  limits: ChallengeLimits,
  now: Date,
): string | null {
  if (!limits.enabled) return "The challenge board is currently switched off.";
  if (!isLive(c.status)) return "That challenge is no longer open.";
  if (c.status === "AGREED" || c.status === "PART_PAID") {
    return "That challenge has already been matched.";
  }
  if (c.expiresAt.getTime() <= now.getTime()) return "That challenge has expired.";

  const side = sideOf(c, userId);
  // A stranger countering an OPEN challenge becomes its acceptor by doing
  // so — that is how a negotiation starts.
  if (!side) {
    if (c.status !== "OPEN") return "Someone else is already negotiating this one.";
    return limits.maxCountersPerSide < 1
      ? "Counter-offers are switched off — accept one of the times or leave it."
      : null;
  }
  const used = side === "CHALLENGER" ? c.counterCountChallenger : c.counterCountAcceptor;
  if (used >= limits.maxCountersPerSide) {
    return "You've used your counter-offer — take one of the times on the table, or leave it.";
  }
  // You cannot counter your own outstanding offer; the other side has it.
  if (side === "CHALLENGER" && c.status === "OPEN") {
    return "Nobody has responded yet — edit or withdraw the challenge instead.";
  }
  if (side === "ACCEPTOR" && c.status === "COUNTERED") {
    return "Your counter-offer is with them — wait for an answer.";
  }
  return null;
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
  if (c.status === "OPEN" || c.status === "COUNTERED") {
    return "Nobody has agreed a time yet — settle the time first.";
  }
  const side = sideOf(c, userId);
  if (!side) return "You're not part of this match.";
  if (paidSides.includes(side)) return "You've already paid your half.";
  if (c.status === "CONFIRMED") return "This match is already paid for.";
  return null;
}

/**
 * What a payment does to the challenge.
 *
 * The venue's decision (2026-09-18) is that the FIRST half blocks the
 * court. So the first payment is the one that creates a real booking and
 * takes the hour off the board; the second only settles the balance. That
 * ordering is what makes SLOT_LOST nearly unreachable — the old design
 * held no inventory until both had paid, which meant the second captain
 * could pay for an hour that had just gone.
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
 * The wheel the venue runs if it has not configured one.
 *
 * Tuned to the stated intent: a poster who spins ten times sees 50% about
 * once, and the average lands near 18% — inside the 15–25% band. The
 * jackpot alone is five points of that average, which is why everything
 * else sits low. Change it in the admin, not here.
 */
export const DEFAULT_WHEEL: WheelSegment[] = [
  { pct: 5, weight: 10 },
  { pct: 10, weight: 30 },
  { pct: 15, weight: 25 },
  { pct: 20, weight: 15 },
  { pct: 25, weight: 10 },
  { pct: 50, weight: 10 },
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
  return Array.isArray(stored) && stored.length > 0 ? (stored as WheelSegment[]) : DEFAULT_WHEEL;
}
