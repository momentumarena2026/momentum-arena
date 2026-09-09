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

  /**
   * What feeds the next round, one entry per bracket position.
   *
   * A bye does NOT produce a match. It used to: the generator wrote a real
   * "Team vs BYE" fixture and the round after it pointed at that fixture's
   * winner. Nobody plays such a match, so an organiser looking at the
   * fixture list deletes it — and the round after is then permanently
   * unresolvable, because its source match no longer exists. That is
   * exactly how a live cup ended up with a Final reading "Winner Semi
   * Final 1" against a semi-final that wasn't there, and no way to start
   * scoring it.
   *
   * So a bye carries its opponent's slot straight through. With three
   * qualifiers the Final's home side becomes "Winner Pool A" — a label
   * that resolves off the pool table the moment the pools finish, with no
   * phantom fixture in between and nothing to delete.
   */
  let feeders: BracketSlot[] = [];
  // Indices of the matches this round emitted, so the round that leaves two
  // sides standing can be identified as the semi-finals wherever it occurs.
  let roundIndices: number[] = [];
  const firstStage = stageForSize(size);
  for (let i = 0; i < size / 2; i++) {
    const home = slots[i * 2];
    const away = slots[i * 2 + 1];
    if (home.kind === "bye" && away.kind === "bye") {
      feeders.push({ kind: "bye" });
      continue;
    }
    if (home.kind === "bye") {
      feeders.push(away);
      continue;
    }
    if (away.kind === "bye") {
      feeders.push(home);
      continue;
    }
    // Numbered by the matches actually played, not by bracket position —
    // a skipped bye must not leave a gap ("Semi Final 2" with no 1").
    const played = matches.length + 1;
    const roundLabel =
      size === 2 ? STAGE_MATCH_NAMES.FINAL : `${STAGE_MATCH_NAMES[firstStage]} ${played}`;
    const index = matches.length;
    matches.push({
      stage: firstStage,
      roundLabel,
      sequence: played,
      home,
      away,
    });
    roundIndices.push(index);
    feeders.push({ kind: "winner", matchIndex: index, label: `Winner ${roundLabel}` });
  }

  // Later rounds: pair the feeders, carrying byes forward the same way.
  // `semiIndices` remembers the round that produced the Final's two sides,
  // so a third-place play-off can be built from their losers. A four-team
  // bracket reaches that state in the FIRST round, which is why this is
  // seeded here and not only inside the loop below.
  let semiIndices: number[] = feeders.length === 2 ? roundIndices : [];
  while (feeders.length > 1) {
    const stage = stageForSize(feeders.length);
    const isFinal = feeders.length === 2;
    const next: BracketSlot[] = [];
    roundIndices = [];
    for (let i = 0; i < feeders.length; i += 2) {
      const a = feeders[i];
      const b = feeders[i + 1];
      // Odd count, or a bye on either side: carry the real side forward.
      if (!b) { next.push(a); continue; }
      if (a.kind === "bye") { next.push(b); continue; }
      if (b.kind === "bye") { next.push(a); continue; }
      const index = matches.length;
      const roundLabel = isFinal
        ? STAGE_MATCH_NAMES.FINAL
        : `${STAGE_MATCH_NAMES[stage]} ${roundIndices.length + 1}`;
      matches.push({
        stage: isFinal ? "FINAL" : stage,
        roundLabel,
        sequence: roundIndices.length + 1,
        home: a,
        away: b,
      });
      roundIndices.push(index);
      next.push({ kind: "winner", matchIndex: index, label: `Winner ${roundLabel}` });
    }
    // The round that leaves exactly two sides standing is the semi-final
    // round, whatever it happens to be called in an uneven bracket.
    if (next.length === 2) semiIndices = roundIndices;
    if (next.length === feeders.length) break; // nothing paired; avoid looping
    feeders = next;
  }

  // Third place: the two beaten semi-finalists. Only when both semi-finals
  // were really played — with a bye there may be just one, and a play-off
  // needs two losers to exist.
  if (thirdPlaceMatch && semiIndices.length === 2) {
    matches.push({
      stage: "THIRD_PLACE",
      roundLabel: STAGE_MATCH_NAMES.THIRD_PLACE,
      sequence: 1,
      home: {
        kind: "loser",
        matchIndex: semiIndices[0],
        label: `Loser ${matches[semiIndices[0]].roundLabel}`,
      },
      away: {
        kind: "loser",
        matchIndex: semiIndices[1],
        label: `Loser ${matches[semiIndices[1]].roundLabel}`,
      },
    });
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
/**
 * What a pool's Nth-placed team is called on the bracket.
 *
 * The generator stamps this onto the knockout slot's sourceLabel, and the
 * bracket matches on it to draw the line from pool to tie — so both sides
 * have to read it from here or the link silently stops resolving.
 */
export function poolQualifierLabel(poolName: string, rank: number): string {
  if (rank === 1) return `Winner ${poolName}`;
  if (rank === 2) return `Runner-up ${poolName}`;
  return `${poolName} #${rank}`;
}

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
        label: poolQualifierLabel(pool, rank),
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

/**
 * Renumber "Match N" labels to match the order fixtures are listed in.
 *
 * `sequence` and `roundLabel` are written together when a draw is
 * generated and then drift apart, because everything that changes the
 * order afterwards touched only `sequence`. A dragged pool read
 * "Match 2, Match 1, Match 3" down the screen, and deleting the middle
 * fixture of three left "Match 1, Match 3".
 *
 * That matters more than it looks: the number is the only thing an
 * organiser calls a fixture by — over the PA, on a printed sheet, to a
 * captain — so a list whose numbers do not count upwards is worse than
 * one with no numbers at all.
 *
 * Pure so it can be tested without a draw, a database or a clock. Takes
 * rows ALREADY in display order and returns only the ones whose label
 * needs to change.
 */
export function renumberedLabels(
  rows: { id: string; roundLabel: string | null; poolName: string | null }[],
): { id: string; roundLabel: string }[] {
  const seen = new Map<string, number>();
  const out: { id: string; roundLabel: string }[] = [];

  for (const row of rows) {
    // Only rewrite labels that ARE a match number. Knockout rounds carry
    // names — "Semi Final 1", "Final", "3rd Place" — which are already
    // positional and must never become "Match 1".
    if (!/(^|·\s*)Match\s+\d+\s*$/i.test(row.roundLabel ?? "")) continue;

    // Numbered PER POOL, not per stage. Pool matches from different
    // pools interleave in the list because it is ordered by play order,
    // and numbering across the whole stage would produce
    // "Pool B · Match 7" in a pool that has three.
    const key = row.poolName ?? "";
    const next = (seen.get(key) ?? 0) + 1;
    seen.set(key, next);

    const label = row.poolName ? `${row.poolName} · Match ${next}` : `Match ${next}`;
    // Skip rows already correct: a no-op write per fixture on every
    // delete adds up on a 40-match draw, for nothing.
    if (label !== row.roundLabel) out.push({ id: row.id, roundLabel: label });
  }
  return out;
}

/** The parts of a fixture that decide whether its slot may be exchanged. */
export type SwapCandidate = {
  id: string;
  tournamentId: string;
  roundLabel: string | null;
  status: string;
  courtConfigId: string | null;
  scheduledAt: Date | null;
  homeScore: number | null;
  awayScore: number | null;
};

/**
 * Why these two fixtures cannot exchange slots — or null if they can.
 *
 * Captains negotiate this between themselves once the draw is out ("we
 * can't field a side at 7am, they'll take the morning and give us their
 * evening"), and the organiser is only recording an agreement that has
 * already been reached. So the checks here are about whether the MOVE is
 * coherent, not about whether it is a good idea.
 *
 * Kept separate from the write so the rules can be asserted directly and
 * so the button can be disabled with the same sentence the server would
 * have answered with — a swap refused only on submit is a swap the
 * organiser argues with in front of two captains.
 */
export function swapBlocker(a: SwapCandidate, b: SwapCandidate): string | null {
  if (a.id === b.id) return "Pick two different fixtures";
  // Across tournaments the exchange would move one event's held hours
  // onto another's calendar, and each block records a sourceId that would
  // then name the wrong owner.
  if (a.tournamentId !== b.tournamentId) {
    return "Both fixtures must be in the same tournament";
  }
  for (const m of [a, b]) {
    if (!m.courtConfigId || !m.scheduledAt) {
      return "Both fixtures must already have a slot — schedule them first";
    }
    // A match that has started or finished cannot move: its hours are
    // spent, and a played result filed against a future slot is a record
    // nobody can reconcile afterwards.
    if (m.status === "LIVE" || m.status === "COMPLETED" || m.status === "WALKOVER") {
      return `Can't move ${m.roundLabel || "a fixture"} — it is ${m.status.toLowerCase()}`;
    }
    if (m.homeScore != null || m.awayScore != null) {
      return `${m.roundLabel || "A fixture"} has a score — clear it first`;
    }
  }
  return null;
}
