"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
// NOTE: do not re-export TournamentWizardInput from here. Every export of a
// "use server" module is compiled into a server-action reference, and the
// transform emits one for a bare `export type { ... }` too — producing a
// runtime export that does not exist ("Export TournamentWizardInput doesn't
// exist in target module"). TypeScript erases the re-export, so this fails
// only at build/render, never at `tsc`. Consumers import the type from
// @/lib/tournament-wizard-schema directly.
import {
  wizardSchema,
  type TournamentWizardInput,
} from "@/lib/tournament-wizard-schema";
import {
  STATUS_FLOW,
  slugify,
  scorerCodeGen,
  structureWarnings,
} from "@/lib/tournament-config";
import { reconcileTeamSquad, filterValidSlotKeys } from "@/lib/tournaments";
import {
  DUPLICABLE_FIELDS,
  duplicateWizardInput,
} from "@/lib/tournament-duplicate";
import { sanitizeRichText } from "@/lib/rich-text.server";
import {
  TEAM_COLLECT_METHODS,
  TEAM_REGISTER_METHODS,
} from "@/lib/tournament-payments";

async function gate() {
  return requireAdmin("MANAGE_TOURNAMENTS");
}


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
  const thirdParty = d.host === "THIRD_PARTY";
  return {
    name: d.name,
    sport: d.sport,
    format: d.format,
    description: d.description || null,
    // Rules arrive as HTML from the admin editor. Scrubbed here rather
    // than at render because the mobile app reads the same string
    // straight off the public API and has no sanitiser of its own — the
    // database boundary is the one point every reader passes through.
    rules: sanitizeRichText(d.rules),
    bannerImageUrl: d.bannerImageUrl || null,
    totalTeams: d.totalTeams,
    poolCount: d.format === "POOLS_KNOCKOUT" ? d.poolCount : 0,
    teamsPerPool: d.format === "POOLS_KNOCKOUT" ? d.teamsPerPool : 0,
    advancePerPool: d.format === "POOLS_KNOCKOUT" ? d.advancePerPool : 0,
    thirdPlaceMatch: d.thirdPlaceMatch,
    membersPerTeamMin: d.membersPerTeamMin,
    membersPerTeamMax: d.membersPerTeamMax,
    maxOversPerBowler: d.sport === "CRICKET" ? (d.maxOversPerBowler ?? 0) : 0,
    oversPerInnings: d.sport === "CRICKET" ? (d.oversPerInnings ?? 0) : 0,
    wicketsPerInnings: d.sport === "CRICKET" ? (d.wicketsPerInnings ?? 10) : 10,
    bracketSeeding: d.format === "POOLS_KNOCKOUT" ? (d.bracketSeeding ?? "POOL_ORDER") : "POOL_ORDER",
    host: d.host ?? "VENUE",
    organizerName: thirdParty ? d.organizerName || null : null,
    organizerPhone: thirdParty ? d.organizerPhone || null : null,
    organizerEmail: thirdParty ? d.organizerEmail || null : null,
    quotedAmount: thirdParty ? (d.quotedAmount ?? 0) : 0,
    organizerNote: thirdParty ? d.organizerNote || null : null,
    // A third-party event takes no money from teams — the organiser
    // collects entry fees themselves. Pinned here rather than trusted from
    // the form, so no checkout can be constructed for one even if the
    // wizard is bypassed.
    entryFee: thirdParty || d.feeMode === "FREE" ? 0 : d.entryFee,
    feeMode: thirdParty ? ("FREE" as const) : d.feeMode,
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
): Promise<{ success: boolean; error?: string; note?: string }> {
  const admin = await gate();
  const t = await db.tournament.findUnique({
    where: { id },
    select: { status: true, format: true, regCloseAt: true },
  });
  if (!t) return { success: false, error: "Tournament not found" };
  const allowed = STATUS_FLOW[t.status] || [];
  if (!allowed.includes(toStatus)) {
    return { success: false, error: `Cannot move from ${t.status} to ${toStatus}` };
  }
  if (toStatus === "POOLS_REVEALED" && t.format !== "POOLS_KNOCKOUT") {
    return { success: false, error: "Only pools tournaments can reveal pools" };
  }

  // Reopening registrations means nothing while the closing time sits in
  // the past — three separate places would undo it. applyScheduledTransitions
  // flips the status straight back on the next public page load, the
  // tournament list does the same lazily, and registerTeam refuses with
  // "Registrations have closed" even when the status says otherwise. So the
  // deadline is cleared and the window stays open until an admin closes it
  // again or sets a new one in Settings.
  const reopening = toStatus === "REG_OPEN" && !!t.regCloseAt && t.regCloseAt < new Date();

  await db.tournament.update({
    where: { id },
    data: {
      status: toStatus as never,
      ...(reopening ? { regCloseAt: null } : {}),
    },
  });
  // ── Venue hours + site banners follow the status ──────────────────
  // Cancelling used to leave both behind: every blocked hour stayed dark
  // until an admin deleted the windows one by one, and the campaign banners
  // kept advertising a tournament that was no longer running. Restoring a
  // mis-clicked cancel puts both back, which is why release/restore are
  // paired rather than a one-way cleanup.
  const notes: string[] = [];
  if (toStatus === "CANCELLED") {
    const { releaseTournamentBlocks } = await import("@/lib/tournament-blocks");
    const { hideTournamentBanners } = await import("@/lib/tournament-campaign");
    const freed = await releaseTournamentBlocks(id).catch(() => null);
    const hidden = await hideTournamentBanners(id).catch(() => null);
    if (freed?.released) {
      notes.push(
        `${freed.released} blocked hour${freed.released === 1 ? "" : "s"} released back to the booking grid.`,
      );
    }
    if (hidden?.hidden) {
      notes.push(
        `${hidden.hidden} promo banner${hidden.hidden === 1 ? "" : "s"} hidden.`,
      );
    }
  } else if (t.status === "CANCELLED") {
    const { restoreTournamentBlocks } = await import("@/lib/tournament-blocks");
    const { showTournamentBanners } = await import("@/lib/tournament-campaign");
    const back = await restoreTournamentBlocks(id, admin.id).catch(() => null);
    const shown = await showTournamentBanners(id).catch(() => null);
    if (back?.raised) {
      notes.push(
        `${back.raised} hour${back.raised === 1 ? "" : "s"} blocked again.`,
      );
    }
    // Bookings taken while the tournament was cancelled are kept, not
    // bulldozed — same rule addTournamentSlot follows. The admin needs to
    // know they exist so they can be moved by hand.
    if (back?.clashes) {
      notes.push(
        `${back.clashes} booking${back.clashes === 1 ? " was" : "s were"} taken on those hours while it was cancelled — move ${back.clashes === 1 ? "it" : "them"} by hand.`,
      );
    }
    if (shown?.shown) {
      notes.push(
        `${shown.shown} promo banner${shown.shown === 1 ? "" : "s"} restored.`,
      );
    }
  }

  // Prize passes are minted on completion, to the captain of whichever team
  // finished in the configured position. Idempotent, and deliberately
  // non-fatal: a pass that can't be issued (captain never linked an
  // account, court retired) must not block the tournament from closing —
  // the admin sees the reason on the manage page.
  if (toStatus === "COMPLETED") {
    const { issuePrizePasses } = await import("@/lib/tournament-prizes");
    await issuePrizePasses(id, admin.id).catch(() => {});
  }
  // Fire the milestone mapped to this transition (enabled items only).
  const { TRANSITION_MILESTONE, fireMilestone } = await import("@/lib/tournament-campaign");
  const milestone = TRANSITION_MILESTONE[toStatus];
  if (milestone) await fireMilestone(id, milestone).catch(() => {});
  revalidatePath(`/admin/tournaments/${id}`);
  revalidatePath("/admin/tournaments");
  // The booking grid and the public tournament list both change shape here.
  revalidatePath("/admin/slots");
  revalidatePath("/tournaments");
  return { success: true, ...(notes.length ? { note: notes.join(" ") } : {}) };
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
export async function listTournamentsAdmin(includeArchived = false) {
  await gate();
  return db.tournament.findMany({
    where: includeArchived ? {} : { archivedAt: null },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { teams: true, matches: true } } },
  });
}

/**
 * File a finished tournament away, or bring it back.
 *
 * Deliberately not a delete: the teams, fixtures, scores and money stay
 * exactly where they are, and the record is still reachable by URL. All
 * that changes is that it stops filling the admin list and disappears
 * from the public tournaments page — a venue that runs a cup every month
 * would otherwise scroll past a year of finished ones to reach the live
 * one. Fully reversible, so a mis-click costs nothing.
 */
export async function setTournamentArchived(
  id: string,
  archived = true,
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const t = await db.tournament.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!t) return { success: false, error: "Tournament not found" };
  // Archiving something still being played would pull it off the public
  // page mid-event, with teams looking for their fixtures.
  if (archived && ["REG_OPEN", "LIVE"].includes(t.status)) {
    return {
      success: false,
      error:
        t.status === "LIVE"
          ? "This tournament is live — complete it first"
          : "Registrations are open — close them first",
    };
  }
  await db.tournament.update({
    where: { id },
    data: { archivedAt: archived ? new Date() : null },
  });
  revalidatePath("/admin/tournaments");
  revalidatePath(`/admin/tournaments/${id}`);
  revalidatePath("/tournaments");
  return { success: true };
}

/**
 * Load an existing tournament as a prefilled wizard payload, for "Duplicate".
 *
 * Running the same cup again means retyping ~30 fields — format, pool maths,
 * squad sizes, fees, points, tiebreakers, stat fields and the whole prize
 * table — to change little more than the dates. This hands all of that back
 * as a TournamentWizardInput with no id, which the wizard already treats as
 * "prefill, then create" rather than "edit" (TournamentWizard branches to
 * createTournament when initial.id is absent). Duplication therefore needs no
 * new create path and cannot drift from the real one.
 *
 * What is and isn't copied — and why — lives with the mapper in
 * lib/tournament-duplicate.ts, which is pure so it can be tested. Note the
 * select is that module's DUPLICABLE_FIELDS: scorerCode is never read at all,
 * because this payload is serialised to the browser.
 */
export async function getTournamentForDuplicate(
  id: string,
): Promise<TournamentWizardInput | null> {
  await gate();
  const t = await db.tournament.findUnique({
    where: { id },
    select: DUPLICABLE_FIELDS,
  });
  return t ? duplicateWizardInput(t) : null;
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
      // Match windows, so the team dialog can turn a team's stored
      // `<slotId>#<hour>` picks back into readable days and hours.
      slots: {
        orderBy: [{ date: "asc" }, { startHour: "asc" }],
        include: { courtConfig: { select: { label: true } } },
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
      status: true,
      pointsUsed: true,
      paidAmount: true,
      discount: true,
      captainUserId: true,
      tournament: {
        select: { totalTeams: true, entryFee: true, feeMode: true, advancePct: true },
      },
    },
  });
  if (!team) return { success: false, error: "Team not found" };

  // Money follows the status. A WAITLISTED / PENDING_PAYMENT team is stored
  // owing nothing (it was never going to be charged), so promoting it to
  // CONFIRMED without recomputing what's due leaves an unpaid team that the
  // Collect button can't even be offered for — the entry fee is simply lost.
  const patch: Record<string, unknown> = { status };
  if (status === "CONFIRMED" && team.status !== "CONFIRMED") {
    const confirmed = await db.tournamentTeam.count({
      where: {
        tournamentId: team.tournamentId,
        status: "CONFIRMED",
        archivedAt: null,
      },
    });
    if (confirmed >= team.tournament.totalTeams) {
      return { success: false, error: "Tournament is already full" };
    }
    const netFee = Math.max(0, team.tournament.entryFee - team.discount);
    patch.dueAmount = Math.max(0, netFee - team.paidAmount);
  }
  // Kicking a team out returns its points (below). Strip the points leg
  // from `discount` at the same time, otherwise re-confirming the team
  // later would hand back the refunded points AND the discount they bought.
  if (status === "REJECTED" || status === "WITHDRAWN") {
    if (team.pointsUsed > 0) {
      const redemption = await db.rewardTransaction.findFirst({
        where: { type: "REDEEMED_TOURNAMENT", tournamentTeamId: teamId },
        select: { pointsValuePaise: true },
      });
      const pointsRupees = Math.round(Math.abs(redemption?.pointsValuePaise || 0) / 100);
      patch.discount = Math.max(0, team.discount - pointsRupees);
    }
    patch.pointsUsed = 0;
  }
  await db.tournamentTeam.update({ where: { id: teamId }, data: patch });
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
  // Whitelist the method. It used to be an unvalidated string written
  // straight onto the row, so a typo (or a crafted call) could park an
  // unknown method on the team and quietly break every report that groups
  // by it. FREE is not collectable — see lib/tournament-payments.ts.
  if (!(TEAM_COLLECT_METHODS as readonly string[]).includes(method)) {
    return { success: false, error: "Pick a valid payment method" };
  }
  const team = await db.tournamentTeam.findUnique({
    where: { id: teamId },
    select: { tournamentId: true, dueAmount: true, paidAt: true },
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
      // First money in stamps the cash-basis date; a later balance
      // collection keeps it, so revenue never hops months.
      ...(team.paidAt ? {} : { paidAt: new Date() }),
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
  /** Optional — an empty squad registers the captain solo; players can
   *  be added later from the roster editor. */
  members: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  /** ₹ collected at the venue right now (0 allowed — collect later). */
  collectedAmount: z.number().int().min(0).max(10_00_000),
  method: z.enum(TEAM_REGISTER_METHODS),
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
    where: {
      tournamentId: t.id,
      status: { in: ["CONFIRMED", "PENDING_PAYMENT"] },
      archivedAt: null,
    },
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
  const squad = d.members.length > 0 ? d.members : [d.captainName];
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
      // Stamp the cash-basis date only when money actually changed hands.
      // Registering with "collect later" leaves this null on purpose, so
      // the fee shows up as revenue on the day it is collected rather than
      // the day the team was entered. Without this, cash taken at the
      // counter during registration was recorded with no date at all and
      // never reached the analytics or the CA report, which key on paidAt.
      paidAt: paid > 0 ? new Date() : null,
      members: {
        create: squad.map((name, i) => ({ name, order: i, isCaptain: i === 0 })),
      },
    },
    select: { id: true },
  });
  revalidatePath(`/admin/tournaments/${t.id}`);
  return { success: true, teamId: team.id };
}

/** Admin-side edit of a team's identity/roster (moderation). Roster edits
 *  go through reconcileTeamSquad so members with recorded stats keep their
 *  rows (and their stats) instead of being wiped and recreated. */
export async function adminEditTeam(
  teamId: string,
  input: {
    name?: string;
    color?: string | null;
    logoUrl?: string | null;
    /** Bare names still accepted; {name, phone} rows carry contact numbers. */
    members?: (string | { name: string; phone?: string | null })[];
  }
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const team = await db.tournamentTeam.findUnique({
    where: { id: teamId },
    select: { tournamentId: true, tournament: { select: { membersPerTeamMax: true } } },
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

  if (Object.keys(data).length > 0) {
    await db.tournamentTeam.update({ where: { id: teamId }, data });
  }
  if (input.members) {
    const res = await reconcileTeamSquad(teamId, input.members, team.tournament.membersPerTeamMax);
    if (!res.ok) return { success: false, error: res.error };
  }
  revalidatePath(`/admin/tournaments/${team.tournamentId}`);
  return { success: true };
}

/** Rotate the scorer code — the ONLY way to revoke a shared/leaked code.
 *  Anyone still holding the old one loses access immediately. */
/**
 * Set a team's preferred hours on their behalf.
 *
 * Captains phone the venue with their availability far more often than
 * they open the app, and until now that could only be recorded by asking
 * them to do it themselves — a team with no picks reads to the draw
 * generator as "any window works", which quietly schedules them into
 * hours they cannot play.
 *
 * Unlike the captain's own save this is NOT blocked once the schedule is
 * approved: the customer-facing error tells them to contact the venue, so
 * the venue has to be able to act on that. The UI warns that fixtures
 * were already built on the old answers.
 */
export async function adminSetTeamSlotPreferences(
  teamId: string,
  slotKeys: string[],
): Promise<{ success: boolean; error?: string }> {
  await gate();
  if (!Array.isArray(slotKeys) || slotKeys.length > 500) {
    return { success: false, error: "Invalid selection" };
  }
  const team = await db.tournamentTeam.findUnique({
    where: { id: teamId },
    select: { id: true, tournamentId: true },
  });
  if (!team) return { success: false, error: "Team not found" };

  const valid = await filterValidSlotKeys(
    team.tournamentId,
    slotKeys.map((k) => String(k)),
  );
  await db.tournamentTeam.update({
    where: { id: team.id },
    data: { preferredSlotIds: valid },
  });
  revalidatePath(`/admin/tournaments/${team.tournamentId}`);
  return { success: true };
}

export async function rotateScorerCode(
  tournamentId: string
): Promise<{ success: boolean; error?: string; code?: string }> {
  await gate();
  const t = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, liveScoringEnabled: true },
  });
  if (!t) return { success: false, error: "Tournament not found" };
  if (!t.liveScoringEnabled) {
    return { success: false, error: "Live scoring is off for this tournament" };
  }
  const code = scorerCodeGen();
  await db.tournament.update({ where: { id: tournamentId }, data: { scorerCode: code } });
  revalidatePath(`/admin/tournaments/${tournamentId}`);
  return { success: true, code };
}


/**
 * Archive a team: it leaves the roster, the counts and the draw without
 * destroying its payment trail or match history.
 *
 * Deleting outright is reserved for teams that have neither money nor
 * results attached — anything else must stay auditable, because a team
 * that paid ₹2,800 and then vanished is indistinguishable from a
 * reconciliation error at month end.
 */
export async function archiveTournamentTeam(
  teamId: string,
  archived = true
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const team = await db.tournamentTeam.findUnique({
    where: { id: teamId },
    select: { tournamentId: true, poolId: true },
  });
  if (!team) return { success: false, error: "Team not found" };

  await db.tournamentTeam.update({
    where: { id: teamId },
    data: {
      archivedAt: archived ? new Date() : null,
      // An archived team can't sit in a pool — the draw would field a
      // side that isn't playing.
      ...(archived ? { poolId: null } : {}),
    },
  });
  revalidatePath(`/admin/tournaments/${team.tournamentId}`);
  return { success: true };
}

/**
 * Hard-delete a team. Refuses when there is money or match history on it
 * — archive those instead, so the audit trail survives.
 */
export async function deleteTournamentTeam(
  teamId: string
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const team = await db.tournamentTeam.findUnique({
    where: { id: teamId },
    select: {
      tournamentId: true,
      paidAmount: true,
      pointsUsed: true,
      _count: {
        select: {
          homeMatches: true,
          awayMatches: true,
          playerStats: true,
        },
      },
    },
  });
  if (!team) return { success: false, error: "Team not found" };

  if (team.paidAmount > 0 || team.pointsUsed > 0) {
    return {
      success: false,
      error:
        "This team has paid — archive it instead so the payment stays on the books.",
    };
  }
  const played =
    team._count.homeMatches + team._count.awayMatches + team._count.playerStats;
  if (played > 0) {
    return {
      success: false,
      error: "This team has fixtures or recorded stats — archive it instead.",
    };
  }

  await db.tournamentTeam.delete({ where: { id: teamId } });
  revalidatePath(`/admin/tournaments/${team.tournamentId}`);
  return { success: true };
}
