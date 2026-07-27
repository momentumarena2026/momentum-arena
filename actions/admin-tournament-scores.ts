"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { applyProgression } from "@/lib/tournament-progression";

async function gate() {
  return requireAdmin("MANAGE_TOURNAMENTS");
}

const resultSchema = z.object({
  homeScore: z.number().int().min(0).max(9999),
  awayScore: z.number().int().min(0).max(9999),
  homeScoreNote: z.string().trim().max(60).optional(),
  awayScoreNote: z.string().trim().max(60).optional(),
  isDraw: z.boolean(),
  winnerTeamId: z.string().optional(), // required when scores tie in a knockout
  resultNote: z.string().trim().max(200).optional(),
  playerOfMatchId: z.string().optional(),
  playerStats: z
    .array(
      z.object({
        memberId: z.string().min(1),
        teamId: z.string().min(1),
        statKey: z.string().min(1).max(30),
        value: z.number().int().min(0).max(9999),
      })
    )
    .max(200)
    .default([]),
});

export type MatchResultInput = z.infer<typeof resultSchema>;

export async function enterMatchResult(
  matchId: string,
  input: unknown
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const parsed = resultSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Invalid result" };
  }
  const d = parsed.data;

  const match = await db.tournamentMatch.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      tournamentId: true,
      stage: true,
      homeTeamId: true,
      awayTeamId: true,
      tournament: { select: { statFields: true } },
    },
  });
  if (!match) return { success: false, error: "Match not found" };
  if (!match.homeTeamId || !match.awayTeamId) {
    return { success: false, error: "Both teams must be decided before entering a result" };
  }

  const isRoundRobin = match.stage === "POOL" || match.stage === "LEAGUE";
  let winnerTeamId: string | null = null;
  let isDraw = false;

  if (d.homeScore === d.awayScore) {
    if (isRoundRobin && d.isDraw) {
      isDraw = true;
    } else {
      // Tied knockout (or admin chose a winner on tie: super over / shootout / toss).
      if (!d.winnerTeamId || ![match.homeTeamId, match.awayTeamId].includes(d.winnerTeamId)) {
        return {
          success: false,
          error: isRoundRobin
            ? "Tied score: tick Draw or pick the winner"
            : "Tied knockout score: pick the winner (super over / shootout)",
        };
      }
      winnerTeamId = d.winnerTeamId;
    }
  } else {
    winnerTeamId = d.homeScore > d.awayScore ? match.homeTeamId : match.awayTeamId;
  }

  // Player stats keys must be from the tournament's configured stat fields.
  const validKeys = new Set(
    (Array.isArray(match.tournament.statFields) ? match.tournament.statFields : [])
      .map((f) => (f && typeof f === "object" ? (f as { key?: string }).key : null))
      .filter(Boolean) as string[]
  );
  const stats = d.playerStats.filter(
    (s) => validKeys.has(s.statKey) && [match.homeTeamId, match.awayTeamId].includes(s.teamId)
  );

  await db.$transaction(async (tx) => {
    await tx.tournamentMatch.update({
      where: { id: matchId },
      data: {
        status: "COMPLETED",
        homeScore: d.homeScore,
        awayScore: d.awayScore,
        homeScoreNote: d.homeScoreNote || null,
        awayScoreNote: d.awayScoreNote || null,
        isDraw,
        winnerTeamId,
        resultNote: d.resultNote || null,
        playerOfMatchId: d.playerOfMatchId || null,
        clockStartedAt: null,
      },
    });
    // Replace this match's stat rows wholesale (edit = resubmit).
    await tx.tournamentPlayerStat.deleteMany({ where: { matchId } });
    if (stats.length) {
      await tx.tournamentPlayerStat.createMany({
        data: stats.map((s) => ({
          tournamentId: match.tournamentId,
          matchId,
          teamId: s.teamId,
          memberId: s.memberId,
          statKey: s.statKey,
          value: s.value,
        })),
      });
    }
  });

  await applyProgression(match.tournamentId);
  revalidatePath(`/admin/tournaments/${match.tournamentId}`);
  return { success: true };
}

/** Reopen a completed match (fix a mis-entry). Blocked once a dependent
 *  knockout match that consumed this result has itself been decided. */
export async function reopenMatch(
  matchId: string
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const match = await db.tournamentMatch.findUnique({
    where: { id: matchId },
    select: { id: true, tournamentId: true, status: true },
  });
  if (!match) return { success: false, error: "Match not found" };
  if (match.status !== "COMPLETED") return { success: false, error: "Match is not completed" };

  const dependent = await db.tournamentMatch.findFirst({
    where: {
      OR: [{ homeSourceMatchId: matchId }, { awaySourceMatchId: matchId }],
      status: { in: ["COMPLETED", "LIVE", "WALKOVER"] },
    },
    select: { id: true },
  });
  if (dependent) {
    return { success: false, error: "A later round already consumed this result — reopen that first" };
  }

  await db.$transaction(async (tx) => {
    // Un-resolve any dependent slots that were filled from this match.
    await tx.tournamentMatch.updateMany({
      where: { homeSourceMatchId: matchId, status: "SCHEDULED" },
      data: { homeTeamId: null },
    });
    await tx.tournamentMatch.updateMany({
      where: { awaySourceMatchId: matchId, status: "SCHEDULED" },
      data: { awayTeamId: null },
    });
    await tx.tournamentPlayerStat.deleteMany({ where: { matchId } });
    await tx.tournamentMatch.update({
      where: { id: matchId },
      data: {
        status: "SCHEDULED",
        homeScore: null,
        awayScore: null,
        homeScoreNote: null,
        awayScoreNote: null,
        isDraw: false,
        winnerTeamId: null,
        resultNote: null,
        playerOfMatchId: null,
        liveState: undefined,
      },
    });
  });
  revalidatePath(`/admin/tournaments/${match.tournamentId}`);
  return { success: true };
}

/** Members of both sides for the score-entry form (stat grid + PoM). */
export async function getMatchRosters(matchId: string) {
  await gate();
  const match = await db.tournamentMatch.findUnique({
    where: { id: matchId },
    select: {
      homeTeam: { select: { id: true, name: true, members: { orderBy: { order: "asc" }, select: { id: true, name: true } } } },
      awayTeam: { select: { id: true, name: true, members: { orderBy: { order: "asc" }, select: { id: true, name: true } } } },
    },
  });
  return match;
}
