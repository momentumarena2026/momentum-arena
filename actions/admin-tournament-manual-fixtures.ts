"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";

/**
 * Hand-entered fixtures.
 *
 * generateFixtures() DERIVES the fixture list from the confirmed teams and
 * the format: LEAGUE gives a single round-robin, POOLS_KNOCKOUT gives pool
 * matches plus a bracket sized from poolCount/advancePerPool. That is right
 * for a tournament we run, because we decided the structure.
 *
 * It is wrong for a third-party event. The organiser has already decided
 * their schedule and hands it to us — a double round-robin, an odd number
 * of semi-finals, whatever they like — and our job is to display it, not to
 * re-derive it and then fight the result. A real example that fits nothing
 * the generator can produce: three teams, each pair twice (six matches),
 * then two semi-finals and a final.
 *
 * So these let an admin add matches one at a time. They are ordinary
 * TournamentMatch rows, which is why everything downstream — points table,
 * bracket, match centre, live scoring, slot blocking — works unchanged.
 */
function gate() {
  return requireAdmin("MANAGE_TOURNAMENTS");
}

export const MANUAL_STAGES = [
  "LEAGUE",
  "POOL",
  "R16",
  "QF",
  "SF",
  "THIRD_PLACE",
  "FINAL",
] as const;

const createSchema = z.object({
  tournamentId: z.string().min(1),
  stage: z.enum(MANUAL_STAGES),
  /** "Match 3", "Semi-Final 1". Shown wherever the fixture is listed. */
  roundLabel: z.string().trim().min(1).max(60),
  /** Omit either side to leave it a placeholder (see *SourceLabel). */
  homeTeamId: z.string().optional(),
  awayTeamId: z.string().optional(),
  /** Stand-in text when the team isn't known yet: "Winner SF1", "Finalist 1". */
  homeSourceLabel: z.string().trim().max(60).optional(),
  awaySourceLabel: z.string().trim().max(60).optional(),
});

export type ManualFixtureInput = z.infer<typeof createSchema>;

export async function createManualMatch(
  input: ManualFixtureInput,
): Promise<{ success: true; matchId: string } | { success: false; error: string }> {
  await gate();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid fixture" };
  }
  const d = parsed.data;

  const t = await db.tournament.findUnique({
    where: { id: d.tournamentId },
    select: { id: true, teams: { select: { id: true } } },
  });
  if (!t) return { success: false, error: "Tournament not found" };

  // A fixture between a team and itself is always a mistake, and it would
  // corrupt the points table silently (both a win and a loss for one team).
  if (d.homeTeamId && d.awayTeamId && d.homeTeamId === d.awayTeamId) {
    return { success: false, error: "A team cannot play itself" };
  }
  const known = new Set(t.teams.map((x) => x.id));
  for (const id of [d.homeTeamId, d.awayTeamId]) {
    if (id && !known.has(id)) {
      return { success: false, error: "That team is not in this tournament" };
    }
  }
  // Each side needs either a real team or something to show instead —
  // otherwise the fixture renders as a blank row nobody can interpret.
  if (!d.homeTeamId && !d.homeSourceLabel) {
    return { success: false, error: "Pick a home team or give it a placeholder label" };
  }
  if (!d.awayTeamId && !d.awaySourceLabel) {
    return { success: false, error: "Pick an away team or give it a placeholder label" };
  }

  // Append within the stage. sequence is the display order the whole module
  // already sorts by, so a hand-added match slots in beside generated ones.
  const last = await db.tournamentMatch.findFirst({
    where: { tournamentId: d.tournamentId, stage: d.stage },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });

  const match = await db.tournamentMatch.create({
    data: {
      tournamentId: d.tournamentId,
      stage: d.stage,
      roundLabel: d.roundLabel,
      sequence: (last?.sequence ?? 0) + 1,
      homeTeamId: d.homeTeamId || null,
      awayTeamId: d.awayTeamId || null,
      homeSourceLabel: d.homeTeamId ? null : d.homeSourceLabel || null,
      awaySourceLabel: d.awayTeamId ? null : d.awaySourceLabel || null,
    },
    select: { id: true },
  });

  revalidatePath(`/admin/tournaments/${d.tournamentId}`);
  return { success: true, matchId: match.id };
}

/**
 * Remove a fixture. Refuses once it carries a result: deleting a played
 * match would silently rewrite the points table and every player stat
 * derived from it. Void the result first if that is really the intent.
 */
export async function deleteManualMatch(
  matchId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  await gate();
  const m = await db.tournamentMatch.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      tournamentId: true,
      status: true,
      homeScore: true,
      awayScore: true,
      slotBlockIds: true,
    },
  });
  if (!m) return { success: false, error: "Match not found" };
  if (m.status === "COMPLETED" || m.status === "LIVE" || m.status === "WALKOVER") {
    return { success: false, error: `Can't delete a ${m.status.toLowerCase()} match` };
  }
  if (m.homeScore != null || m.awayScore != null) {
    return { success: false, error: "This match has a score — clear it first" };
  }

  await db.$transaction(async (tx) => {
    // Hand back any court hours this fixture was holding, or the booking
    // grid keeps them off sale forever.
    if (m.slotBlockIds.length > 0) {
      await tx.slotBlock.deleteMany({ where: { id: { in: m.slotBlockIds } } });
    }
    await tx.tournamentMatch.delete({ where: { id: m.id } });
  });

  revalidatePath(`/admin/tournaments/${m.tournamentId}`);
  return { success: true };
}
