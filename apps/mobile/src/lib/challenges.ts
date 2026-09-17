import { api } from "./api";

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
};

export async function fetchChallengeBoard(sport?: string): Promise<ChallengeBoard> {
  const q = sport ? `?sport=${encodeURIComponent(sport)}` : "";
  return api.get<ChallengeBoard>(`/api/mobile/challenges${q}`);
}

export async function fetchChallenge(
  id: string,
): Promise<{ challenge: Challenge; viewerId: string }> {
  return api.get(`/api/mobile/challenges?id=${encodeURIComponent(id)}`);
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
