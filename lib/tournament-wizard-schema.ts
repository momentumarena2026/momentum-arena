import { z } from "zod";

/**
 * The create/update contract for a tournament, and the single source of
 * truth for what a valid wizard payload looks like.
 *
 * Extracted out of actions/admin-tournaments.ts (which is "use server" and
 * pulls next/cache and the auth stack) so it can be imported by a plain Node
 * test runner. That matters because the Duplicate feature builds a payload
 * programmatically rather than from a form: if the mapper ever emits
 * something this schema rejects, the admin sees a validation error on a field
 * they never touched. tests/tournament-duplicate.test.ts asserts a duplicate
 * always satisfies exactly this schema.
 */
export const statFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/^[a-z0-9_]+$/, "Stat keys: lowercase letters/numbers/underscore"),
  label: z.string().trim().min(1).max(40),
});

/** Optional pass awarded with a prize, minted to the captain on completion. */
export const prizePassSchema = z.object({
  awardTo: z.number().int().min(1).max(16),
  courtConfigId: z.string().min(1),
  totalHours: z.number().min(0.5).max(200),
  validityDays: z.number().int().min(1).max(365),
  bands: z
    .array(
      z.object({
        dayType: z.enum(["WEEKDAY", "WEEKEND"]),
        timeType: z.enum(["PEAK", "OFF_PEAK"]),
      })
    )
    .max(4)
    .optional(),
  name: z.string().trim().max(80).optional(),
});

export const prizeSchema = z.object({
  place: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(160),
  pass: prizePassSchema.nullable().optional(),
});

export const wizardSchema = z.object({
  name: z.string().trim().min(3, "Name is required").max(80),
  sport: z.enum(["CRICKET", "FOOTBALL", "PICKLEBALL"]),
  format: z.enum(["LEAGUE", "KNOCKOUT", "POOLS_KNOCKOUT"]),
  description: z.string().trim().max(2000).optional(),
  // Raised from 20k with the move to rich text: the same rules carry
  // markup now, so the old ceiling would reject a document that was
  // comfortably under it as plain text.
  rules: z.string().trim().max(60000).optional(),
  bannerImageUrl: z.string().trim().max(500).optional(),

  totalTeams: z.number().int().min(2).max(128),
  poolCount: z.number().int().min(0).max(16),
  teamsPerPool: z.number().int().min(0).max(32),
  advancePerPool: z.number().int().min(0).max(16),
  thirdPlaceMatch: z.boolean(),
  membersPerTeamMin: z.number().int().min(1).max(50),
  membersPerTeamMax: z.number().int().min(1).max(50),
  /** Cricket over quota per bowler. 0 = unlimited. */
  maxOversPerBowler: z.number().int().min(0).max(50).optional(),
  oversPerInnings: z.number().int().min(0).max(90).optional(),
  // 1..10. Zero would mean a side is all out before facing a ball.
  wicketsPerInnings: z.number().int().min(1).max(10).optional(),
  bracketSeeding: z.enum(["POOL_ORDER", "OVERALL_RANK"]).optional(),

  host: z.enum(["VENUE", "THIRD_PARTY"]).optional(),
  organizerName: z.string().trim().max(120).optional(),
  organizerPhone: z.string().trim().max(20).optional(),
  organizerEmail: z.string().trim().max(160).optional(),
  quotedAmount: z.number().int().min(0).max(1_00_00_000).optional(),
  organizerNote: z.string().trim().max(1000).optional(),

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
  // NRR is accepted for every sport so the key round-trips, but it only
  // resolves to anything for cricket — elsewhere no innings are recorded,
  // every row is null, and the chain falls through to the next key.
  tiebreakers: z
    .array(z.enum(["NRR", "H2H", "SCORE_DIFF", "SCORE_FOR", "NAME"]))
    .min(1),

  statFields: z.array(statFieldSchema).max(12),
  prizePool: z.number().int().min(0).max(1_00_00_000).nullable(),
  prizes: z.array(prizeSchema).max(12),

  liveScoringEnabled: z.boolean(),
  liveScreenPlatform: z.enum(["BOTH", "APP_ONLY", "WEB_ONLY", "OFF"]),
});

export type TournamentWizardInput = z.infer<typeof wizardSchema>;
