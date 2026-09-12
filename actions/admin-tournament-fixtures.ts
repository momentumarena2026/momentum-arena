"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { dealPools } from "@/lib/tournament-scheduling";
import { setTeamStatus } from "@/actions/admin-tournaments";
import { renumberStageLabels } from "@/lib/tournament-renumber";
import {
  roundRobinRounds,
  poolLegs,
  missingPoolPairings,
  buildKnockoutSkeleton,
  poolQualifierSlots,
  shuffle,
  swapBlocker,
  poolMoveBlocker,
  type BracketSlot,
} from "@/lib/tournament-fixtures";

async function gate() {
  return requireAdmin("MANAGE_TOURNAMENTS");
}

const POOL_NAMES = "ABCDEFGHIJKLMNOP".split("").map((c) => `Pool ${c}`);

// ── Pools & draw ────────────────────────────────────────────────────
/** Create/re-deal pools: confirmed teams are shuffled and dealt round-robin
 *  across poolCount pools. Allowed until the reveal (re-runs re-deal). */
export async function autoAssignPools(
  tournamentId: string
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const t = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true,
      status: true,
      format: true,
      poolCount: true,
      teams: {
        where: { status: "CONFIRMED" },
        select: { id: true, preferredSlotIds: true },
      },
    },
  });
  if (!t) return { success: false, error: "Tournament not found" };
  if (t.format !== "POOLS_KNOCKOUT") return { success: false, error: "Not a pools tournament" };
  if (!["REG_OPEN", "REG_CLOSED"].includes(t.status)) {
    return { success: false, error: "Pools can only be (re)dealt before the reveal" };
  }
  if (t.poolCount < 2) return { success: false, error: "Configure at least 2 pools first" };
  if (t.teams.length < t.poolCount) {
    return { success: false, error: `Need at least ${t.poolCount} confirmed teams` };
  }

  // Cluster by availability rather than shuffling blind. A pool plays a
  // round-robin inside the windows its members share, so scattering teams
  // with different availability guarantees fixtures nobody can attend.
  // The seed keeps a single deal reproducible while re-dealing still
  // produces a genuinely different arrangement.
  const dealt = dealPools(
    t.teams.map((x) => ({ id: x.id, preferredSlotIds: x.preferredSlotIds })),
    { poolCount: t.poolCount, seed: Math.floor(Math.random() * 2147483647) },
  );
  await db.$transaction(async (tx) => {
    // Recreate pools fresh (drops any manual assignment).
    await tx.tournamentTeam.updateMany({
      where: { tournamentId },
      data: { poolId: null, seed: null },
    });
    await tx.tournamentPool.deleteMany({ where: { tournamentId } });
    const pools = await Promise.all(
      Array.from({ length: t.poolCount }, (_, i) =>
        tx.tournamentPool.create({
          data: { tournamentId, name: POOL_NAMES[i] || `Pool ${i + 1}`, order: i },
        })
      )
    );
    for (let p = 0; p < dealt.length; p++) {
      for (let i = 0; i < dealt[p].length; i++) {
        await tx.tournamentTeam.update({
          where: { id: dealt[p][i].id },
          data: { poolId: pools[p].id, seed: i + 1 },
        });
      }
    }
  });
  revalidatePath(`/admin/tournaments/${tournamentId}`);
  return { success: true };
}

/**
 * Move one team into another pool.
 *
 * This stays open after the reveal, which is when captains actually start
 * asking — they see the draw, and come back with a clash, a withdrawal,
 * or a swap the two sides have agreed between themselves. Refusing at
 * that moment left the organiser with no answer at all, and the tab said
 * only "Pools are locked after the reveal".
 *
 * The real limit is a team that has PLAYED: points are computed per pool,
 * so moving it takes its results into another table and leaves the teams
 * it played holding a standings that no longer adds up. See
 * poolMoveBlocker.
 *
 * Fixtures are NOT regenerated here. They pair named teams, so a move
 * after they exist leaves matches that read against the old pool — real,
 * but stale. Rewriting them silently would delete fixtures an organiser
 * may already have scheduled, told captains about, and blocked courts
 * for. So the count comes back as a warning and the decision stays with
 * the person who knows what was promised.
 */
export async function moveTeamToPool(
  teamId: string,
  poolId: string | null
): Promise<{ success: boolean; error?: string; warning?: string }> {
  await gate();
  const team = await db.tournamentTeam.findUnique({
    where: { id: teamId },
    select: {
      tournamentId: true,
      poolId: true,
      tournament: { select: { status: true } },
      homeMatches: { select: { status: true, homeScore: true, awayScore: true } },
      awayMatches: { select: { status: true, homeScore: true, awayScore: true } },
    },
  });
  if (!team) return { success: false, error: "Team not found" };

  const blocked = poolMoveBlocker(team.tournament.status, [
    ...team.homeMatches,
    ...team.awayMatches,
  ]);
  if (blocked) return { success: false, error: blocked };

  // The destination must belong to this tournament — otherwise a stale
  // page could park a team in another event's pool.
  if (poolId) {
    const pool = await db.tournamentPool.findUnique({
      where: { id: poolId },
      select: { tournamentId: true },
    });
    if (!pool || pool.tournamentId !== team.tournamentId) {
      return { success: false, error: "That pool belongs to another tournament" };
    }
  }

  const stale =
    team.poolId && team.poolId !== poolId
      ? await db.tournamentMatch.count({
          where: {
            tournamentId: team.tournamentId,
            OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
          },
        })
      : 0;

  await db.tournamentTeam.update({ where: { id: teamId }, data: { poolId } });
  revalidatePath(`/admin/tournaments/${team.tournamentId}`);
  return {
    success: true,
    warning: stale
      ? `${stale} existing fixture${stale === 1 ? "" : "s"} still pair this team with its old pool. Regenerate fixtures, or fix them on the Fixtures tab.`
      : undefined,
  };
}

/**
 * Create the configured number of EMPTY pools and leave every team
 * unassigned.
 *
 * The random deal is the fast path, but an admin who already knows how
 * the pools should look (seedings, a local rivalry to keep apart, a team
 * that must play early) had no way to express it without dealing at
 * random first and then dragging teams out of the arrangement they were
 * given. This starts from a blank grid instead; the per-team selector
 * fills it.
 */
export async function createEmptyPools(
  tournamentId: string,
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const t = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, status: true, format: true, poolCount: true },
  });
  if (!t) return { success: false, error: "Tournament not found" };
  if (t.format !== "POOLS_KNOCKOUT") return { success: false, error: "Not a pools tournament" };
  if (!["REG_OPEN", "REG_CLOSED"].includes(t.status)) {
    return { success: false, error: "Pools are locked after the reveal" };
  }
  if (t.poolCount < 2) return { success: false, error: "Configure at least 2 pools first" };

  await db.$transaction(async (tx) => {
    await tx.tournamentTeam.updateMany({
      where: { tournamentId },
      data: { poolId: null, seed: null },
    });
    await tx.tournamentPool.deleteMany({ where: { tournamentId } });
    for (let i = 0; i < t.poolCount; i++) {
      await tx.tournamentPool.create({
        data: { tournamentId, name: POOL_NAMES[i] || `Pool ${i + 1}`, order: i },
      });
    }
  });
  revalidatePath(`/admin/tournaments/${tournamentId}`);
  return { success: true };
}

/**
 * Throw the whole draw away — pools deleted, every team unassigned.
 *
 * Re-dealing already replaces an arrangement, but there was no way to get
 * back to nothing, so a deal you disliked had to be replaced by another
 * deal rather than simply undone.
 *
 * Refuses once fixtures exist: those matches were built from these pools,
 * and deleting the pools underneath them would leave a fixture list
 * referring to groupings that no longer exist. Regenerate fixtures first.
 */
export async function clearPools(
  tournamentId: string,
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const t = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true,
      status: true,
      _count: { select: { matches: true } },
    },
  });
  if (!t) return { success: false, error: "Tournament not found" };
  if (!["REG_OPEN", "REG_CLOSED"].includes(t.status)) {
    return { success: false, error: "Pools are locked after the reveal" };
  }
  if (t._count.matches > 0) {
    return {
      success: false,
      error: "Fixtures already exist — clear or regenerate them before clearing pools",
    };
  }

  await db.$transaction(async (tx) => {
    await tx.tournamentTeam.updateMany({
      where: { tournamentId },
      data: { poolId: null, seed: null },
    });
    await tx.tournamentPool.deleteMany({ where: { tournamentId } });
  });
  revalidatePath(`/admin/tournaments/${tournamentId}`);
  return { success: true };
}

/**
 * A team pulls out — withdraw it and repair the pool it leaves behind.
 *
 * A no-show is not an admin problem, it is a scheduling one. Marking the
 * team withdrawn on its own leaves its fixtures standing: the pool's
 * remaining teams still have matches against an opponent who will never
 * arrive, and the points table quietly shrinks to whatever is left. A
 * pool of three becomes two teams with a single fixture between them,
 * which decides a qualifier on one afternoon and gives net run rate — the
 * thing meant to separate them — one innings each to work with.
 *
 * So this does the whole thing:
 *   · the team is marked WITHDRAWN, which drops it from the standings,
 *     since those count CONFIRMED teams only;
 *   · its UNPLAYED fixtures are deleted and their court hours released;
 *   · the pool it leaves is topped back up to a full schedule for the
 *     teams that remain — two legs when two are left, so the decider is a
 *     series rather than a coin toss.
 *
 * Played matches are never touched, the team's own included. A result
 * that happened is a fact about the tournament, and a withdrawal later in
 * the week does not unmake the afternoon it was won on. That is also why
 * the pool is topped up rather than regenerated: regeneration would take
 * the played matches with it.
 *
 * The team keeps its poolId. It is the record of where it was drawn, the
 * board already shows confirmed teams only, and erasing it would make the
 * withdrawal impossible to explain afterwards.
 */
export async function withdrawTeam(
  teamId: string,
): Promise<{
  success: boolean;
  error?: string;
  removedFixtures?: number;
  addedFixtures?: number;
  keptPlayed?: number;
}> {
  await gate();
  const team = await db.tournamentTeam.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      name: true,
      status: true,
      poolId: true,
      tournamentId: true,
      tournament: { select: { status: true, name: true, sport: true } },
    },
  });
  if (!team) return { success: false, error: "Team not found" };
  // An already-WITHDRAWN team is NOT refused. The repair below is a
  // shortfall calculation, so running it twice creates nothing the second
  // time — and that idempotence is what makes the action safe to retry if
  // the status write lands and the repair then fails.
  if (["COMPLETED", "CANCELLED"].includes(team.tournament.status)) {
    return { success: false, error: "This tournament is already over" };
  }

  const played = (m: { status: string; homeScore: number | null; awayScore: number | null }) =>
    m.status === "LIVE" ||
    m.status === "COMPLETED" ||
    m.status === "WALKOVER" ||
    m.homeScore != null ||
    m.awayScore != null;

  const mine = await db.tournamentMatch.findMany({
    where: {
      tournamentId: team.tournamentId,
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
    },
    select: {
      id: true,
      status: true,
      homeScore: true,
      awayScore: true,
      slotBlockIds: true,
    },
  });
  const dead = mine.filter((m) => !played(m));
  const keptPlayed = mine.length - dead.length;

  // What the pool will look like once this team is gone.
  const survivors = team.poolId
    ? await db.tournamentTeam.findMany({
        where: {
          poolId: team.poolId,
          status: "CONFIRMED",
          id: { not: teamId },
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const deadIds = new Set(dead.map((d) => d.id));
  const poolMatches = team.poolId
    ? await db.tournamentMatch.findMany({
        where: { poolId: team.poolId },
        select: {
          id: true,
          homeTeamId: true,
          awayTeamId: true,
          sequence: true,
        },
      })
    : [];
  const surviving = poolMatches.filter((m) => !deadIds.has(m.id));

  const ids = survivors.map((x) => x.id);
  // Below two teams there is no pool left to play — one team cannot be
  // given a schedule, and the organiser has a bigger decision to make
  // about the bracket than this action should take for them.
  const toCreate =
    ids.length >= 2 ? missingPoolPairings(ids, poolLegs(ids.length), surviving) : [];

  const poolName = team.poolId
    ? (await db.tournamentPool.findUnique({
        where: { id: team.poolId },
        select: { name: true },
      }))?.name ?? "Pool"
    : "";

  // Withdrawing is not just a status: it returns the reward points the
  // captain redeemed at registration and strips the points leg from their
  // discount. That lives in setTeamStatus and must not be reimplemented
  // here — a second copy of a refund is how money goes missing. Done
  // BEFORE the repair, because it is the part that must not be skipped;
  // the repair is idempotent and can be re-run if it fails.
  if (team.status !== "WITHDRAWN") {
    const res = await setTeamStatus(teamId, "WITHDRAWN");
    if (!res.success) return { success: false, error: res.error };
  }

  // Sequence is unique per STAGE, and every pool's matches share the POOL
  // stage — so the next number has to clear the whole stage, not just this
  // pool. Taking this pool's max would collide with another pool's rows
  // and scramble the order both are listed in.
  const stageMax = await db.tournamentMatch.aggregate({
    where: { tournamentId: team.tournamentId, stage: "POOL" },
    _max: { sequence: true },
  });

  await db.$transaction(async (tx) => {
    const blockIds = dead.flatMap((d) => d.slotBlockIds);
    if (blockIds.length) {
      // Give the hours back. A withdrawn team's matches were holding
      // courts that can now be sold or used by the fixtures added below.
      await tx.slotBlock.deleteMany({ where: { id: { in: blockIds } } });
    }
    if (deadIds.size) {
      await tx.tournamentMatch.deleteMany({ where: { id: { in: [...deadIds] } } });
    }
    let seq = stageMax._max.sequence ?? 0;
    for (const [home, away] of toCreate) {
      seq += 1;
      await tx.tournamentMatch.create({
        data: {
          tournamentId: team.tournamentId,
          stage: "POOL",
          poolId: team.poolId,
          roundLabel: `${poolName} · Match ${seq}`,
          sequence: seq,
          homeTeamId: home,
          awayTeamId: away,
        },
      });
    }
  });

  // The pool's numbering runs 1..n after the deletions and additions, so
  // it reads as a schedule rather than as the history of its own repair.
  await renumberStageLabels(team.tournamentId, "POOL");

  revalidatePath(`/admin/tournaments/${team.tournamentId}`);
  return {
    success: true,
    removedFixtures: dead.length,
    addedFixtures: toCreate.length,
    keptPlayed,
  };
}

// ── Fixture generation ──────────────────────────────────────────────
/** Generate the full fixture list. Round-robin matches for pools/league,
 *  and the knockout skeleton with source labels + winner-of chains.
 *  Re-runnable while no match is completed (wipes and regenerates). */
export async function generateFixtures(
  tournamentId: string
): Promise<{ success: boolean; error?: string; created?: number }> {
  await gate();
  const t = await db.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      pools: { orderBy: { order: "asc" }, include: { teams: { where: { status: "CONFIRMED" }, select: { id: true } } } },
      teams: { where: { status: "CONFIRMED" }, select: { id: true }, orderBy: { createdAt: "asc" } },
      matches: { where: { status: { in: ["COMPLETED", "LIVE", "WALKOVER"] } }, select: { id: true }, take: 1 },
    },
  });
  if (!t) return { success: false, error: "Tournament not found" };
  if (t.matches.length > 0) {
    return { success: false, error: "Matches already started — can't regenerate fixtures" };
  }
  if (t.teams.length < 2) return { success: false, error: "Need at least 2 confirmed teams" };
  if (t.format === "POOLS_KNOCKOUT" && t.pools.some((p) => p.teams.length < 2)) {
    return { success: false, error: "Every pool needs at least 2 teams — deal the pools first" };
  }

  type NewMatch = {
    stage: string;
    roundLabel: string;
    sequence: number;
    poolId?: string | null;
    homeTeamId?: string | null;
    awayTeamId?: string | null;
    homeSourceLabel?: string | null;
    awaySourceLabel?: string | null;
    skeletonIndex?: number; // for winner-of chain resolution
    homeSourceIndex?: number | null;
    awaySourceIndex?: number | null;
  };
  const rows: NewMatch[] = [];

  if (t.format === "LEAGUE") {
    let seq = 0;
    for (const round of roundRobinRounds(t.teams.map((x) => x.id))) {
      for (const [home, away] of round.pairs) {
        seq += 1;
        rows.push({
          stage: "LEAGUE",
          roundLabel: `Match ${seq}`,
          sequence: seq,
          homeTeamId: home,
          awayTeamId: away,
        });
      }
    }
  } else {
    // Pool stage (POOLS_KNOCKOUT only)
    if (t.format === "POOLS_KNOCKOUT") {
      for (const pool of t.pools) {
        let seq = 0;
        // A pool of two plays twice — see poolLegs. Usually that pool got
        // there by subtraction, a withdrawal from a pool of three.
        const ids = pool.teams.map((x) => x.id);
        for (const round of roundRobinRounds(ids, poolLegs(ids.length))) {
          for (const [home, away] of round.pairs) {
            seq += 1;
            rows.push({
              stage: "POOL",
              roundLabel: `${pool.name} · Match ${seq}`,
              sequence: seq,
              poolId: pool.id,
              homeTeamId: home,
              awayTeamId: away,
            });
          }
        }
      }
    }

    // Knockout skeleton
    const entrants: BracketSlot[] =
      t.format === "KNOCKOUT"
        ? shuffle(t.teams.map((x) => x.id)).map((teamId, i) => ({
            kind: "team" as const,
            teamId,
            label: `Seed ${i + 1}`,
          }))
        : poolQualifierSlots(
            t.pools.map((p) => p.name),
            t.advancePerPool,
            t.bracketSeeding
          );
    const skeleton = buildKnockoutSkeleton(entrants, t.thirdPlaceMatch);
    const baseIndex = rows.length;
    skeleton.forEach((m, i) => {
      const slotFields = (slot: BracketSlot, side: "home" | "away") => {
        if (slot.kind === "team") {
          return side === "home" ? { homeTeamId: slot.teamId } : { awayTeamId: slot.teamId };
        }
        if (slot.kind === "bye") {
          return side === "home" ? { homeSourceLabel: "BYE" } : { awaySourceLabel: "BYE" };
        }
        if (slot.kind === "winner" || slot.kind === "loser") {
          const label = slot.label;
          return side === "home"
            ? { homeSourceLabel: label, homeSourceIndex: baseIndex + slot.matchIndex }
            : { awaySourceLabel: label, awaySourceIndex: baseIndex + slot.matchIndex };
        }
        // pool rank
        return side === "home"
          ? { homeSourceLabel: slot.label }
          : { awaySourceLabel: slot.label };
      };
      rows.push({
        stage: m.stage,
        roundLabel: m.roundLabel,
        sequence: m.sequence,
        skeletonIndex: baseIndex + i,
        ...slotFields(m.home, "home"),
        ...slotFields(m.away, "away"),
      });
    });
  }

  await db.$transaction(async (tx) => {
    // Wipe previous fixtures (frees their slot blocks too).
    const old = await tx.tournamentMatch.findMany({
      where: { tournamentId },
      select: { slotBlockIds: true },
    });
    const blockIds = old.flatMap((m) => m.slotBlockIds);
    if (blockIds.length) {
      await tx.slotBlock.deleteMany({ where: { id: { in: blockIds } } });
    }
    await tx.tournamentMatch.deleteMany({ where: { tournamentId } });

    // Create in order, then wire winner-of chains via a second pass.
    const created: string[] = [];
    for (const r of rows) {
      const m = await tx.tournamentMatch.create({
        data: {
          tournamentId,
          stage: r.stage as never,
          roundLabel: r.roundLabel,
          sequence: r.sequence,
          poolId: r.poolId ?? null,
          homeTeamId: r.homeTeamId ?? null,
          awayTeamId: r.awayTeamId ?? null,
          homeSourceLabel: r.homeSourceLabel ?? null,
          awaySourceLabel: r.awaySourceLabel ?? null,
        },
        select: { id: true },
      });
      created.push(m.id);
    }
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.homeSourceIndex == null && r.awaySourceIndex == null) continue;
      await tx.tournamentMatch.update({
        where: { id: created[i] },
        data: {
          homeSourceMatchId: r.homeSourceIndex != null ? created[r.homeSourceIndex] : undefined,
          awaySourceMatchId: r.awaySourceIndex != null ? created[r.awaySourceIndex] : undefined,
        },
      });
    }
  });

  revalidatePath(`/admin/tournaments/${tournamentId}`);
  return { success: true, created: rows.length };
}

// ── Scheduling → booking-grid blocking ──────────────────────────────
const scheduleSchema = z.object({
  courtConfigId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startHour: z.number().int().min(0).max(23),
  hours: z.number().int().min(1).max(6),
});

/**
 * Swap the slots of two scheduled fixtures.
 *
 * Captains ask for this once the draw is out — two teams agree between
 * themselves that one will take the other's evening and give up its
 * morning. Before this the organiser had to unschedule both and
 * reschedule each by hand, and the moment the first was unscheduled its
 * hours went back on public sale: a customer could book the very slot
 * the tournament was mid-way through moving a match into.
 *
 * Each fixture takes the other's window WHOLE — court, time and duration
 * together. That is what makes a swap safe without a clash check: the
 * ground held before and after is identical, so nothing new is claimed
 * and nothing is released. Swapping the times but not the durations
 * would leave a 2-hour match in a 1-hour hole, which is a clash the
 * checks here would not have been asked about.
 *
 * Blocks are rebuilt rather than relabelled, because each carries its
 * match's name — a swapped block still reading "Pool A · Match 1" on the
 * calendar would point an organiser at the wrong fixture.
 */
export async function swapMatchSlots(
  matchAId: string,
  matchBId: string,
): Promise<{ success: boolean; error?: string }> {
  const admin = await gate();

  const select = {
    id: true,
    tournamentId: true,
    roundLabel: true,
    status: true,
    courtConfigId: true,
    scheduledAt: true,
    durationMins: true,
    slotBlockIds: true,
    homeScore: true,
    awayScore: true,
    tournament: { select: { name: true, sport: true } },
  } as const;

  const [a, b] = await Promise.all([
    db.tournamentMatch.findUnique({ where: { id: matchAId }, select }),
    db.tournamentMatch.findUnique({ where: { id: matchBId }, select }),
  ]);
  if (!a || !b) return { success: false, error: "Match not found" };

  const blocked = swapBlocker(a, b);
  if (blocked) return { success: false, error: blocked };

  const slotOf = (m: typeof a) => ({
    courtConfigId: m.courtConfigId as string,
    scheduledAt: m.scheduledAt as Date,
    durationMins: m.durationMins,
  });
  // Each takes the OTHER's window.
  const assignments = [
    { match: a, slot: slotOf(b) },
    { match: b, slot: slotOf(a) },
  ];

  await db.$transaction(async (tx) => {
    // Every old block first, then every new one. Interleaving would let
    // one fixture's create collide with the other's not-yet-deleted
    // block — the two windows are being exchanged, so they overlap by
    // definition during the move.
    const stale = [...a.slotBlockIds, ...b.slotBlockIds];
    if (stale.length) {
      await tx.slotBlock.deleteMany({ where: { id: { in: stale } } });
    }

    for (const { match, slot } of assignments) {
      // The stored instant is IST wall-clock; the date column is the
      // calendar day that instant falls on in IST, which is not the same
      // thing near midnight and is why this is derived rather than
      // reusing the UTC date.
      const istDay = new Date(slot.scheduledAt.getTime() + 330 * 60000);
      const day = new Date(
        `${istDay.toISOString().slice(0, 10)}T00:00:00.000Z`,
      );
      const startHour = Number(istDay.toISOString().slice(11, 13));
      const hours = Math.max(1, Math.round(slot.durationMins / 60));
      const hoursList = Array.from({ length: hours }, (_, i) => startHour + i);

      const label = `Tournament: ${match.tournament.name} — ${match.roundLabel || "match"}`;
      const blocks = await Promise.all(
        hoursList.map((h) =>
          tx.slotBlock.create({
            data: {
              courtConfigId: slot.courtConfigId,
              date: day,
              startHour: h,
              reason: label,
              blockedBy: admin.id,
              sourceType: "TOURNAMENT",
              sourceId: match.tournamentId,
              sourceLabel: `${label}${
                match.tournament.sport
                  ? ` (${match.tournament.sport.toLowerCase()})`
                  : ""
              }`,
            },
            select: { id: true },
          }),
        ),
      );

      await tx.tournamentMatch.update({
        where: { id: match.id },
        data: {
          courtConfigId: slot.courtConfigId,
          scheduledAt: slot.scheduledAt,
          durationMins: slot.durationMins,
          slotBlockIds: blocks.map((x) => x.id),
        },
      });
    }
  });

  revalidatePath(`/admin/tournaments/${a.tournamentId}`);
  return { success: true };
}

export async function scheduleMatch(
  matchId: string,
  input: { courtConfigId: string; date: string; startHour: number; hours: number }
): Promise<{ success: boolean; error?: string }> {
  const admin = await gate();
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid schedule" };
  const { courtConfigId, date, startHour, hours } = parsed.data;

  const match = await db.tournamentMatch.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      tournamentId: true,
      roundLabel: true,
      slotBlockIds: true,
      tournament: { select: { name: true, sport: true } },
    },
  });
  if (!match) return { success: false, error: "Match not found" };

  const day = new Date(date);
  const hoursList = Array.from({ length: hours }, (_, i) => startHour + i);

  // Clash 1: existing bookings on that court/date/hours.
  const bookingClash = await db.bookingSlot.findFirst({
    where: {
      startHour: { in: hoursList },
      booking: {
        courtConfigId,
        date: day,
        status: { in: ["PENDING", "CONFIRMED"] },
      },
    },
    select: { id: true },
  });
  if (bookingClash) {
    return { success: false, error: "A customer booking already occupies that court/time" };
  }
  // Clash 2: other slot blocks — but NOT this tournament's own.
  //
  // Two kinds of block belong to us and must not count as a conflict:
  //   1. this match's existing block (a reschedule within its own hours), and
  //   2. the tournament's MATCH WINDOWS, which raise SlotBlock rows the
  //      moment the window is created so the public grid stops selling
  //      those hours immediately.
  //
  // Without (2), scheduling a match into the very window it was meant for
  // failed with "That slot is already blocked (Tournament window)" — the
  // tournament colliding with itself, which made the windows actively
  // useless: the better you planned, the less you could schedule.
  const ownWindows = await db.tournamentSlot.findMany({
    where: { tournamentId: match.tournamentId },
    select: { slotBlockIds: true },
  });
  const ownBlockIds = [
    ...match.slotBlockIds,
    ...ownWindows.flatMap((w) => w.slotBlockIds),
  ];
  const blockClash = await db.slotBlock.findFirst({
    where: {
      courtConfigId,
      date: day,
      startHour: { in: hoursList },
      id: { notIn: ownBlockIds },
    },
    select: { id: true, reason: true },
  });
  if (blockClash) {
    return { success: false, error: `That slot is already blocked${blockClash.reason ? ` (${blockClash.reason})` : ""}` };
  }

  // IST wall-clock anchor for display/live screens.
  const scheduledAt = new Date(`${date}T${String(startHour).padStart(2, "0")}:00:00+05:30`);

  await db.$transaction(async (tx) => {
    if (match.slotBlockIds.length) {
      await tx.slotBlock.deleteMany({ where: { id: { in: match.slotBlockIds } } });
    }
    const blocks = await Promise.all(
      hoursList.map((h) =>
        tx.slotBlock.create({
          data: {
            courtConfigId,
            date: day,
            startHour: h,
            reason: `Tournament: ${match.tournament.name} — ${match.roundLabel || "match"}`,
            blockedBy: admin.id,
            // Provenance, so the calendar can name the owner and a
            // recomputation can tell this block apart from another
            // event's. This path already wrote a descriptive reason, but
            // a string is not a link — nothing could trace it back to a
            // tournament, and the conflict check had no way to know a
            // tournament was clashing with itself.
            sourceType: "TOURNAMENT",
            sourceId: match.tournamentId,
            sourceLabel: `Tournament: ${match.tournament.name} — ${match.roundLabel || "match"}${match.tournament.sport ? ` (${match.tournament.sport.toLowerCase()})` : ""}`,
          },
          select: { id: true },
        })
      )
    );
    await tx.tournamentMatch.update({
      where: { id: matchId },
      data: {
        courtConfigId,
        scheduledAt,
        durationMins: hours * 60,
        slotBlockIds: blocks.map((b) => b.id),
      },
    });
  });

  revalidatePath(`/admin/tournaments/${match.tournamentId}`);
  return { success: true };
}

export async function unscheduleMatch(
  matchId: string
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const match = await db.tournamentMatch.findUnique({
    where: { id: matchId },
    select: { id: true, tournamentId: true, slotBlockIds: true, status: true },
  });
  if (!match) return { success: false, error: "Match not found" };
  if (match.status !== "SCHEDULED") {
    return { success: false, error: "Only un-started matches can be unscheduled" };
  }
  await db.$transaction(async (tx) => {
    if (match.slotBlockIds.length) {
      await tx.slotBlock.deleteMany({ where: { id: { in: match.slotBlockIds } } });
    }
    await tx.tournamentMatch.update({
      where: { id: matchId },
      data: { courtConfigId: null, scheduledAt: null, slotBlockIds: [] },
    });
  });
  revalidatePath(`/admin/tournaments/${match.tournamentId}`);
  return { success: true };
}

/** Active courts for a sport — the wizard's prize-pass picker, which runs
 *  before a tournament exists and so can't key off its id. */
export async function listCourtsForSport(sport: string) {
  await gate();
  return db.courtConfig.findMany({
    where: { sport: sport as never, isActive: true },
    orderBy: { label: "asc" },
    select: { id: true, label: true },
  });
}

/** Courts for the tournament's sport (schedule form options). */
export async function listCourtsForTournament(tournamentId: string) {
  await gate();
  const t = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: { sport: true },
  });
  if (!t) return [];
  return db.courtConfig.findMany({
    where: { sport: t.sport },
    orderBy: { label: "asc" },
    select: { id: true, label: true, size: true },
  });
}
