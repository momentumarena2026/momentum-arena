import { api, ApiError } from "./api";

/**
 * The challenge board, app side.
 *
 * App-only feature, so this is the only client there is. Types mirror what
 * /api/mobile/challenges returns; the rules that decide what may happen
 * live on the server and come back as plain sentences, which the screens
 * show as-is rather than re-deriving.
 */

export type ChallengeSide = "CHALLENGER" | "ACCEPTOR";

export type ChallengeWindow = {
  id: string;
  date: string;
  startHour: number;
  endHour: number;
  proposedBy: ChallengeSide;
  status: "OFFERED" | "ACCEPTED" | "DECLINED" | "SUPERSEDED";
  courtConfig: { id: string; label: string } | null;
};

export type Challenge = {
  spin?: { id: string } | null;
  id: string;
  sport: string;
  teamName: string | null;
  playerCount: number;
  notes: string | null;
  status: string;
  expiresAt: string;
  createdAt: string;
  createdByUserId: string;
  acceptedByUserId: string | null;
  agreedWindowId: string | null;
  counterCountChallenger: number;
  counterCountAcceptor: number;
  bookingId: string | null;
  createdBy: { id: string; name: string | null } | null;
  acceptedBy: { id: string; name: string | null } | null;
  windows: ChallengeWindow[];
};

export type ChallengeBoard = {
  spinEnabled: boolean;
  enabled: boolean;
  viewerId: string;
  board: Challenge[];
  mine: Challenge[];
  limits: {
    sports: string[];
    minPlayers: number;
    maxPlayers: number;
    maxWindows: number;
    maxCountersPerSide: number;
    openHour: number;
    closeHour: number;
    minLeadMins: number;
  };
  copy: { title: string | null; subtitle: string | null; empty: string | null };
  homeCard: {
    enabled: boolean;
    title: string | null;
    subtitle: string | null;
    badge: string;
  };
};

/** Taps worth seeing that change nothing on the server. Fire and forget —
 *  a dropped telemetry call must never cost the user their tap. */
/**
 * The sentence to show when a challenge action fails.
 *
 * Every refusal the server issues is a deliberate, readable reason — "Player
 * count must be between 1 and 30", "The challenge board is currently switched
 * off" — and `api.ts` already puts it on `ApiError.message`. A blanket
 * `.catch(() => "Couldn't reach the arena.")` threw all of that away and told
 * the user about a network failure that had not happened, while the admin
 * event log recorded the real reason: the log would then be a record of a
 * sentence nobody was ever shown. Reserve the reachability message for an
 * actual reachability failure, which `api.ts` reports as status 0.
 */
export function challengeErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return "Couldn't reach the arena.";
    if (e.message) return e.message;
  }
  return "Couldn't reach the arena.";
}

export function trackChallenge(
  type: "HOME_CARD_SHOWN" | "HOME_CARD_TAPPED" | "POST_OPENED" | "ACCEPT_TAPPED" | "COUNTER_OPENED",
  extra?: { challengeId?: string | null; detail?: string | null },
): void {
  void api
    .post("/api/mobile/challenges", { op: "track", type, ...extra })
    .catch(() => undefined);
}

// `settingsOnly` marks the Home screen's read, which wants the card copy and
// nothing else. It must not be counted as somebody opening the board, or board
// views become a count of Home renders and the funnel loses its meaning.
export async function fetchChallengeBoard(
  sport?: string,
  settingsOnly = false,
): Promise<ChallengeBoard> {
  const params = new URLSearchParams();
  if (sport) params.set("sport", sport);
  if (settingsOnly) params.set("for", "home");
  const q = params.toString();
  return api.get<ChallengeBoard>(`/api/mobile/challenges${q ? `?${q}` : ""}`);
}

export type ChallengeQuote = {
  courtConfigId: string | null;
  courtLabel: string | null;
  hours: number[];
  total: number;
  advance: number;
  venueBalance: number;
  shares: { CHALLENGER: number; ACCEPTOR: number };
  paidSides: ChallengeSide[];
  yourShare: number | null;
  yourSide: ChallengeSide | null;
  youHavePaid: boolean;
  refusal: string | null;
};

export async function fetchChallenge(id: string): Promise<{
  challenge: Challenge;
  viewerId: string;
  counterBlock: string | null;
  quote: ChallengeQuote | null;
  spinEnabled: boolean;
  boardEnabled: boolean;
  /** The venue's real segments, so the wheel drawn is the wheel that spun. */
  wheel: { pct: number; weight: number }[];
  /** Per-window price and refusal for a prospective taker. */
  windowQuotes: {
    windowId: string;
    share: number | null;
    /** The whole court for that window, so the price is visible before paying. */
    total: number;
    /** What is still due at the gate on the day. */
    venueBalance: number;
    refusal: string | null;
  }[];
  hours: { start: number; end: number };
  /** The venue's notice period, so the counter picker offers only legal times. */
  minLeadMins: number;
  /** Who is holding a payment slot, if anyone. Null when nobody is. */
  hold: PaymentHold | null;
  /** What the spin came to, spent or not. Null means never spun. */
  spin: {
    pct: number;
    spentOn: string | null;
    hour: string | null;
    date: string | null;
    /** The wheel as it was when they spun, not as the venue has it now. */
    segments: { pct: number; weight: number }[];
  } | null;
  /** A prize already won and not yet spent — survives an app restart. */
  offer: {
    offerId: string;
    pct: number;
    kind: "ADJACENT" | "FALLBACK";
    /** That specific hour has been sold since the spin. */
    gone?: boolean;
    expiresAt: string;
    minsLeft: number;
    hour: string | null;
    price: number | null;
    saving: number | null;
    date: string | null;
  } | null;
}> {
  return api.get(`/api/mobile/challenges?id=${encodeURIComponent(id)}`);
}

export async function createChallengePayOrder(
  challengeId: string,
  /** Present when this payment IS the acceptance of that window. */
  windowId?: string,
): Promise<{ orderId: string; keyId: string; amount: number; courtLabel: string | null }> {
  return api.post("/api/mobile/challenges", { op: "pay-order", challengeId, windowId });
}

/**
 * Give back a payment slot you opened and are not going to pay.
 *
 * Until this existed, opening the sheet claimed your side of the match for
 * the venue's whole payment window — two hours here — and nothing could
 * unclaim it. The match sat on the board telling every stranger who tapped
 * Pay that somebody else was paying "right now", about a sheet that had
 * been closed since breakfast.
 *
 * The server does not free it instantly: a UPI collect approved in a bank
 * app can land minutes later, and it has to land on the person who started
 * it rather than on whoever grabbed the slot in between. `freeAt` is when
 * it actually opens to everyone.
 *
 * `shortened` is false when the hold was already going to lapse sooner than
 * the grace period — which is every release once the venue's payment window
 * is at or below it. Saying "released!" there would claim an action the
 * server did not take.
 */
export async function releaseChallengePayHold(
  challengeId: string,
): Promise<{ ok: true; freeAt: string; shortened: boolean }> {
  return api.post("/api/mobile/challenges", { op: "pay-release", challengeId });
}

/** Who is holding a payment slot on this challenge, if anyone. */
export type PaymentHold = {
  side: "CHALLENGER" | "ACCEPTOR";
  heldByViewer: boolean;
  /** ISO. When the hold lapses and anyone may pay. */
  freeAt: string;
  msLeft: number;
  /** The server's own sentence — this screen does not write its own. */
  message: string;
};

export type SpinResult = {
  pct: number;
  kind: "ADJACENT" | "FALLBACK";
  /** That specific hour has been sold since the spin. */
  gone?: boolean;
  offerId: string;
  expiresAt: string;
  hour: string | null;
  date: string | null;
  price: number | null;
  saving: number | null;
};

export async function spinChallengeWheel(challengeId: string): Promise<SpinResult> {
  return api.post("/api/mobile/challenges", { op: "spin", challengeId });
}

export type OfferPick = { courtConfigId: string; date: string; startHour: number };

export type OfferSlots = {
  pct: number;
  minsLeft: number;
  days: {
    date: string;
    courtConfigId: string;
    courtLabel: string;
    hours: { startHour: number; label: string; fullPrice: number; price: number }[];
  }[];
};

export async function fetchOfferSlots(offerId: string): Promise<OfferSlots> {
  return api.post("/api/mobile/challenges", { op: "offer-slots", offerId });
}

export async function createOfferPayOrder(
  offerId: string,
  pick?: OfferPick,
): Promise<{ orderId: string; keyId: string; amount: number; saving: number; minsLeft: number }> {
  return api.post("/api/mobile/challenges", { op: "offer-order", offerId, pick });
}

export async function verifyOfferPayment(input: {
  offerId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  pick?: OfferPick;
}): Promise<{ ok: boolean; bookingId: string }> {
  return api.post("/api/mobile/challenges", { op: "offer-verify", ...input });
}

export async function verifyChallengePayment(input: {
  challengeId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}): Promise<{ ok: boolean; status: string; bookingId: string | null }> {
  return api.post("/api/mobile/challenges", { op: "pay-verify", ...input });
}

export type ProposedWindow = {
  date: string;
  startHour: number;
  endHour: number;
  courtConfigId?: string | null;
};

export async function postChallenge(input: {
  sport: string;
  teamName?: string | null;
  playerCount: number;
  notes?: string | null;
  windows: ProposedWindow[];
}): Promise<{ ok?: boolean; id?: string; error?: string }> {
  return api.post("/api/mobile/challenges", { op: "post", ...input });
}

export async function acceptChallenge(
  challengeId: string,
  windowId: string,
): Promise<{ ok?: boolean; error?: string }> {
  return api.post("/api/mobile/challenges", { op: "accept", challengeId, windowId });
}

export async function counterChallenge(
  challengeId: string,
  window: ProposedWindow,
): Promise<{ ok?: boolean; error?: string }> {
  return api.post("/api/mobile/challenges", { op: "counter", challengeId, window });
}

export async function withdrawChallenge(
  challengeId: string,
  reason?: string,
): Promise<{ ok?: boolean; error?: string }> {
  return api.post("/api/mobile/challenges", { op: "withdraw", challengeId, reason });
}

/** "6pm", "12am" — the arena runs 5am to 1am, so hours can reach 25. */
/**
 * What a challenge's state is, in words a captain uses.
 *
 * The raw enum was being shown: "· open", "· countered", "· part paid". The
 * last one is the worst of them — it is the state where somebody's money is
 * in and somebody else's is not, which is exactly when the screen needs to
 * be clear rather than to leak a column name.
 */
export function statusLabel(status: string): string {
  switch (status) {
    case "OPEN":
      return "looking for a match";
    case "COUNTERED":
      return "counter-offered";
    case "AGREED":
      return "matched, both halves due";
    case "PART_PAID":
      return "half paid — hour not held yet";
    case "CONFIRMED":
      return "paid, court booked";
    case "SLOT_LOST":
      return "the hour went";
    case "WITHDRAWN":
      return "withdrawn";
    case "EXPIRED":
      return "expired";
    default:
      return status.replace(/_/g, " ").toLowerCase();
  }
}

export function hourLabel(h: number): string {
  const x = h % 24;
  return x === 0 ? "12am" : x < 12 ? `${x}am` : x === 12 ? "12pm" : `${x - 12}pm`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Sun, 20 Sep" — spelled out rather than left to `toLocaleDateString`.
 *
 * ICU abbreviates September as "Sept" in some builds and "Sep" in others, and
 * the server and Hermes disagreed: one screen showed "24 Sept" on the prize
 * card and "24 Sep" in the window list directly below it. This must match
 * `istDayLabel` in lib/challenge-spin.ts exactly — the same day is written by
 * both, sometimes in the same sentence.
 */
export function dayLabel(iso: string): string {
  // Windows are stored as a UTC-midnight instant standing for an IST day, so
  // the UTC parts ARE the venue's day. Reading them in Asia/Kolkata would be
  // the same answer for midnight and a day out for anything else.
  const d = new Date(iso);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
