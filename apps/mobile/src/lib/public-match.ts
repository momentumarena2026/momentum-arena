import { api } from "./api";
import type {
  PublicMatchState,
  ScoreEvent,
  WicketKind,
} from "./match-engine";

// The scoreboard shape lives in the engine so the local replay and the
// server's agree by construction. Re-exported here because every screen
// already imports from this module.
export type MatchState = PublicMatchState;
export type { ScoreEvent, WicketKind };

/**
 * Casual ("scratch") match scoring — the app half.
 *
 * Shares /api/match with the web, so the scoreboard maths and the
 * ownership rule live in exactly one place. Tournament scoring is a
 * different surface entirely (admin-issued scorer code) and nothing here
 * can reach it.
 */

export type MatchSport = "CRICKET" | "FOOTBALL" | "PICKLEBALL";

export interface PublicMatch {
  code: string;
  sport: MatchSport;
  status: string;
  teamAName: string;
  teamBName: string;
  oversPerInnings: number | null;
  state: MatchState;
  /** The raw log, so the scorer's phone can append and replay locally. */
  events: ScoreEvent[];
  /** Server-decided: only the creator gets the scoring pad. */
  canScore: boolean;
}

export interface MyMatch {
  code: string;
  sport: MatchSport;
  status: string;
  teamAName: string;
  teamBName: string;
  createdAt: string;
  state: MatchState;
}

export const overs = (balls: number) =>
  `${Math.floor(balls / 6)}.${balls % 6}`;

export async function fetchMatch(code: string): Promise<PublicMatch> {
  const res = await api.get<{ match: PublicMatch }>(
    `/api/match?code=${encodeURIComponent(code)}`,
  );
  return res.match;
}

export async function fetchMyMatches(): Promise<MyMatch[]> {
  const res = await api.get<{ matches: MyMatch[] }>("/api/match?mine=1");
  return res.matches;
}

export async function createMatch(input: {
  sport: MatchSport;
  teamAName: string;
  teamBName: string;
  oversPerInnings?: number | null;
}): Promise<{ code?: string; error?: string }> {
  return api.post("/api/match", { action: "create", ...input });
}

export async function scoreMatch(
  code: string,
  event: ScoreEvent,
): Promise<{ state?: MatchState; error?: string }> {
  return api.post("/api/match", { action: "score", code, event });
}

/**
 * Flush a run of locally-applied taps in one write.
 *
 * The scorer's phone is the fast path: each tap is replayed on-device and
 * queued, then the queue goes up as a batch. Sending the whole batch (in
 * order, including any undos the scorer made before it flushed) means the
 * server replays exactly the same log we did, so the two can't drift.
 */
export async function scoreMatchBatch(
  code: string,
  events: Array<ScoreEvent | { t: "UNDO" }>,
): Promise<{ state?: MatchState; eventCount?: number; error?: string }> {
  return api.post("/api/match", { action: "score", code, events });
}

export async function undoMatch(
  code: string,
): Promise<{ state?: MatchState; error?: string }> {
  return api.post("/api/match", { action: "undo", code });
}

export async function finishMatch(
  code: string,
): Promise<{ success?: boolean; error?: string }> {
  return api.post("/api/match", { action: "finish", code });
}
