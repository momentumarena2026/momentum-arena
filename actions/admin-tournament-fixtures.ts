"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { dealPools } from "@/lib/tournament-scheduling";
import {
  roundRobinRounds,
  buildKnockoutSkeleton,
  poolQualifierSlots,
  shuffle,
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

export async function moveTeamToPool(
  teamId: string,
  poolId: string | null
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const team = await db.tournamentTeam.findUnique({
    where: { id: teamId },
    select: { tournamentId: true, tournament: { select: { status: true } } },
  });
  if (!team) return { success: false, error: "Team not found" };
  if (!["REG_OPEN", "REG_CLOSED"].includes(team.tournament.status)) {
    return { success: false, error: "Pools are locked after the reveal" };
  }
  await db.tournamentTeam.update({ where: { id: teamId }, data: { poolId } });
  revalidatePath(`/admin/tournaments/${team.tournamentId}`);
  return { success: true };
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
        for (const round of roundRobinRounds(pool.teams.map((x) => x.id))) {
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
