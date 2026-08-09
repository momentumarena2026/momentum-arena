/**
 * Mirror of `poolQualifierLabel` in the web app's lib/tournament-fixtures.ts.
 *
 * The app is a separate package and cannot import from there, and this is
 * the string the fixture generator stamps onto a knockout slot's
 * sourceLabel — the bracket matches on it to work out which tie a pool
 * feeds. If the web one changes and this doesn't, the app simply stops
 * finding a destination and falls back to "seeded overall", which is a
 * quiet degradation rather than a wrong answer.
 */
export function poolQualifierLabel(poolName: string, rank: number): string {
  if (rank === 1) return `Winner ${poolName}`;
  if (rank === 2) return `Runner-up ${poolName}`;
  return `${poolName} #${rank}`;
}
