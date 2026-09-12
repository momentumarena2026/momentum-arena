"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
// A "use server" module may only export async functions — the constant
// lives in lib/ for that reason.
import { MANUAL_STAGES } from "@/lib/tournament-manual-stages";
import { renumberStageLabels } from "@/lib/tournament-renumber";

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
    select: { id: true, teams: { select: { id: true, poolId: true } } },
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

  /**
   * Put the fixture in a pool when both sides share one.
   *
   * The points table selects a pool's matches by `poolId`, so a hand-added
   * match without one is invisible to the table it was added to affect —
   * an organiser adds the decider between the two teams left in Pool A,
   * plays it, and Pool A's standings never move. Nothing said so; the
   * fixture simply sat outside the pool it obviously belonged to.
   *
   * Only inferred when the two agree. Teams from different pools have no
   * single right answer, and guessing one would put a result into a table
   * it does not belong in — the same failure in the other direction.
   */
  const poolOf = new Map(t.teams.map((x) => [x.id, x.poolId]));
  const homePool = d.homeTeamId ? poolOf.get(d.homeTeamId) : null;
  const awayPool = d.awayTeamId ? poolOf.get(d.awayTeamId) : null;
  const poolId =
    d.stage === "POOL" && homePool && homePool === awayPool ? homePool : null;

  const match = await db.tournamentMatch.create({
    data: {
      tournamentId: d.tournamentId,
      stage: d.stage,
      poolId,
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
      // Needed to renumber the remaining fixtures in this stage below.
      stage: true,
      homeScore: true,
      awayScore: true,
      slotBlockIds: true,
    },
  });
  if (!m) return { success: false, error: "Match not found" };
  // Naming the way out, not just the refusal. "Can't delete a completed
  // match" is true and useless: the result CAN be cleared, by reopening
  // the match — but that button lives on the Scores tab, so an organiser
  // staring at the Fixtures list has no way to know the door exists.
  if (m.status === "COMPLETED") {
    return {
      success: false,
      error: "This match has a result. Reopen it on the Scores tab first, then delete it.",
    };
  }
  if (m.status === "LIVE") {
    return { success: false, error: "This match is being scored right now" };
  }
  if (m.status === "WALKOVER") {
    return {
      success: false,
      error:
        "This match was awarded as a walkover. Reopen it on the Scores tab first, then delete it.",
    };
  }
  if (m.homeScore != null || m.awayScore != null) {
    return {
      success: false,
      error: "This match has a score. Reopen it on the Scores tab first, then delete it.",
    };
  }
  // A later round may take its side from this match's winner or loser.
  // Deleting it leaves that round permanently unresolvable — the Final
  // reading "Winner Semi Final 1" against a semi-final that no longer
  // exists, with no way to start scoring it. Refuse, and say which.
  const dependents = await db.tournamentMatch.findMany({
    where: {
      tournamentId: m.tournamentId,
      OR: [{ homeSourceMatchId: m.id }, { awaySourceMatchId: m.id }],
    },
    select: { roundLabel: true },
  });
  if (dependents.length > 0) {
    const names = dependents.map((d) => d.roundLabel || "a later match").join(", ");
    return {
      success: false,
      error: `${names} take${dependents.length === 1 ? "s" : ""} a team from this match. Delete that first, or assign its teams by hand.`,
    };
  }

  await db.$transaction(async (tx) => {
    // Hand back any court hours this fixture was holding, or the booking
    // grid keeps them off sale forever.
    if (m.slotBlockIds.length > 0) {
      await tx.slotBlock.deleteMany({ where: { id: { in: m.slotBlockIds } } });
    }
    await tx.tournamentMatch.delete({ where: { id: m.id } });
  });

  // Close the gap the deletion leaves. Removing the middle fixture of
  // three otherwise leaves "Match 1, Match 3", and an organiser reading
  // that down a printed sheet has to work out whether Match 2 was
  // cancelled or is simply missing from the page.
  await renumberStageLabels(m.tournamentId, m.stage);

  revalidatePath(`/admin/tournaments/${m.tournamentId}`);
  return { success: true };
}

/**
 * Reorder the fixtures inside one stage.
 *
 * `sequence` is display order and nothing else — progression follows
 * homeSourceMatchId/awaySourceMatchId, and the points table follows
 * results — so shuffling it is safe at any point in the tournament. What
 * it changes is the running order the organiser reads down when deciding
 * what to schedule next, which is the whole reason to want it.
 *
 * roundLabel is deliberately left alone. "Pool A · Match 2" is the match's
 * name, printed on the public page and used in conversation; renaming
 * matches because someone dragged a row would be a worse surprise than a
 * list whose labels aren't in numeric order.
 */
export async function reorderStageFixtures(
  tournamentId: string,
  stage: string,
  orderedIds: string[],
): Promise<{ success: boolean; error?: string }> {
  await gate();
  if (orderedIds.length === 0) return { success: true };

  // Load what the stage actually holds rather than trusting the ids: a
  // stale tab could send a match that has since been deleted, or — the
  // one that matters — an id from another tournament.
  const rows = await db.tournamentMatch.findMany({
    where: { tournamentId, stage: stage as never },
    select: { id: true },
  });
  const allowed = new Set(rows.map((r) => r.id));
  const ids = orderedIds.filter((id) => allowed.has(id));
  if (ids.length !== rows.length) {
    return { success: false, error: "Fixture list changed — reload and try again" };
  }

  await db.$transaction(
    ids.map((id, i) =>
      db.tournamentMatch.update({ where: { id }, data: { sequence: i + 1 } }),
    ),
  );
  // The number is half the identity of a fixture; renumbering the sort
  // key without it is what left a pool reading "Match 2, Match 1".
  await renumberStageLabels(tournamentId, stage);

  revalidatePath(`/admin/tournaments/${tournamentId}`);
  return { success: true };
}

/**
 * Put a team into one side of a fixture by hand.
 *
 * The bracket normally fills itself: a side carries a source label
 * ("Winner Pool A", "Winner Semi Final 1") and resolves the moment the
 * thing it points at is decided. This is the escape hatch for when it
 * can't — a source match that was deleted, a walkover after a withdrawal,
 * a bracket an organiser built by hand.
 *
 * Only on a fixture that hasn't started. Once a match is LIVE or has a
 * result, changing who played it would rewrite the points table and the
 * scorecard underneath a scorer who is mid-over.
 */
export async function assignMatchTeam(
  matchId: string,
  side: "home" | "away",
  teamId: string | null,
): Promise<{ success: true } | { success: false; error: string }> {
  await gate();
  const m = await db.tournamentMatch.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      tournamentId: true,
      status: true,
      homeTeamId: true,
      awayTeamId: true,
    },
  });
  if (!m) return { success: false, error: "Match not found" };
  if (m.status !== "SCHEDULED") {
    return {
      success: false,
      error: `Can't change the teams of a ${m.status.toLowerCase()} match`,
    };
  }

  if (teamId) {
    const team = await db.tournamentTeam.findUnique({
      where: { id: teamId },
      select: { tournamentId: true, status: true, archivedAt: true },
    });
    if (!team || team.tournamentId !== m.tournamentId) {
      return { success: false, error: "That team isn't in this tournament" };
    }
    if (team.status !== "CONFIRMED" || team.archivedAt) {
      return { success: false, error: "Only a confirmed team can be put in a fixture" };
    }
    const other = side === "home" ? m.awayTeamId : m.homeTeamId;
    if (other && other === teamId) {
      return { success: false, error: "A team can't play itself" };
    }
  }

  // Clear the source link along with the team. Leaving it would let the
  // next progression pass overwrite the manual choice with whatever the
  // (possibly dangling) label resolves to.
  await db.tournamentMatch.update({
    where: { id: m.id },
    data:
      side === "home"
        ? { homeTeamId: teamId, homeSourceLabel: null, homeSourceMatchId: null }
        : { awayTeamId: teamId, awaySourceLabel: null, awaySourceMatchId: null },
  });

  revalidatePath(`/admin/tournaments/${m.tournamentId}`);
  return { success: true };
}
