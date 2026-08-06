/**
 * Stage constants for hand-entered fixtures.
 *
 * Deliberately its own module rather than living in
 * actions/admin-tournament-manual-fixtures.ts: that file is "use server",
 * and such a module may only export async functions. Exporting the array
 * from there broke the production build.
 *
 * Named -manual-stages, NOT -fixtures: lib/tournament-fixtures.ts already
 * exists and holds the draw maths (roundRobinRounds, buildKnockoutSkeleton,
 * poolQualifierSlots, shuffle).
 */

/** Stages a hand-entered fixture may use. Mirrors TournamentMatchStage. */
export const MANUAL_STAGES = [
  "LEAGUE",
  "POOL",
  "R16",
  "QF",
  "SF",
  "THIRD_PLACE",
  "FINAL",
] as const;

export type ManualStage = (typeof MANUAL_STAGES)[number];

export const MANUAL_STAGE_LABEL: Record<string, string> = {
  LEAGUE: "League",
  POOL: "Pool",
  R16: "Round of 16",
  QF: "Quarter-final",
  SF: "Semi-final",
  THIRD_PLACE: "Third place",
  FINAL: "Final",
};
