import { db } from "@/lib/db";
import { computeStandings, inningsFromLiveState, standingsConfig } from "@/lib/tournament-points";
import { parseBands, type Band } from "@/lib/pass-bands";

// Prize passes.
//
// A prize row on a tournament is display text ("₹5,100 + Trophy"). It may
// ALSO carry a pass, fully specified by the admin — which court, how many
// hours, how long it stays valid and which pricing bands it redeems on.
// When the tournament completes, that pass is minted to the winning team's
// CAPTAIN as a bespoke gift pass (no PassPlan behind it, everything
// snapshotted) — the same shape the at-venue gift flow already produces,
// so it shows up in My Passes and redeems at checkout with no special
// casing anywhere downstream.

/** Pass attached to a prize row. All of it is admin-chosen. */
export type PrizePass = {
  /** Finishing position this pass is awarded to: 1 = champion, 2 = runner-up… */
  awardTo: number;
  courtConfigId: string;
  totalHours: number;
  validityDays: number;
  /** Pricing bands it may be redeemed on. Empty = any slot. */
  bands?: Band[];
  /** Shown on the pass; falls back to the tournament + place. */
  name?: string;
};

export type PrizeRow = {
  place: string;
  label: string;
  pass?: PrizePass | null;
};

/** Narrow the free-form `prizes` JSON to rows we can reason about. */
export function parsePrizeRows(raw: unknown): PrizeRow[] {
  if (!Array.isArray(raw)) return [];
  const out: PrizeRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const row: PrizeRow = {
      place: typeof o.place === "string" ? o.place : "",
      label: typeof o.label === "string" ? o.label : "",
    };
    const p = o.pass as Record<string, unknown> | undefined | null;
    if (p && typeof p === "object" && typeof p.courtConfigId === "string") {
      const awardTo = Math.floor(Number(p.awardTo) || 0);
      const totalHours = Number(p.totalHours) || 0;
      const validityDays = Math.floor(Number(p.validityDays) || 0);
      if (awardTo >= 1 && totalHours > 0 && validityDays >= 1) {
        row.pass = {
          awardTo,
          courtConfigId: p.courtConfigId,
          totalHours,
          validityDays,
          bands: parseBands(Array.isArray(p.bands) ? (p.bands as Band[]) : []),
          name: typeof p.name === "string" ? p.name : undefined,
        };
      }
    }
    out.push(row);
  }
  return out;
}

export type Placement = { position: number; teamId: string; teamName: string; captainUserId: string | null };

/**
 * Final standings, 1st first.
 *
 * A bracket decides it: the FINAL gives 1st and 2nd, a 3rd-place match
 * gives 3rd. A pure LEAGUE has no final, so the points table decides.
 * Returns [] while the deciding match is still unplayed.
 */
export async function resolvePlacements(tournamentId: string): Promise<Placement[]> {
  const t = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      format: true,
      // sport + oversPerInnings drive the NRR tiebreaker for cricket, so
      // prize order matches the table the teams were looking at.
      sport: true,
      oversPerInnings: true,
      wicketsPerInnings: true,
      pointsWin: true,
      pointsDraw: true,
      pointsLoss: true,
      tiebreakers: true,
      teams: {
        where: { status: "CONFIRMED" },
        select: { id: true, name: true, captainUserId: true },
      },
      matches: {
        select: {
          stage: true,
          status: true,
          homeTeamId: true,
          awayTeamId: true,
          homeScore: true,
          awayScore: true,
          isDraw: true,
          winnerTeamId: true,
          liveState: true,
        },
      },
    },
  });
  if (!t) return [];
  const team = new Map(t.teams.map((x) => [x.id, x]));
  const at = (id: string | null, position: number): Placement | null => {
    const x = id ? team.get(id) : null;
    return x ? { position, teamId: x.id, teamName: x.name, captainUserId: x.captainUserId } : null;
  };

  const decided = (m: { status: string }) => m.status === "COMPLETED" || m.status === "WALKOVER";
  const final = t.matches.find((m) => m.stage === "FINAL" && decided(m) && m.winnerTeamId);
  const out: Placement[] = [];
  if (final) {
    const loser = final.winnerTeamId === final.homeTeamId ? final.awayTeamId : final.homeTeamId;
    const first = at(final.winnerTeamId, 1);
    const second = at(loser, 2);
    if (first) out.push(first);
    if (second) out.push(second);
    const third = t.matches.find((m) => m.stage === "THIRD_PLACE" && decided(m) && m.winnerTeamId);
    if (third) {
      const p = at(third.winnerTeamId, 3);
      if (p) out.push(p);
    }
    return out;
  }

  // LEAGUE (or any format with no final): the table is the result.
  if (t.format === "LEAGUE") {
    const completed = t.matches
      .filter((m) => decided(m) && m.homeTeamId && m.awayTeamId && m.homeScore != null && m.awayScore != null)
      .map((m) => ({
        homeTeamId: m.homeTeamId!,
        awayTeamId: m.awayTeamId!,
        homeScore: m.homeScore!,
        awayScore: m.awayScore!,
        isDraw: m.isDraw,
        winnerTeamId: m.winnerTeamId,
        // Prize money follows the same order the table showed.
        innings:
          t.sport === "CRICKET" ? inningsFromLiveState(m.liveState) : undefined,
      }));
    if (completed.length === 0) return [];
    const standings = computeStandings(
      t.teams.map((x) => x.id),
      completed,
      standingsConfig(t),
      new Map(t.teams.map((x) => [x.id, x.name]))
    );
    standings.forEach((s, i) => {
      const p = at(s.teamId, i + 1);
      if (p) out.push(p);
    });
  }
  return out;
}

export type PrizePassResult = {
  issued: { position: number; teamName: string; userPassId: string }[];
  skipped: { position: number; reason: string }[];
};

/**
 * Mint every configured prize pass to the right captain.
 *
 * Idempotent: each pass is stamped with `tournament:<id>:place:<n>` in
 * offlineRef and we refuse to mint a second one for the same slot, so a
 * re-run (or a re-completion after a correction) can't double-award.
 */
export async function issuePrizePasses(
  tournamentId: string,
  adminId: string | null
): Promise<PrizePassResult> {
  const result: PrizePassResult = { issued: [], skipped: [] };
  const t = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: { name: true, prizes: true },
  });
  if (!t) return result;

  const rows = parsePrizeRows(t.prizes).filter((r) => r.pass);
  if (rows.length === 0) return result;

  const places = await resolvePlacements(tournamentId);
  if (places.length === 0) {
    for (const r of rows) {
      result.skipped.push({ position: r.pass!.awardTo, reason: "no result yet" });
    }
    return result;
  }

  for (const row of rows) {
    const pass = row.pass!;
    const place = places.find((p) => p.position === pass.awardTo);
    if (!place) {
      result.skipped.push({ position: pass.awardTo, reason: "no team in that position" });
      continue;
    }
    if (!place.captainUserId) {
      result.skipped.push({
        position: pass.awardTo,
        reason: `${place.teamName} has no linked captain account`,
      });
      continue;
    }
    const marker = `tournament:${tournamentId}:place:${pass.awardTo}`;
    const already = await db.userPass.findFirst({ where: { offlineRef: marker }, select: { id: true } });
    if (already) {
      result.skipped.push({ position: pass.awardTo, reason: "already issued" });
      continue;
    }
    const config = await db.courtConfig.findUnique({
      where: { id: pass.courtConfigId },
      select: { id: true, sport: true, label: true, isActive: true },
    });
    if (!config || !config.isActive) {
      result.skipped.push({ position: pass.awardTo, reason: "court config missing or inactive" });
      continue;
    }

    const totalMinutes = Math.round(pass.totalHours * 60);
    const startsAt = new Date();
    const created = await db.userPass.create({
      data: {
        planId: null, // bespoke prize pass — no public plan behind it
        userId: place.captainUserId,
        name: pass.name?.trim() || `${t.name} — ${row.place || `Place ${pass.awardTo}`} Pass`,
        sport: config.sport,
        courtConfigId: config.id,
        totalMinutes,
        price: 0,
        validityDays: pass.validityDays,
        remainingMinutes: totalMinutes,
        startsAt,
        expiresAt: new Date(startsAt.getTime() + pass.validityDays * 24 * 60 * 60 * 1000),
        bands: (parseBands(pass.bands ?? []) as never) ?? undefined,
        anchorPrice: null,
        paymentMethod: "FREE",
        issuedByAdminId: adminId,
        offlineRef: marker,
      },
      select: { id: true },
    });
    result.issued.push({ position: pass.awardTo, teamName: place.teamName, userPassId: created.id });
  }
  return result;
}
