"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import {
  STATUS_FLOW,
  slugify,
  scorerCodeGen,
  structureWarnings,
} from "@/lib/tournament-config";

async function gate() {
  return requireAdmin("MANAGE_TOURNAMENTS");
}

// ── Wizard payload ──────────────────────────────────────────────────
const statFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/^[a-z0-9_]+$/, "Stat keys: lowercase letters/numbers/underscore"),
  label: z.string().trim().min(1).max(40),
});

const prizeSchema = z.object({
  place: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(160),
});

const wizardSchema = z.object({
  name: z.string().trim().min(3, "Name is required").max(80),
  sport: z.enum(["CRICKET", "FOOTBALL", "PICKLEBALL"]),
  format: z.enum(["LEAGUE", "KNOCKOUT", "POOLS_KNOCKOUT"]),
  description: z.string().trim().max(2000).optional(),
  rules: z.string().trim().max(20000).optional(),
  bannerImageUrl: z.string().trim().max(500).optional(),

  totalTeams: z.number().int().min(2).max(128),
  poolCount: z.number().int().min(0).max(16),
  teamsPerPool: z.number().int().min(0).max(32),
  advancePerPool: z.number().int().min(0).max(16),
  thirdPlaceMatch: z.boolean(),
  membersPerTeamMin: z.number().int().min(1).max(50),
  membersPerTeamMax: z.number().int().min(1).max(50),

  entryFee: z.number().int().min(0).max(10_00_000),
  feeMode: z.enum(["FULL", "ADVANCE", "FREE"]),
  advancePct: z.number().int().min(1).max(99),
  allowCoupons: z.boolean(),
  allowRewardPoints: z.boolean(),
  waitlistEnabled: z.boolean(),

  // ISO datetime strings, "" = unset
  regOpenAt: z.string().optional(),
  regCloseAt: z.string().optional(),
  revealAt: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),

  pointsWin: z.number().int().min(0).max(10),
  pointsDraw: z.number().int().min(0).max(10),
  pointsLoss: z.number().int().min(0).max(10),
  tiebreakers: z.array(z.enum(["H2H", "SCORE_DIFF", "SCORE_FOR", "NAME"])).min(1),

  statFields: z.array(statFieldSchema).max(12),
  prizePool: z.number().int().min(0).max(1_00_00_000).nullable(),
  prizes: z.array(prizeSchema).max(12),

  liveScoringEnabled: z.boolean(),
  liveScreenPlatform: z.enum(["BOTH", "APP_ONLY", "WEB_ONLY", "OFF"]),
});

export type TournamentWizardInput = z.infer<typeof wizardSchema>;

function toDate(s: string | undefined): Date | null {
  if (!s) return null;
  // The wizard's <input type="datetime-local"> submits a bare
  // "YYYY-MM-DDTHH:mm" — no timezone. `new Date(bare)` parses it in the
  // SERVER's zone (UTC on Vercel), silently shifting an admin's 6:00 PM
  // to 11:30 PM IST. Admin times are venue wall-clock, so pin them to IST.
  const bare = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s);
  const d = new Date(bare ? `${s}${s.length === 16 ? ":00" : ""}+05:30` : s);
  return isNaN(d.getTime()) ? null : d;
}

function wizardData(d: TournamentWizardInput) {
  return {
    name: d.name,
    sport: d.sport,
    format: d.format,
    description: d.description || null,
    rules: d.rules || null,
    bannerImageUrl: d.bannerImageUrl || null,
    totalTeams: d.totalTeams,
    poolCount: d.format === "POOLS_KNOCKOUT" ? d.poolCount : 0,
    teamsPerPool: d.format === "POOLS_KNOCKOUT" ? d.teamsPerPool : 0,
    advancePerPool: d.format === "POOLS_KNOCKOUT" ? d.advancePerPool : 0,
    thirdPlaceMatch: d.thirdPlaceMatch,
    membersPerTeamMin: d.membersPerTeamMin,
    membersPerTeamMax: d.membersPerTeamMax,
    entryFee: d.feeMode === "FREE" ? 0 : d.entryFee,
    feeMode: d.feeMode,
    advancePct: d.advancePct,
    allowCoupons: d.allowCoupons,
    allowRewardPoints: d.allowRewardPoints,
    waitlistEnabled: d.waitlistEnabled,
    regOpenAt: toDate(d.regOpenAt),
    regCloseAt: toDate(d.regCloseAt),
    revealAt: toDate(d.revealAt),
    startDate: toDate(d.startDate),
    endDate: toDate(d.endDate),
    pointsWin: d.pointsWin,
    pointsDraw: d.pointsDraw,
    pointsLoss: d.pointsLoss,
    tiebreakers: d.tiebreakers,
    statFields: d.statFields,
    prizePool: d.prizePool,
    prizes: d.prizes,
    liveScoringEnabled: d.liveScoringEnabled,
    liveScreenPlatform: d.liveScreenPlatform,
  };
}

function validateWizard(input: unknown):
  | { ok: true; data: TournamentWizardInput }
  | { ok: false; error: string } {
  const parsed = wizardSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Invalid data" };
  }
  const d = parsed.data;
  if (d.membersPerTeamMin > d.membersPerTeamMax) {
    return { ok: false, error: "Min members per team cannot exceed max" };
  }
  const structural = structureWarnings(d);
  // Pool-math mismatches are hard errors; bye warnings are allowed.
  const hard = structural.find((w) => w.includes("must equal total teams") || w.includes("at least"));
  if (d.format === "POOLS_KNOCKOUT" && hard) return { ok: false, error: hard };
  return { ok: true, data: d };
}

export async function createTournament(
  input: unknown
): Promise<{ success: boolean; error?: string; id?: string }> {
  const admin = await gate();
  const v = validateWizard(input);
  if (!v.ok) return { success: false, error: v.error };

  // Unique slug: name + numeric suffix on collision.
  const base = slugify(v.data.name) || "tournament";
  let slug = base;
  for (let i = 2; await db.tournament.findUnique({ where: { slug } }); i++) {
    slug = `${base}-${i}`;
  }

  const t = await db.tournament.create({
    data: {
      ...wizardData(v.data),
      slug,
      scorerCode: v.data.liveScoringEnabled ? scorerCodeGen() : null,
      createdBy: admin.id,
    },
  });
  // Auto-draft the marketing campaign (editable from the Campaign tab).
  const { draftCampaign } = await import("@/lib/tournament-campaign");
  await draftCampaign(t.id).catch(() => {});
  revalidatePath("/admin/tournaments");
  return { success: true, id: t.id };
}

export async function updateTournament(
  id: string,
  input: unknown
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const v = validateWizard(input);
  if (!v.ok) return { success: false, error: v.error };
  const existing = await db.tournament.findUnique({ where: { id }, select: { scorerCode: true } });
  if (!existing) return { success: false, error: "Tournament not found" };
  try {
    await db.tournament.update({
      where: { id },
      data: {
        ...wizardData(v.data),
        // Mint a scorer code the first time live scoring is switched on.
        scorerCode:
          v.data.liveScoringEnabled && !existing.scorerCode
            ? scorerCodeGen()
            : existing.scorerCode,
      },
    });
    revalidatePath("/admin/tournaments");
    revalidatePath(`/admin/tournaments/${id}`);
    return { success: true };
  } catch {
    return { success: false, error: "Failed to save tournament" };
  }
}

export async function transitionTournament(
  id: string,
  toStatus: string
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const t = await db.tournament.findUnique({ where: { id }, select: { status: true, format: true } });
  if (!t) return { success: false, error: "Tournament not found" };
  const allowed = STATUS_FLOW[t.status] || [];
  if (!allowed.includes(toStatus)) {
    return { success: false, error: `Cannot move from ${t.status} to ${toStatus}` };
  }
  if (toStatus === "POOLS_REVEALED" && t.format !== "POOLS_KNOCKOUT") {
    return { success: false, error: "Only pools tournaments can reveal pools" };
  }
  await db.tournament.update({ where: { id }, data: { status: toStatus as never } });
  // Fire the milestone mapped to this transition (enabled items only).
  const { TRANSITION_MILESTONE, fireMilestone } = await import("@/lib/tournament-campaign");
  const milestone = TRANSITION_MILESTONE[toStatus];
  if (milestone) await fireMilestone(id, milestone).catch(() => {});
  revalidatePath(`/admin/tournaments/${id}`);
  revalidatePath("/admin/tournaments");
  return { success: true };
}

// ── Module master switch (mirrors passes) ───────────────────────────
export async function getTournamentsEnabled(): Promise<boolean> {
  await gate();
  const settings = await db.arenaSettings.findFirst({
    select: { tournamentsEnabled: true },
  });
  return settings?.tournamentsEnabled ?? false;
}

export async function setTournamentsEnabled(enabled: boolean): Promise<{ ok: true }> {
  await gate();
  const existing = await db.arenaSettings.findFirst({ select: { id: true } });
  if (existing) {
    await db.arenaSettings.update({
      where: { id: existing.id },
      data: { tournamentsEnabled: enabled },
    });
  } else {
    await db.arenaSettings.create({ data: { tournamentsEnabled: enabled } });
  }
  revalidatePath("/admin/tournaments");
  revalidatePath("/tournaments");
  return { ok: true };
}

// ── Reads ───────────────────────────────────────────────────────────
export async function listTournamentsAdmin() {
  await gate();
  return db.tournament.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { teams: true, matches: true } } },
  });
}

export async function getTournamentAdmin(id: string) {
  await gate();
  return db.tournament.findUnique({
    where: { id },
    include: {
      pools: { orderBy: { order: "asc" }, include: { teams: { select: { id: true, name: true } } } },
      teams: {
        orderBy: { createdAt: "asc" },
        include: { members: { orderBy: { order: "asc" } }, pool: { select: { name: true } } },
      },
      matches: {
        orderBy: [{ stage: "asc" }, { sequence: "asc" }],
        include: {
          homeTeam: { select: { id: true, name: true, color: true } },
          awayTeam: { select: { id: true, name: true, color: true } },
          winnerTeam: { select: { id: true, name: true } },
          pool: { select: { name: true } },
          courtConfig: { select: { label: true } },
        },
      },
      _count: { select: { matches: true } },
    },
  });
}

// ── Team management ─────────────────────────────────────────────────
export async function setTeamStatus(
  teamId: string,
  status: "CONFIRMED" | "WAITLISTED" | "WITHDRAWN" | "REJECTED"
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const team = await db.tournamentTeam.findUnique({
    where: { id: teamId },
    select: {
      tournamentId: true,
      pointsUsed: true,
      captainUserId: true,
      tournament: { select: { totalTeams: true } },
    },
  });
  if (!team) return { success: false, error: "Team not found" };
  if (status === "CONFIRMED") {
    const confirmed = await db.tournamentTeam.count({
      where: { tournamentId: team.tournamentId, status: "CONFIRMED" },
    });
    if (confirmed >= team.tournament.totalTeams) {
      return { success: false, error: "Tournament is already full" };
    }
  }
  await db.tournamentTeam.update({ where: { id: teamId }, data: { status } });
  // Kicking a team out returns any reward points its captain redeemed at
  // registration (idempotent — one refund per team).
  if ((status === "REJECTED" || status === "WITHDRAWN") && team.pointsUsed > 0 && team.captainUserId) {
    const { refundRedemption } = await import("@/lib/rewards/redeem");
    await refundRedemption({
      userId: team.captainUserId,
      points: team.pointsUsed,
      tournamentTeamId: teamId,
      reason: `tournament team ${status.toLowerCase()}`,
    }).catch(() => {});
  }
  revalidatePath(`/admin/tournaments/${team.tournamentId}`);
  return { success: true };
}

/** Record an at-venue collection (ADVANCE mode balance, or cash entry). */
export async function recordTeamPayment(
  teamId: string,
  amount: number,
  method: string
): Promise<{ success: boolean; error?: string }> {
  const admin = await gate();
  if (!Number.isInteger(amount) || amount <= 0) {
    return { success: false, error: "Enter a valid amount" };
  }
  const team = await db.tournamentTeam.findUnique({
    where: { id: teamId },
    select: { tournamentId: true, dueAmount: true },
  });
  if (!team) return { success: false, error: "Team not found" };
  if (amount > team.dueAmount) {
    return { success: false, error: `Only ₹${team.dueAmount} is due` };
  }
  await db.tournamentTeam.update({
    where: { id: teamId },
    data: {
      paidAmount: { increment: amount },
      dueAmount: { decrement: amount },
      paymentMethod: method,
      // trail of who took the money lives in the admin audit note
    },
  });
  void admin;
  revalidatePath(`/admin/tournaments/${team.tournamentId}`);
  return { success: true };
}

const adminRegisterSchema = z.object({
  tournamentId: z.string().min(1),
  teamName: z.string().trim().min(2).max(60),
  captainName: z.string().trim().min(1).max(120),
  captainPhone: z.string().trim().min(6).max(20),
  members: z.array(z.string().trim().min(1).max(60)).min(1).max(50),
  /** ₹ collected at the venue right now (0 allowed — collect later). */
  collectedAmount: z.number().int().min(0).max(10_00_000),
  method: z.enum(["CASH", "STATIC_QR", "FREE"]),
});

/** Venue-side registration by an admin — mirrors admin bookings / issue-pass:
 *  the team is CONFIRMED immediately with the payment marked manually
 *  (cash / static-QR / free). No coupon/points; the remainder (if any)
 *  stays on dueAmount for the Collect button. */
export async function adminRegisterTeam(
  input: unknown
): Promise<{ success: boolean; error?: string; teamId?: string }> {
  await gate();
  const parsed = adminRegisterSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Invalid data" };
  }
  const d = parsed.data;
  const t = await db.tournament.findUnique({
    where: { id: d.tournamentId },
    select: { id: true, totalTeams: true, entryFee: true, feeMode: true },
  });
  if (!t) return { success: false, error: "Tournament not found" };

  const taken = await db.tournamentTeam.count({
    where: { tournamentId: t.id, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] } },
  });
  if (taken >= t.totalTeams) return { success: false, error: "Tournament is full" };

  const nameTaken = await db.tournamentTeam.findFirst({
    where: {
      tournamentId: t.id,
      name: { equals: d.teamName, mode: "insensitive" },
      status: { in: ["CONFIRMED", "PENDING_PAYMENT", "WAITLISTED"] },
    },
    select: { id: true },
  });
  if (nameTaken) return { success: false, error: "That team name is taken" };

  const fee = t.feeMode === "FREE" || d.method === "FREE" ? 0 : t.entryFee;
  const paid = Math.min(d.collectedAmount, fee);
  const team = await db.tournamentTeam.create({
    data: {
      tournamentId: t.id,
      status: "CONFIRMED",
      name: d.teamName,
      captainName: d.captainName,
      captainPhone: d.captainPhone.replace(/[^\d+]/g, ""),
      paidAmount: paid,
      dueAmount: Math.max(0, fee - paid),
      paymentMethod: d.method,
      members: {
        create: d.members.map((name, i) => ({ name, order: i, isCaptain: i === 0 })),
      },
    },
    select: { id: true },
  });
  revalidatePath(`/admin/tournaments/${t.id}`);
  return { success: true, teamId: team.id };
}

/** Admin-side edit of a team's identity/roster (moderation). */
export async function adminEditTeam(
  teamId: string,
  input: { name?: string; color?: string | null; logoUrl?: string | null; members?: string[] }
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const team = await db.tournamentTeam.findUnique({
    where: { id: teamId },
    select: { tournamentId: true },
  });
  if (!team) return { success: false, error: "Team not found" };

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { success: false, error: "Team name required" };
    data.name = name.slice(0, 60);
  }
  if (input.color !== undefined) data.color = input.color;
  if (input.logoUrl !== undefined) data.logoUrl = input.logoUrl;

  await db.$transaction(async (tx) => {
    await tx.tournamentTeam.update({ where: { id: teamId }, data });
    if (input.members) {
      const names = input.members.map((m) => m.trim()).filter(Boolean).slice(0, 50);
      await tx.tournamentTeamMember.deleteMany({ where: { teamId } });
      await tx.tournamentTeamMember.createMany({
        data: names.map((name, i) => ({ teamId, name: name.slice(0, 60), order: i, isCaptain: i === 0 })),
      });
    }
  });
  revalidatePath(`/admin/tournaments/${team.tournamentId}`);
  return { success: true };
}
