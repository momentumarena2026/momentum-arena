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
  minPlayers: number;
  maxPlayers: number;
  maxWindows: number;
  maxCountersPerSide: number;
  ttlDays: number;
  sports?: string[];
};

export const DEFAULT_LIMITS: ChallengeLimits = {
  enabled: false,
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
export function windowRefusal(w: ProposedWindow, now: Date): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(w.date)) return "That date isn't valid.";
  if (!Number.isInteger(w.startHour) || !Number.isInteger(w.endHour)) {
    return "Pick whole hours.";
  }
  if (w.endHour <= w.startHour) return "The end time must be after the start.";
  if (w.endHour - w.startHour > 6) return "A match can't run more than six hours.";
  // Venue hours are 05:00–01:00, modelled as 5–25.
  if (w.startHour < 5 || w.endHour > 25) return "The arena is open 5am to 1am.";
  // IST midnight of the proposed day, against the same instant everywhere.
  const startsAt = new Date(`${w.date}T${String(w.startHour % 24).padStart(2, "0")}:00:00+05:30`);
  if (startsAt.getTime() <= now.getTime()) return "That time has already passed.";
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
    .map((w) => new Date(`${w.date}T${String(w.startHour % 24).padStart(2, "0")}:00:00+05:30`))
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
): string | null {
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
export function withdrawRefusal(c: ChallengeView, userId: string): string | null {
  if (!isLive(c.status)) return "That challenge is already closed.";
  if (c.createdByUserId !== userId) return "Only whoever posted it can withdraw it.";
  if (c.status === "AGREED" || c.status === "PART_PAID") {
    return "It's already matched — the venue has to unwind this one.";
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
