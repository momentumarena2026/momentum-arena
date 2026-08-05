/**
 * Pre-decided match windows, team preferences, and the draw generator.
 *
 * The venue runs ONE tournament match at a time, so a window's capacity
 * is simply its length divided by the tournament's match duration. A
 * "Sat 6-10am" window with 60-minute matches yields four match slots.
 *
 * Semi-finals and the final deliberately do NOT draw from these windows
 * — they're scheduled by hand once the pool stage has produced names.
 */

export interface SlotWindow {
  id: string;
  date: Date;
  startHour: number;
  /** Exclusive. */
  endHour: number;
  label: string | null;
  courtConfigId: string | null;
}

/** One concrete playable time carved out of a window. */
export interface MatchSlot {
  slotId: string;
  date: Date;
  startHour: number;
  startMinute: number;
  /** Minutes from midnight — the ordering key across days. */
  absoluteMinutes: number;
}

/** Divide each window into back-to-back match slots, in time order. */
export function expandSlots(
  windows: SlotWindow[],
  matchDurationMinutes: number,
): MatchSlot[] {
  const dur = Math.max(15, matchDurationMinutes);
  const out: MatchSlot[] = [];
  for (const w of windows) {
    const windowMinutes = (w.endHour - w.startHour) * 60;
    const count = Math.floor(windowMinutes / dur);
    for (let i = 0; i < count; i++) {
      const offset = i * dur;
      const startHour = w.startHour + Math.floor(offset / 60);
      const startMinute = offset % 60;
      out.push({
        slotId: w.id,
        date: w.date,
        startHour,
        startMinute,
        absoluteMinutes:
          Math.floor(w.date.getTime() / 60000) + startHour * 60 + startMinute,
      });
    }
  }
  return out.sort((a, b) => a.absoluteMinutes - b.absoluteMinutes);
}

/** Total matches the configured windows can hold. */
export function totalCapacity(
  windows: SlotWindow[],
  matchDurationMinutes: number,
): number {
  return expandSlots(windows, matchDurationMinutes).length;
}

export interface TeamForDraw {
  id: string;
  name: string;
  /** Empty means "no preference" — treated as available for every window. */
  preferredSlotIds: string[];
}

/** Windows a team can play, honouring the empty-means-any rule. */
function canPlay(team: TeamForDraw, slotId: string): boolean {
  return team.preferredSlotIds.length === 0 || team.preferredSlotIds.includes(slotId);
}

/** Round-robin pairings within one pool. */
export function roundRobin<T>(items: T[]): [T, T][] {
  const pairs: [T, T][] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) pairs.push([items[i], items[j]]);
  }
  return pairs;
}

export interface DrawMatch {
  poolIndex: number;
  homeTeamId: string;
  awayTeamId: string;
  /** Null when no feasible slot was found for this pairing. */
  slot: MatchSlot | null;
}

export interface DrawPlan {
  /** Team ids per pool, in pool order. */
  pools: string[][];
  matches: DrawMatch[];
  /** Matches that found a slot both teams had ticked. */
  scheduled: number;
  /** Matches with no feasible slot at all. */
  unscheduled: number;
  /** Placements that had to ignore a team's stated preference. */
  compromises: number;
  /** Higher is better — used to rank candidate plans for the admin. */
  score: number;
}

/**
 * Deterministic shuffle. Seeded so the same inputs reproduce the same
 * candidate plans — an admin re-opening the page must not see the draw
 * change under them.
 */
function seededShuffle<T>(items: T[], seed: number): T[] {
  const a = items.slice();
  let s = seed || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build one candidate draw: deal teams into pools, then greedily place
 * every pool match into the earliest slot where BOTH teams are free and
 * available.
 *
 * Greedy-earliest is deliberate: it front-loads the tournament so a
 * later window stays free for overruns, and it makes the output stable
 * and explainable ("we filled Saturday morning first").
 */
export function buildDraw(
  teams: TeamForDraw[],
  windows: SlotWindow[],
  opts: {
    poolCount: number;
    matchDurationMinutes: number;
    seed: number;
    /** Off = plain shuffled deal, ignoring preferences when grouping.
     *  Clustering is usually better, but when everyone's picks line up
     *  it collapses to a single arrangement — these give the admin a
     *  genuine alternative to compare against. */
    cluster?: boolean;
  },
): DrawPlan {
  const slots = expandSlots(windows, opts.matchDurationMinutes);
  const poolCount = Math.max(1, opts.poolCount);
  // Cluster by availability BEFORE dealing. This is the whole point of
  // collecting preferences: teams that can play the same windows belong
  // in the same pool, because a pool's round-robin has to fit inside
  // the windows its members share. A preference-blind deal scatters
  // them and every fixture becomes a compromise.
  const signature = (t: TeamForDraw) =>
    t.preferredSlotIds.length === 0
      ? "" // no preference — filler, fits anywhere
      : t.preferredSlotIds.slice().sort().join("|");

  const useCluster = opts.cluster !== false;
  const groups = new Map<string, TeamForDraw[]>();
  for (const t of seededShuffle(teams, opts.seed)) {
    const k = signature(t);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  // Biggest, most-constrained groups placed first; the "any" group is
  // left till last so it can pad whichever pools end up short.
  const ordered = [...groups.entries()]
    .sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : b[1].length - a[1].length))
    .flatMap(([, v]) => v);

  const pools: TeamForDraw[][] = Array.from({ length: poolCount }, () => []);
  const perPool = Math.ceil(teams.length / poolCount);
  for (const t of ordered) {
    // Prefer a pool that already shares this team's windows and has
    // room; otherwise the emptiest pool, to keep sizes even.
    const candidates = pools
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.length < perPool);
    const target =
      (useCluster ? candidates.find(({ p }) =>
        p.length > 0 &&
        p.every((o) => signature(o) === signature(t) || signature(o) === "" || signature(t) === ""),
      ) : undefined) ?? candidates.sort((a, b) => a.p.length - b.p.length)[0] ?? { i: 0 };
    pools[target.i].push(t);
  }

  const matches: DrawMatch[] = [];
  for (let p = 0; p < pools.length; p++) {
    for (const [a, b] of roundRobin(pools[p])) {
      matches.push({ poolIndex: p, homeTeamId: a.id, awayTeamId: b.id, slot: null });
    }
  }

  // One match at a time venue-wide, so a slot is consumed globally.
  const usedSlot = new Set<number>();
  // A team can't be in two places at once.
  const teamBusy = new Map<string, Set<number>>();
  const byId = new Map(teams.map((t) => [t.id, t]));
  const busy = (id: string) => {
    let s = teamBusy.get(id);
    if (!s) teamBusy.set(id, (s = new Set()));
    return s;
  };

  let compromises = 0;
  for (const m of matches) {
    const home = byId.get(m.homeTeamId)!;
    const away = byId.get(m.awayTeamId)!;

    // Pass 1: a slot both teams actually ticked.
    let chosen = slots.find(
      (s, i) =>
        !usedSlot.has(i) &&
        canPlay(home, s.slotId) &&
        canPlay(away, s.slotId) &&
        !busy(home.id).has(s.absoluteMinutes) &&
        !busy(away.id).has(s.absoluteMinutes),
    );
    let compromised = false;

    // Pass 2: nothing satisfied both — place it anyway rather than
    // leave the fixture in limbo, and count it so the admin sees the
    // cost of this plan.
    if (!chosen) {
      chosen = slots.find(
        (s, i) =>
          !usedSlot.has(i) &&
          !busy(home.id).has(s.absoluteMinutes) &&
          !busy(away.id).has(s.absoluteMinutes),
      );
      if (chosen) compromised = true;
    }

    if (chosen) {
      const idx = slots.indexOf(chosen);
      usedSlot.add(idx);
      busy(home.id).add(chosen.absoluteMinutes);
      busy(away.id).add(chosen.absoluteMinutes);
      m.slot = chosen;
      if (compromised) compromises++;
    }
  }

  const scheduled = matches.filter((m) => m.slot).length;
  const unscheduled = matches.length - scheduled;
  return {
    pools: pools.map((p) => p.map((t) => t.id)),
    matches,
    scheduled,
    unscheduled,
    compromises,
    // Unplaced fixtures are far worse than an ignored preference.
    score: scheduled * 10 - unscheduled * 100 - compromises * 5,
  };
}

/**
 * Several candidate draws, best first.
 *
 * Not "every possible pool" — with 9 teams in 3 pools that's already
 * ~280k arrangements before scheduling. We sample the space with
 * distinct seeds and surface the strongest, which is what an admin can
 * actually choose between.
 */
export function generateCandidates(
  teams: TeamForDraw[],
  windows: SlotWindow[],
  opts: { poolCount: number; matchDurationMinutes: number; count?: number },
): DrawPlan[] {
  const tries = opts.count ?? 24;
  const plans: DrawPlan[] = [];
  for (let seed = 1; seed <= tries; seed++) {
    // Clustered draws honour preferences best; unclustered ones give the
    // admin a real alternative when every team's picks align and the
    // clustered arrangement is otherwise the only one on offer.
    plans.push(buildDraw(teams, windows, { ...opts, seed, cluster: true }));
    plans.push(buildDraw(teams, windows, { ...opts, seed, cluster: false }));
  }
  // De-duplicate identical pool arrangements so the admin isn't offered
  // the same draw twice under different numbers.
  const seen = new Set<string>();
  const unique = plans.filter((p) => {
    const key = p.pools.map((x) => x.slice().sort().join("|")).sort().join("/");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.sort((a, b) => b.score - a.score).slice(0, 5);
}
