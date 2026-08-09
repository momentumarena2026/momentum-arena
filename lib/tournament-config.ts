// Shared tournament domain helpers — used by admin actions, customer pages,
// the points engine and the live-scoring engines. No server-only imports so
// client components can use the pure helpers too.

import type { Tournament, TournamentFeeMode } from "@prisma/client";

// ── Status flow ─────────────────────────────────────────────────────
// Admin-triggered lifecycle. Each transition is validated server-side;
// campaign milestones hang off these transitions (P8).
export const STATUS_FLOW: Record<string, string[]> = {
  DRAFT: ["PUBLISHED", "CANCELLED"],
  PUBLISHED: ["REG_OPEN", "CANCELLED"],
  REG_OPEN: ["REG_CLOSED", "CANCELLED"],
  // Reopening is first because it is the one an admin reaches for in a
  // hurry: a couple more teams turn up after the deadline and the event
  // has room. Nothing about closing is destructive, so going back is
  // just a status flip (plus clearing the stale deadline — see
  // transitionTournament).
  REG_CLOSED: ["REG_OPEN", "POOLS_REVEALED", "LIVE", "CANCELLED"], // LIVE directly for LEAGUE/KNOCKOUT
  POOLS_REVEALED: ["LIVE", "CANCELLED"],
  LIVE: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  // Cancelling is a pure status flip — no refunds, no deletions, no
  // slot-block cleanup, and no campaign fires — so it is fully
  // reversible and an admin who mis-clicks must not lose a tournament.
  // Every pre-completion state is offered so it can go back exactly
  // where it was rather than restarting from DRAFT.
  CANCELLED: ["DRAFT", "PUBLISHED", "REG_OPEN", "REG_CLOSED", "POOLS_REVEALED", "LIVE"],
};

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  REG_OPEN: "Registrations Open",
  REG_CLOSED: "Registrations Closed",
  POOLS_REVEALED: "Pools Revealed",
  LIVE: "Live",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

// ── Fees ────────────────────────────────────────────────────────────
/** Amount (₹) payable ONLINE at registration for a tournament's fee config. */
export function onlinePayable(
  entryFee: number,
  feeMode: TournamentFeeMode,
  advancePct: number
): number {
  if (feeMode === "FREE" || entryFee <= 0) return 0;
  if (feeMode === "ADVANCE") {
    return Math.max(1, Math.round((entryFee * advancePct) / 100));
  }
  return entryFee;
}

// ── Stat fields ─────────────────────────────────────────────────────
export type StatField = { key: string; label: string };

/** Sensible per-sport defaults the wizard pre-fills (admin can edit freely). */
export const DEFAULT_STAT_FIELDS: Record<string, StatField[]> = {
  CRICKET: [
    { key: "runs", label: "Runs" },
    { key: "wickets", label: "Wickets" },
  ],
  FOOTBALL: [
    { key: "goals", label: "Goals" },
    { key: "assists", label: "Assists" },
  ],
  PICKLEBALL: [{ key: "points", label: "Points Won" }],
};

export function parseStatFields(raw: unknown): StatField[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (f): f is StatField =>
        !!f && typeof f === "object" && typeof (f as StatField).key === "string" && typeof (f as StatField).label === "string"
    )
    .map((f) => ({ key: f.key, label: f.label }));
}

// ── Prizes ──────────────────────────────────────────────────────────
export type PrizeRow = { place: string; label: string };

export function parsePrizes(raw: unknown): PrizeRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (p): p is PrizeRow =>
        !!p && typeof p === "object" && typeof (p as PrizeRow).place === "string" && typeof (p as PrizeRow).label === "string"
    )
    .map((p) => ({ place: p.place, label: p.label }));
}

// ── Slug ────────────────────────────────────────────────────────────
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ── Structure sanity ────────────────────────────────────────────────
/** Human-readable structural problems for the current config (wizard warns). */
export function structureWarnings(t: {
  format: string;
  totalTeams: number;
  poolCount: number;
  teamsPerPool: number;
  advancePerPool: number;
  sport?: string;
  oversPerInnings?: number;
  maxOversPerBowler?: number;
  membersPerTeamMax?: number;
}): string[] {
  const w: string[] = [];
  // Cricket: can the fielding side actually bowl the innings out?
  // Capacity is squad × quota, but nobody may bowl two overs in a row, so
  // when capacity EQUALS the innings there is no slack at all — every
  // bowler must bowl their full quota in a perfect rotation. One player
  // short, or one over out of order, and the last over has nobody legal
  // left to bowl it. (Seen for real: 5 bowlers × 2 stranded a 10-over
  // innings at 9.0.)
  const overs = t.oversPerInnings ?? 0;
  const quota = t.maxOversPerBowler ?? 0;
  const squad = t.membersPerTeamMax ?? 0;
  if (t.sport === "CRICKET" && overs > 0 && quota > 0 && squad > 0) {
    const capacity = quota * squad;
    if (capacity < overs) {
      w.push(
        `A full squad can only bowl ${capacity} overs (${squad} × ${quota}) — short of the ${overs}-over innings.`
      );
    } else if (capacity === overs) {
      w.push(
        `${squad} bowlers × ${quota} overs is exactly ${overs} — no slack. Every bowler must bowl their full quota, and since none may bowl two overs in a row, one absentee or a mis-ordered rotation strands the last over.`
      );
    }
  }
  if (t.format === "POOLS_KNOCKOUT") {
    if (t.poolCount < 2) w.push("Pools format needs at least 2 pools.");
    if (t.poolCount * t.teamsPerPool !== t.totalTeams)
      w.push(
        `Pools × teams-per-pool (${t.poolCount}×${t.teamsPerPool}) must equal total teams (${t.totalTeams}).`
      );
    const qualifiers = t.poolCount * t.advancePerPool;
    if (qualifiers < 2) w.push("At least 2 teams must qualify from pools.");
    else if ((qualifiers & (qualifiers - 1)) !== 0)
      w.push(
        `Qualifiers (${qualifiers}) is not a power of 2 — the bracket will need byes.`
      );
  }
  if (t.format === "KNOCKOUT") {
    if (t.totalTeams < 2) w.push("Knockout needs at least 2 teams.");
    else if ((t.totalTeams & (t.totalTeams - 1)) !== 0)
      w.push(`Total teams (${t.totalTeams}) is not a power of 2 — the bracket will need byes.`);
  }
  if (t.format === "LEAGUE" && t.totalTeams < 2) w.push("League needs at least 2 teams.");
  return w;
}

/** Confirmed-team count gates for actions like the draw. */
export function tournamentIsPools(t: Pick<Tournament, "format">): boolean {
  return t.format === "POOLS_KNOCKOUT";
}

export function scorerCodeGen(): string {
  // 10-char uppercase code from an unambiguous alphabet (~49 bits).
  // This code IS the scorer's credential, so it comes from the CSPRNG —
  // Math.random() is a predictable PRNG and never acceptable for a secret.
  // Web Crypto (global in Node 18+ and the browser) keeps this file free of
  // server-only imports, as the header note requires.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}

/**
 * Statuses at which POOL-stage matches are public.
 *
 * Before the reveal the fixtures ARE the draw, so the public payload
 * strips pool matches (see app/api/tournaments/[slug]/public/route.ts).
 * The consequence is easy to miss: a scorer can be scoring a pool match
 * live while every spectator sees nothing, with no error anywhere. The
 * admin page warns on exactly this condition, so both sides read the
 * rule from here rather than each keeping a copy that can drift.
 */
export const POOL_MATCHES_PUBLIC_STATUSES = [
  "POOLS_REVEALED",
  "LIVE",
  "COMPLETED",
] as const;

export function poolMatchesArePublic(status: string): boolean {
  return (POOL_MATCHES_PUBLIC_STATUSES as readonly string[]).includes(status);
}
