import { api } from "./api";

/**
 * Casual ("scratch") match scoring — the app half.
 *
 * Shares /api/match with the web, so the scoreboard maths and the
 * ownership rule live in exactly one place. Tournament scoring is a
 * different surface entirely (admin-issued scorer code) and nothing here
 * can reach it.
 */

export type MatchSport = "CRICKET" | "FOOTBALL" | "PICKLEBALL";

export interface MatchState {
  innings: number;
  runsA: number;
  runsB: number;
  wicketsA: number;
  wicketsB: number;
  ballsA: number;
  ballsB: number;
}

export interface PublicMatch {
  code: string;
  sport: MatchSport;
  status: string;
  teamAName: string;
  teamBName: string;
  oversPerInnings: number | null;
  state: MatchState;
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

export type ScoreEvent =
  | { t: "RUN"; runs: number }
  | { t: "WICKET" }
  | { t: "WIDE" }
  | { t: "NO_BALL"; runs?: number }
  | { t: "END_INNINGS" }
  | { t: "POINT"; side: "A" | "B" };

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
