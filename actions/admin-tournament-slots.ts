"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import {
  expandSlots,
  totalCapacity,
  generateCandidates,
  type SlotWindow,
  type TeamForDraw,
} from "@/lib/tournament-scheduling";
import { generateFixtures } from "@/actions/admin-tournament-fixtures";

/**
 * Admin-decided match windows, and the draw/schedule they feed.
 *
 * Windows cover POOL and LEAGUE matches only. Semi-finals and the final
 * are scheduled by hand once the pool stage has produced real names —
 * pre-committing a slot to "winner of Pool A" helps nobody.
 */
function gate() {
  return requireAdmin("MANAGE_TOURNAMENTS");
}

const slotSchema = z.object({
  tournamentId: z.string().min(1),
  date: z.string().min(1),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(1).max(24),
  courtConfigId: z.string().optional().nullable(),
  label: z.string().max(60).optional().nullable(),
});

export async function addTournamentSlot(
  input: z.infer<typeof slotSchema>,
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const parsed = slotSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid slot" };
  const d = parsed.data;
  if (d.endHour <= d.startHour) {
    return { success: false, error: "End hour must be after the start hour" };
  }
  await db.tournamentSlot.create({
    data: {
      tournamentId: d.tournamentId,
      // Date-only column — parse as UTC midnight so the stored day is
      // the day the admin picked, not a timezone-shifted neighbour.
      date: new Date(`${d.date}T00:00:00.000Z`),
      startHour: d.startHour,
      endHour: d.endHour,
      courtConfigId: d.courtConfigId || null,
      label: d.label?.trim() || null,
    },
  });
  revalidatePath(`/admin/tournaments/${d.tournamentId}`);
  return { success: true };
}

export async function deleteTournamentSlot(
  slotId: string,
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const slot = await db.tournamentSlot.findUnique({
    where: { id: slotId },
    select: { tournamentId: true },
  });
  if (!slot) return { success: false, error: "Slot not found" };
  // Teams may have ticked this window; drop it from their preferences
  // so nothing points at a slot that no longer exists.
  const teams = await db.tournamentTeam.findMany({
    where: { tournamentId: slot.tournamentId, preferredSlotIds: { has: slotId } },
    select: { id: true, preferredSlotIds: true },
  });
  await db.$transaction([
    ...teams.map((t) =>
      db.tournamentTeam.update({
        where: { id: t.id },
        data: { preferredSlotIds: t.preferredSlotIds.filter((x) => x !== slotId) },
      }),
    ),
    db.tournamentSlot.delete({ where: { id: slotId } }),
  ]);
  revalidatePath(`/admin/tournaments/${slot.tournamentId}`);
  return { success: true };
}

export async function setMatchDuration(
  tournamentId: string,
  minutes: number,
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const m = Math.trunc(minutes);
  if (m < 15 || m > 480) {
    return { success: false, error: "Match length must be 15–480 minutes" };
  }
  await db.tournament.update({
    where: { id: tournamentId },
    data: { matchDurationMinutes: m },
  });
  revalidatePath(`/admin/tournaments/${tournamentId}`);
  return { success: true };
}

/** Windows + capacity + how many pool matches the format implies. */
export async function getSlotPlanning(tournamentId: string) {
  await gate();
  const t = await db.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      slots: { orderBy: [{ date: "asc" }, { startHour: "asc" }], include: { courtConfig: { select: { label: true } } } },
      teams: { where: { status: "CONFIRMED" }, select: { id: true, name: true, preferredSlotIds: true } },
    },
  });
  if (!t) return null;

  const windows: SlotWindow[] = t.slots.map((s) => ({
    id: s.id,
    date: s.date,
    startHour: s.startHour,
    endHour: s.endHour,
    label: s.label,
    courtConfigId: s.courtConfigId,
  }));

  // Pool matches implied by the format: each pool plays a round-robin.
  const poolCount = t.format === "POOLS_KNOCKOUT" ? Math.max(1, t.poolCount) : 1;
  const per = Math.ceil(t.teams.length / poolCount);
  const poolMatches =
    t.format === "LEAGUE"
      ? (t.teams.length * (t.teams.length - 1)) / 2
      : poolCount * ((per * (per - 1)) / 2);

  return {
    matchDurationMinutes: t.matchDurationMinutes,
    scheduleApprovedAt: t.scheduleApprovedAt,
    poolCount,
    confirmedTeams: t.teams.length,
    poolMatchesNeeded: poolMatches,
    capacity: totalCapacity(windows, t.matchDurationMinutes),
    slots: t.slots.map((s) => ({
      id: s.id,
      date: s.date.toISOString(),
      startHour: s.startHour,
      endHour: s.endHour,
      label: s.label,
      courtLabel: s.courtConfig?.label ?? null,
      // How many teams ticked this window — the admin's signal for
      // whether a window is worth keeping.
      preferredBy: t.teams.filter((x) => x.preferredSlotIds.includes(s.id)).length,
    })),
  };
}

/** Candidate draws for the admin to choose between. Read-only. */
export async function generateScheduleCandidates(tournamentId: string) {
  await gate();
  const t = await db.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      slots: { orderBy: [{ date: "asc" }, { startHour: "asc" }] },
      teams: {
        where: { status: "CONFIRMED", archivedAt: null },
        select: { id: true, name: true, preferredSlotIds: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!t) return { success: false as const, error: "Tournament not found" };
  if (t.slots.length === 0) {
    return { success: false as const, error: "Add at least one match window first" };
  }
  if (t.teams.length < 2) {
    return { success: false as const, error: "Need at least 2 confirmed teams" };
  }

  const windows: SlotWindow[] = t.slots.map((s) => ({
    id: s.id, date: s.date, startHour: s.startHour, endHour: s.endHour,
    label: s.label, courtConfigId: s.courtConfigId,
  }));
  const teams: TeamForDraw[] = t.teams.map((x) => ({
    id: x.id, name: x.name, preferredSlotIds: x.preferredSlotIds,
  }));
  const poolCount = t.format === "POOLS_KNOCKOUT" ? Math.max(1, t.poolCount) : 1;

  const plans = generateCandidates(teams, windows, {
    poolCount,
    matchDurationMinutes: t.matchDurationMinutes,
  });
  const nameById = new Map(teams.map((x) => [x.id, x.name]));
  return {
    success: true as const,
    capacity: totalCapacity(windows, t.matchDurationMinutes),
    plans: plans.map((p) => ({
      pools: p.pools.map((ids) => ids.map((id) => ({ id, name: nameById.get(id) ?? id }))),
      scheduled: p.scheduled,
      unscheduled: p.unscheduled,
      compromises: p.compromises,
      score: p.score,
      matches: p.matches.map((m) => ({
        poolIndex: m.poolIndex,
        home: nameById.get(m.homeTeamId) ?? m.homeTeamId,
        away: nameById.get(m.awayTeamId) ?? m.awayTeamId,
        homeTeamId: m.homeTeamId,
        awayTeamId: m.awayTeamId,
        slot: m.slot
          ? {
              slotId: m.slot.slotId,
              date: m.slot.date.toISOString(),
              startHour: m.slot.startHour,
              startMinute: m.slot.startMinute,
            }
          : null,
      })),
    })),
  };
}

/**
 * Commit a candidate: write the pools, let the existing fixture
 * generator build the round-robin + knockout skeleton, then stamp the
 * generated pool matches with their chosen times and raise SlotBlocks
 * so the public booking grid stops selling those hours.
 */
export async function approveSchedule(
  tournamentId: string,
  planIndex: number,
): Promise<{ success: boolean; error?: string; scheduled?: number }> {
  const admin = await gate();
  const res = await generateScheduleCandidates(tournamentId);
  if (!res.success) return { success: false, error: res.error };
  const plan = res.plans[planIndex];
  if (!plan) return { success: false, error: "That plan is no longer available" };

  const t = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, sport: true, format: true, matchDurationMinutes: true },
  });
  if (!t) return { success: false, error: "Tournament not found" };

  const started = await db.tournamentMatch.findFirst({
    where: { tournamentId, status: { in: ["LIVE", "COMPLETED", "WALKOVER"] } },
    select: { id: true },
  });
  if (started) {
    return { success: false, error: "Matches already started — can't re-draw" };
  }

  // 1. Rewrite pools from the chosen plan.
  //
  // A create+updateMany PER POOL inside an interactive transaction blew
  // the 5s default on a pooled connection (surfaced by the E2E drive:
  // "Transaction not found ... refers to an old closed transaction").
  // createMany collapses the inserts into one round trip, and the
  // timeout is raised for the remaining per-pool assignments so a
  // larger tournament has headroom.
  await db.$transaction(
    async (tx) => {
      await tx.tournamentTeam.updateMany({ where: { tournamentId }, data: { poolId: null } });
      await tx.tournamentPool.deleteMany({ where: { tournamentId } });
      await tx.tournamentPool.createMany({
        data: plan.pools.map((_, i) => ({
          tournamentId,
          name: `Pool ${String.fromCharCode(65 + i)}`,
          order: i,
        })),
      });
      const created = await tx.tournamentPool.findMany({
        where: { tournamentId },
        orderBy: { order: "asc" },
        select: { id: true, order: true },
      });
      for (const pool of created) {
        const ids = plan.pools[pool.order]?.map((x) => x.id) ?? [];
        if (ids.length === 0) continue;
        await tx.tournamentTeam.updateMany({
          where: { id: { in: ids } },
          data: { poolId: pool.id },
        });
      }
    },
    { timeout: 20000, maxWait: 10000 },
  );

  // 2. Reuse the existing generator so the knockout skeleton, seeding
  //    labels and winner-of chains stay in one place.
  const gen = await generateFixtures(tournamentId);
  if (!gen.success) return { success: false, error: gen.error };

  // 3. Stamp times onto the pool/league matches this plan scheduled.
  const poolMatches = await db.tournamentMatch.findMany({
    where: { tournamentId, stage: { in: ["POOL", "LEAGUE"] } },
    select: { id: true, homeTeamId: true, awayTeamId: true },
  });
  const slotById = new Map(
    (await db.tournamentSlot.findMany({ where: { tournamentId } })).map((s) => [s.id, s]),
  );

  let scheduled = 0;
  for (const pm of plan.matches) {
    if (!pm.slot) continue;
    // Match on the unordered pair — the generator may flip home/away.
    const row = poolMatches.find(
      (m) =>
        (m.homeTeamId === pm.homeTeamId && m.awayTeamId === pm.awayTeamId) ||
        (m.homeTeamId === pm.awayTeamId && m.awayTeamId === pm.homeTeamId),
    );
    if (!row) continue;
    const slot = slotById.get(pm.slot.slotId);
    const day = new Date(pm.slot.date);
    const scheduledAt = new Date(
      Date.UTC(
        day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(),
        pm.slot.startHour, pm.slot.startMinute,
      ),
    );

    // Block the venue hours this match occupies so the booking grid
    // can't sell them underneath the tournament.
    const blockIds: string[] = [];
    if (slot?.courtConfigId) {
      const hours = Math.max(1, Math.round(t.matchDurationMinutes / 60));
      for (let h = 0; h < hours; h++) {
        const b = await db.slotBlock.create({
          data: {
            courtConfigId: slot.courtConfigId,
            sport: t.sport,
            date: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())),
            startHour: pm.slot.startHour + h,
            reason: "Tournament match",
            blockedBy: admin.id,
          },
        });
        blockIds.push(b.id);
      }
    }

    await db.tournamentMatch.update({
      where: { id: row.id },
      data: {
        scheduledAt,
        courtConfigId: slot?.courtConfigId ?? null,
        slotBlockIds: blockIds,
      },
    });
    scheduled++;
  }

  await db.tournament.update({
    where: { id: tournamentId },
    data: { scheduleApprovedAt: new Date() },
  });
  revalidatePath(`/admin/tournaments/${tournamentId}`);
  return { success: true, scheduled };
}
