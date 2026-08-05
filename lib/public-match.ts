import { db } from "@/lib/db";
import { randomInt } from "crypto";

/**
 * Casual ("scratch") match scoring, open to anyone playing at the arena.
 *
 * Completely separate from tournament scoring, which stays behind the
 * admin-issued rotatable scorerCode — nothing in this file can read or
 * write a TournamentMatch.
 *
 * The scoreboard is derived by REPLAYING the event log rather than
 * mutated in place. That makes undo exact (drop the last event and
 * replay) instead of a guess at what to subtract, which is where naive
 * scoreboards go wrong on a wide-off-a-no-ball.
 */

export type PublicMatchSport = "CRICKET" | "FOOTBALL" | "PICKLEBALL";

export type ScoreEvent =
  // Cricket
  | { t: "RUN"; runs: number }
  | { t: "WICKET" }
  | { t: "WIDE" }
  | { t: "NO_BALL"; runs?: number }
  | { t: "END_INNINGS" }
  // Football / pickleball
  | { t: "POINT"; side: "A" | "B" };

export interface PublicMatchState {
  /** Cricket: 0 = first innings, 1 = second. Others: always 0. */
  innings: number;
  runsA: number;
  runsB: number;
  wicketsA: number;
  wicketsB: number;
  /** Legal balls bowled in each innings. */
  ballsA: number;
  ballsB: number;
}

const EMPTY: PublicMatchState = {
  innings: 0,
  runsA: 0,
  runsB: 0,
  wicketsA: 0,
  wicketsB: 0,
  ballsA: 0,
  ballsB: 0,
};

/** Rebuild the scoreboard from scratch. The single source of truth. */
export function replay(
  events: ScoreEvent[],
  sport: PublicMatchSport,
): PublicMatchState {
  const s: PublicMatchState = { ...EMPTY };

  for (const e of events) {
    if (sport !== "CRICKET") {
      if (e.t === "POINT") {
        if (e.side === "A") s.runsA += 1;
        else s.runsB += 1;
      }
      continue;
    }

    // Cricket: everything lands on whichever side is batting.
    const batA = s.innings === 0;
    const addRuns = (n: number) => {
      if (batA) s.runsA += n;
      else s.runsB += n;
    };
    const addBall = () => {
      if (batA) s.ballsA += 1;
      else s.ballsB += 1;
    };

    switch (e.t) {
      case "RUN":
        addRuns(Math.max(0, e.runs));
        addBall();
        break;
      case "WICKET":
        if (batA) s.wicketsA += 1;
        else s.wicketsB += 1;
        addBall();
        break;
      case "WIDE":
        // A wide is a run and no legal ball.
        addRuns(1);
        break;
      case "NO_BALL":
        // One penalty run plus anything scored off it; no legal ball.
        addRuns(1 + Math.max(0, e.runs ?? 0));
        break;
      case "END_INNINGS":
        if (s.innings === 0) s.innings = 1;
        break;
      case "POINT":
        break;
    }
  }
  return s;
}

/** Balls → "12.3" overs, the way a scoreboard reads. */
export function oversLabel(balls: number): string {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}

/** Short, unambiguous code — no O/0/I/1 to misread across a pitch. */
function makeCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export async function createPublicMatch(input: {
  sport: PublicMatchSport;
  teamAName: string;
  teamBName: string;
  oversPerInnings?: number | null;
  createdByUserId?: string | null;
}): Promise<{ ok: boolean; error?: string; code?: string }> {
  const a = input.teamAName.trim().slice(0, 40);
  const b = input.teamBName.trim().slice(0, 40);
  if (!a || !b) return { ok: false, error: "Both team names are required" };

  // Codes are short, so a collision is possible — retry rather than 500.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode();
    const clash = await db.publicMatch.findUnique({
      where: { code },
      select: { id: true },
    });
    if (clash) continue;
    await db.publicMatch.create({
      data: {
        code,
        sport: input.sport,
        teamAName: a,
        teamBName: b,
        oversPerInnings:
          input.sport === "CRICKET" ? (input.oversPerInnings ?? null) : null,
        createdByUserId: input.createdByUserId ?? null,
        state: EMPTY as unknown as object,
        events: [] as unknown as object,
      },
    });
    return { ok: true, code };
  }
  return { ok: false, error: "Couldn't allocate a match code — try again" };
}

export async function getPublicMatch(code: string) {
  const m = await db.publicMatch.findUnique({
    where: { code: code.toUpperCase().trim() },
  });
  if (!m) return null;
  const events = (m.events as unknown as ScoreEvent[]) ?? [];
  return {
    code: m.code,
    sport: m.sport as PublicMatchSport,
    status: m.status,
    teamAName: m.teamAName,
    teamBName: m.teamBName,
    oversPerInnings: m.oversPerInnings,
    createdByUserId: m.createdByUserId,
    state: replay(events, m.sport as PublicMatchSport),
    eventCount: events.length,
    createdAt: m.createdAt,
    completedAt: m.completedAt,
  };
}

/**
 * Append an event (or undo the last) and persist the replayed state.
 *
 * Only the creator may score. Anyone with the code can watch — that's
 * the point of the code — but a spectator must not be able to move the
 * scoreboard.
 */
export async function scorePublicMatch(args: {
  code: string;
  userId: string | null;
  event: ScoreEvent | { t: "UNDO" };
}): Promise<{ ok: boolean; error?: string }> {
  const m = await db.publicMatch.findUnique({
    where: { code: args.code.toUpperCase().trim() },
    select: {
      id: true,
      sport: true,
      status: true,
      createdByUserId: true,
      events: true,
    },
  });
  if (!m) return { ok: false, error: "Match not found" };
  if (m.status !== "LIVE") {
    return { ok: false, error: "This match has finished" };
  }
  // A match created before sign-in (createdByUserId null) stays open to
  // whoever holds the code; once it has an owner, only they score.
  if (m.createdByUserId && m.createdByUserId !== args.userId) {
    return { ok: false, error: "Only the scorer who started this match can update it" };
  }

  const events = ((m.events as unknown as ScoreEvent[]) ?? []).slice();
  if (args.event.t === "UNDO") {
    if (events.length === 0) return { ok: false, error: "Nothing to undo" };
    events.pop();
  } else {
    if (events.length >= 5000) {
      return { ok: false, error: "This match has too many events" };
    }
    events.push(args.event);
  }

  await db.publicMatch.update({
    where: { id: m.id },
    data: {
      events: events as unknown as object,
      state: replay(events, m.sport as PublicMatchSport) as unknown as object,
    },
  });
  return { ok: true };
}

export async function finishPublicMatch(args: {
  code: string;
  userId: string | null;
  abandoned?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const m = await db.publicMatch.findUnique({
    where: { code: args.code.toUpperCase().trim() },
    select: { id: true, createdByUserId: true, status: true },
  });
  if (!m) return { ok: false, error: "Match not found" };
  if (m.createdByUserId && m.createdByUserId !== args.userId) {
    return { ok: false, error: "Only the scorer who started this match can end it" };
  }
  if (m.status !== "LIVE") return { ok: true };

  await db.publicMatch.update({
    where: { id: m.id },
    data: {
      status: args.abandoned ? "ABANDONED" : "COMPLETED",
      completedAt: new Date(),
    },
  });
  return { ok: true };
}

/** The signed-in user's recent scratch matches. */
export async function listMyPublicMatches(userId: string) {
  return db.publicMatch.findMany({
    where: { createdByUserId: userId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      code: true,
      sport: true,
      status: true,
      teamAName: true,
      teamBName: true,
      events: true,
      createdAt: true,
    },
  });
}
