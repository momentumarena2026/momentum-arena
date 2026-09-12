/**
 * Keeping fixture numbers honest.
 *
 * Lives outside the action modules because several of them need it — a
 * reorder, a delete and a withdrawal all change what "Match 3" means —
 * and a `"use server"` file cannot share a helper without publishing it
 * as a callable endpoint of its own.
 */
import { db } from "@/lib/db";
import { renumberedLabels } from "@/lib/tournament-fixtures";

/**
 * Make the "Match N" in each label match the order fixtures are actually
 * listed in.
 *
 * `sequence` and `roundLabel` are written together when fixtures are
 * generated and then drift apart, because everything that changes the
 * order afterwards only touched `sequence`. A dragged pool read
 * "Match 2, Match 1, Match 3" down the screen, and deleting the middle
 * fixture of three left "Match 1, Match 3".
 *
 * That matters more than it looks: the number is the only thing an
 * organiser calls a fixture by — over the PA, on a printed sheet, to a
 * captain — so a list where it does not count upwards is worse than one
 * with no numbers at all.
 *
 * Numbered PER POOL, not per stage. Pool matches from different pools
 * interleave in the list because it is ordered by play order, and
 * numbering across the whole stage would produce "Pool B · Match 7" in a
 * pool that has three.
 *
 * Only labels that already ARE a match number are rewritten. Knockout
 * rounds carry names — "Semi Final 1", "Final", "3rd Place" — which are
 * positional in their own right and must not become "Match 1".
 */
export async function renumberStageLabels(tournamentId: string, stage: string): Promise<void> {
  const rows = await db.tournamentMatch.findMany({
    where: { tournamentId, stage: stage as never },
    orderBy: { sequence: "asc" },
    select: { id: true, roundLabel: true, pool: { select: { name: true } } },
  });

  const updates = renumberedLabels(
    rows.map((r) => ({ id: r.id, roundLabel: r.roundLabel, poolName: r.pool?.name ?? null })),
  );
  if (updates.length === 0) return;
  await db.$transaction(
    updates.map((u) =>
      db.tournamentMatch.update({ where: { id: u.id }, data: { roundLabel: u.roundLabel } }),
    ),
  );
}
