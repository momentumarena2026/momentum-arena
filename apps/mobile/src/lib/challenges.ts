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

export type SpinResult = {
  pct: number;
  kind: "ADJACENT" | "FALLBACK";
  offerId: string;
  expiresAt: string;
  hour: string | null;
  price: number | null;
  saving: number | null;
};

export async function spinChallengeWheel(challengeId: string): Promise<SpinResult> {
  return api.post("/api/mobile/challenges", { op: "spin", challengeId });
}

export type OfferPick = { courtConfigId: string; date: string; startHour: number };

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
export function hourLabel(h: number): string {
  const x = h % 24;
  return x === 0 ? "12am" : x < 12 ? `${x}am` : x === 12 ? "12pm" : `${x - 12}pm`;
}

export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}
