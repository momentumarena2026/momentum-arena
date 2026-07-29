// Pure fixture-generation logic for the tournament engine. No DB access —
// admin actions feed teams/pools in and persist the returned skeletons.

export type PairingRound<T> = { round: number; pairs: [T, T][] };

/** Circle-method round robin. Every team meets every other exactly once;
 *  rounds are balanced so no team plays twice in a round. */
export function roundRobinRounds<T>(teams: T[]): PairingRound<T>[] {
  const list: (T | null)[] = [...teams];
  if (list.length < 2) return [];
  if (list.length % 2 === 1) list.push(null); // bye slot
  const n = list.length;
  const rounds: PairingRound<T>[] = [];
  const arr = [...list];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [T, T][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== null && b !== null) pairs.push([a, b]);
    }
    rounds.push({ round: r + 1, pairs });
    // rotate all but the first element
    arr.splice(1, 0, arr.pop()!);
  }
  return rounds;
}

export type BracketSlot =
  | { kind: "team"; teamId: string; label: string }
  | { kind: "pool"; poolName: string; rank: number; label: string }
  | { kind: "winner"; matchIndex: number; label: string } // index into the flat skeleton
  | { kind: "loser"; matchIndex: number; label: string }
  | { kind: "bye" };

export type SkeletonMatch = {
  stage: "R16" | "QF" | "SF" | "FINAL" | "THIRD_PLACE";
  roundLabel: string;
  sequence: number;
  home: BracketSlot;
  away: BracketSlot;
};

function stageForSize(size: number): "R16" | "QF" | "SF" | "FINAL" {
  if (size >= 16) return "R16";
  if (size === 8) return "QF";
  if (size === 4) return "SF";
  return "FINAL";
}

const STAGE_MATCH_NAMES: Record<string, string> = {
  R16: "Round of 16",
  QF: "Quarter Final",
  SF: "Semi Final",
  FINAL: "Final",
  THIRD_PLACE: "3rd Place",
};

/** Standard bracket seed order for a bracket of `size` (power of 2):
 *  positions such that seed 1 and 2 can only meet in the final.
 *  Returns the seed number (1-based) at each bracket position. */
export function bracketSeedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next: number[] = [];
    const m = order.length * 2 + 1;
    for (const s of order) {
      next.push(s, m - s);
    }
    order = next;
  }
  return order;
}

/** Build a knockout skeleton for `entrants` (seed order = array order).
 *  Entrants may be team slots or pool-rank slots. Byes auto-inserted when
 *  entrants aren't a power of 2 — bye opponents auto-advance (resolved by
 *  the caller when persisting: a match with a bye side collapses forward). */
export function buildKnockoutSkeleton(
  entrants: BracketSlot[],
  thirdPlaceMatch: boolean
): SkeletonMatch[] {
  const n = entrants.length;
  if (n < 2) return [];
  let size = 2;
  while (size < n) size *= 2;

  const seedAt = bracketSeedOrder(size);
  const slots: BracketSlot[] = seedAt.map((seed) =>
    seed <= n ? entrants[seed - 1] : { kind: "bye" }
  );

  const matches: SkeletonMatch[] = [];
  // First round from the seeded slots.
  let currentRound: { home: BracketSlot; away: BracketSlot; index: number }[] = [];
  const firstStage = stageForSize(size);
  for (let i = 0; i < size / 2; i++) {
    const home = slots[i * 2];
    const away = slots[i * 2 + 1];
    const index = matches.length;
    matches.push({
      stage: firstStage,
      roundLabel: size === 2 ? STAGE_MATCH_NAMES.FINAL : `${STAGE_MATCH_NAMES[firstStage]} ${i + 1}`,
      sequence: i + 1,
      home,
      away,
    });
    currentRound.push({ home, away, index });
  }

  // Subsequent rounds chained by winner-of links.
  let roundSize = size / 2;
  while (roundSize >= 2) {
    const stage = stageForSize(roundSize);
    if (roundSize === 1) break;
    const nextRound: { home: BracketSlot; away: BracketSlot; index: number }[] = [];
    if (currentRound.length === 1) break; // final already emitted
    for (let i = 0; i < currentRound.length / 2; i++) {
      const a = currentRound[i * 2];
      const b = currentRound[i * 2 + 1];
      const index = matches.length;
      const isFinal = currentRound.length === 2;
      const home: BracketSlot = {
        kind: "winner",
        matchIndex: a.index,
        label: `Winner ${matches[a.index].roundLabel}`,
      };
      const away: BracketSlot = {
        kind: "winner",
        matchIndex: b.index,
        label: `Winner ${matches[b.index].roundLabel}`,
      };
      matches.push({
        stage: isFinal ? "FINAL" : stage,
        roundLabel: isFinal ? STAGE_MATCH_NAMES.FINAL : `${STAGE_MATCH_NAMES[stage]} ${i + 1}`,
        sequence: i + 1,
        home,
        away,
      });
      nextRound.push({ home, away, index });
    }
    if (nextRound.length === 1 && thirdPlaceMatch) {
      // 3rd place: losers of the two semi-final-level matches.
      const finalMatch = nextRound[0];
      const semiA = currentRound[0];
      const semiB = currentRound[1];
      matches.push({
        stage: "THIRD_PLACE",
        roundLabel: STAGE_MATCH_NAMES.THIRD_PLACE,
        sequence: 1,
        home: { kind: "loser", matchIndex: semiA.index, label: `Loser ${matches[semiA.index].roundLabel}` },
        away: { kind: "loser", matchIndex: semiB.index, label: `Loser ${matches[semiB.index].roundLabel}` },
      });
      void finalMatch;
    }
    currentRound = nextRound;
    roundSize = roundSize / 2;
  }

  return matches;
}

/**
 * Entrant slots for a pools→knockout bracket, in seed order.
 *
 * POOL_ORDER   A1, B1, …, A2, B2, … — the pool's letter fixes the seed, so
 *              same-pool teams stay apart. Simple, but Pool A's winner
 *              always takes seed 1 and with it any first-round bye.
 * OVERALL_RANK "Seed #1…#n" — placeholders resolved once every pool is
 *              done, by ranking the qualifiers against each other on their
 *              pool record. Use this when the bracket is uneven (e.g. 3
 *              qualifiers, where seed 1 goes straight to the final) and the
 *              bye has to be earned rather than handed to a pool letter.
 */
export function poolQualifierSlots(
  poolNames: string[],
  advancePerPool: number,
  seeding: "POOL_ORDER" | "OVERALL_RANK" = "POOL_ORDER"
): BracketSlot[] {
  const out: BracketSlot[] = [];
  if (seeding === "OVERALL_RANK") {
    const total = poolNames.length * advancePerPool;
    for (let n = 1; n <= total; n++) {
      out.push({ kind: "pool", poolName: "", rank: n, label: `Seed #${n}` });
    }
    return out;
  }
  for (let rank = 1; rank <= advancePerPool; rank++) {
    for (const pool of poolNames) {
      out.push({
        kind: "pool",
        poolName: pool,
        rank,
        label: rank === 1 ? `Winner ${pool}` : rank === 2 ? `Runner-up ${pool}` : `${pool} #${rank}`,
      });
    }
  }
  return out;
}

/** Fisher-Yates shuffle (used for the random pool draw). */
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
