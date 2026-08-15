import { db } from "@/lib/db";

// Live scoring engine. One append-only event log per match; the live
// scoreboard state is a FOLD of the events in seq order, so:
//   - undo = delete the highest-seq event and re-fold (always consistent)
//   - the audience screen reads ONE denormalised snapshot (match.liveState)
//     plus the recent events for the timeline
// Sport engines:
//   CRICKET   : INNINGS_START {battingTeamId} · BALL {runs, extra?, wicket?,
//               batterId?, bowlerId?}   (wd/nb don't count the ball)
//   FOOTBALL  : CLOCK_START · CLOCK_STOP · GOAL {teamId, memberId?, assistId?}
//               · CARD {teamId, memberId?, card}
//   PICKLEBALL: POINT {teamId} · GAME_END
// Player stats sync: after every change the stat rows for the match are
// re-derived from the event log (cricket runs/wickets, football goals/
// assists, pickleball points) — keyed to the tournament's stat fields.

export type LiveEventInput = {
  kind: string;
  teamId?: string | null;
  memberId?: string | null;
  data?: Record<string, unknown> | null;
};

// Sanity ceilings for scorer input. A single delivery can't produce more
// than a handful of runs, and an innings can't lose more than 10 wickets —
// without these, one fat-fingered (or forged) value dominates every
// score-difference tiebreaker in the tournament.
const MAX_RUNS_PER_BALL = 12; // 6 off the bat + generous extras
/**
 * Wickets a side has when the tournament hasn't said otherwise.
 *
 * Ten is the standard game, but a short-format cup with 8–10 players a
 * side plays fewer, and treating that as a constant is not cosmetic: it
 * decides when a side is ALL OUT, and "all out" is what triggers the
 * Net Run Rate rule that charges a side its full over quota. Momentum's
 * own cup plays 8, so a team bowled out for 55 in 8.5 overs was divided
 * by 8.5 instead of 10 and every NRR in the pool came out wrong.
 */
const DEFAULT_WICKETS_PER_INNINGS = 10;
/** Fields inside event.data that name a player and must be on this match. */
const MEMBER_REF_KEYS = ["batterId", "bowlerId", "assistId", "fielderId"] as const;

type EventRow = {
  seq: number;
  kind: string;
  teamId: string | null;
  memberId: string | null;
  data: unknown;
};

// ── Folds ───────────────────────────────────────────────────────────
/** Who is actually out there right now. Derived in the fold (not held in
 *  the scorer's local state) so the crease survives a reload, and so the
 *  audience screens can show the same thing the scorer sees. */
export type CreaseBatter = { id: string; runs: number; balls: number };
export type CreaseBowler = { id: string; balls: number; runs: number; wickets: number };
export type CricketCurrent = {
  strikerId: string | null;
  nonStrikerId: string | null;
  bowlerId: string | null;
  batters: CreaseBatter[]; // the (up to two) not-out batters at the crease
  bowler: CreaseBowler | null;
  /** Balls bowled in the over in progress, newest last: "1" "4" "W" "wd". */
  thisOver: string[];
  /** Legal balls completed in the over in progress (0–5). */
  ballsThisOver: number;
  partnership: { runs: number; balls: number };
  /** True right after a wicket — the console must pick the new batter. */
  needsBatter: boolean;
  /** True when an over just completed — the console must pick a bowler. */
  needsBowler: boolean;
  /** Batters dismissed in this innings — they cannot come back in. */
  dismissed: string[];
  /** Balls bowled by each bowler this innings, for the over quota. */
  spells: { id: string; balls: number }[];
  /** Who bowled the over that just finished — they can't bowl the next one. */
  lastOverBowlerId: string | null;
};

export type CricketState = {
  sport: "CRICKET";
  inning: number; // 1-based; 0 = not started
  battingTeamId: string | null;
  innings: { teamId: string; runs: number; wickets: number; balls: number }[];
  target: number | null;
  current: CricketCurrent;
};

const emptyCurrent = (): CricketCurrent => ({
  strikerId: null,
  nonStrikerId: null,
  bowlerId: null,
  batters: [],
  bowler: null,
  thisOver: [],
  ballsThisOver: 0,
  partnership: { runs: 0, balls: 0 },
  needsBatter: false,
  needsBowler: false,
  dismissed: [],
  spells: [],
  lastOverBowlerId: null,
});

/**
 * Exchange the two ends. A plain swap, nulls included: when one batter
 * is out and the over then ends, the survivor should come on strike and
 * the empty slot move to the far end, which is exactly what swapping a
 * null gives you.
 */
function swapEnds(cur: CricketCurrent): void {
  const s = cur.strikerId;
  cur.strikerId = cur.nonStrikerId;
  cur.nonStrikerId = s;
}

/**
 * How many runs the BATSMEN physically ran — which is what decides
 * whether they cross and swap ends.
 *
 * Not the same as the runs added to the total. A wide or no-ball carries
 * a one-run penalty that nobody ran, so five off a no-ball is four run
 * (even → no swap) while two off a wide is one run (odd → swap). Byes
 * and leg-byes aren't credited to the batter but ARE run, so they rotate
 * strike like any other single.
 */
function runsRunByBatsmen(d: { runs: number; extra?: string | null }): number {
  if (d.extra === "wd" || d.extra === "nb") return Math.max(0, d.runs - 1);
  return d.runs;
}

/** Short label for one delivery, as it reads on a scoreboard over-strip. */
function ballLabel(d: { runs: number; extra?: string | null; wicket?: boolean }): string {
  if (d.wicket) return "W";
  if (d.extra === "wd") return d.runs > 1 ? `${d.runs - 1}wd` : "wd";
  if (d.extra === "nb") return d.runs > 1 ? `${d.runs - 1}nb` : "nb";
  if (d.extra === "b") return `${d.runs}b`;
  if (d.extra === "lb") return `${d.runs}lb`;
  return String(d.runs);
}

export function foldCricket(
  events: EventRow[],
  /** Tournament.wicketsPerInnings. Omitted = the standard ten. */
  wicketsPerInnings: number = DEFAULT_WICKETS_PER_INNINGS,
): CricketState {
  const maxWickets =
    wicketsPerInnings > 0 ? wicketsPerInnings : DEFAULT_WICKETS_PER_INNINGS;
  const st: CricketState = {
    sport: "CRICKET",
    inning: 0,
    battingTeamId: null,
    innings: [],
    target: null,
    current: emptyCurrent(),
  };
  // Per-innings running figures for the players currently involved.
  let batFigures = new Map<string, { runs: number; balls: number; out: boolean }>();
  let bowlFigures = new Map<string, { balls: number; runs: number; wickets: number }>();

  for (const e of events) {
    if (e.kind === "INNINGS_START" && e.teamId) {
      st.inning += 1;
      st.battingTeamId = e.teamId;
      st.innings.push({ teamId: e.teamId, runs: 0, wickets: 0, balls: 0 });
      if (st.inning === 2 && st.innings[0]) st.target = st.innings[0].runs + 1;
      // New innings — everyone leaves the field.
      st.current = emptyCurrent();
      batFigures = new Map();
      bowlFigures = new Map();
    } else if (e.kind === "CREASE" && st.innings.length > 0) {
      // The scorer naming who is standing where. This is what "locking"
      // the pair means: from here the fold knows who is on strike without
      // being told again on every delivery, so it can rotate them itself.
      // Sent for the opening pair, and again whenever someone new walks
      // in — carrying which end they take.
      const d = (e.data || {}) as { strikerId?: string; nonStrikerId?: string };
      const cur = st.current;
      if (typeof d.strikerId === "string") cur.strikerId = d.strikerId || null;
      if (typeof d.nonStrikerId === "string") {
        cur.nonStrikerId = d.nonStrikerId || null;
      }
      if (cur.nonStrikerId && cur.nonStrikerId === cur.strikerId) {
        cur.nonStrikerId = null;
      }
    } else if (e.kind === "RETIRE" && st.innings.length > 0) {
      // Retired hurt: the batter leaves but is NOT out. They stay off the
      // dismissed list so they can come back later in the innings, and no
      // wicket is recorded — the whole difference from a dismissal.
      const d = (e.data || {}) as { batterId?: string };
      const cur = st.current;
      const id = d.batterId || e.memberId || null;
      if (id) {
        if (cur.strikerId === id) cur.strikerId = null;
        else if (cur.nonStrikerId === id) cur.nonStrikerId = null;
        cur.partnership = { runs: 0, balls: 0 };
      }
    } else if (e.kind === "BALL" && st.innings.length > 0) {
      const inn = st.innings[st.innings.length - 1];
      const raw = (e.data || {}) as {
        runs?: number;
        extra?: string | null;
        wicket?: boolean;
        batterId?: string;
        bowlerId?: string;
        /** Run-outs can take either batter, so the scorer names who went. */
        outBatterId?: string;
        /** "bowled" | "caught" | "lbw" | "runout" | "stumped" | "hitwicket" */
        dismissal?: string;
      };
      const runs = Math.min(MAX_RUNS_PER_BALL, Math.max(0, Number(raw.runs) || 0));
      const extra = raw.extra || null;
      const wicket = !!raw.wicket;
      const legal = extra !== "wd" && extra !== "nb"; // wides/no-balls are re-bowled
      const batterId = raw.batterId || e.memberId || null;
      const bowlerId = raw.bowlerId || null;

      inn.runs += runs;
      if (wicket) inn.wickets = Math.min(maxWickets, inn.wickets + 1);
      if (legal) inn.balls += 1;

      const cur = st.current;
      // ── Who faced it. The crease pair is LOCKED by CREASE events, so the
      // striker is whoever is standing there — not, as this used to do,
      // "whoever the scorer happened to tag on this ball". Inferring it
      // per-ball meant nothing ever rotated on its own: the same batter
      // stayed on strike through a single, and the non-striker only
      // existed as a side effect of the scorer tagging the other player.
      //
      // raw.batterId is still honoured as a fallback so events logged
      // before the crease was locked keep folding the way they did.
      const onStrike = cur.strikerId || batterId;
      if (onStrike) {
        cur.strikerId = onStrike;
        const f = batFigures.get(onStrike) || { runs: 0, balls: 0, out: false };
        if (extra !== "wd") f.balls += 1; // a wide isn't a ball faced
        if (!extra) f.runs += runs;
        batFigures.set(onStrike, f);
      }
      if (bowlerId) {
        cur.bowlerId = bowlerId;
        const f = bowlFigures.get(bowlerId) || { balls: 0, runs: 0, wickets: 0 };
        if (legal) f.balls += 1;
        f.runs += runs;
        if (wicket) f.wickets += 1;
        bowlFigures.set(bowlerId, f);
      }

      // ── Over strip + partnership.
      cur.thisOver.push(ballLabel({ runs, extra, wicket }));
      if (legal) cur.ballsThisOver += 1;
      cur.partnership.runs += runs;
      if (legal) cur.partnership.balls += 1;

      // ── Strike rotation. Odd runs cross the batsmen over. This is the
      // half the old model left to the scorer: it never rotated, so a
      // single left the same player facing until someone re-tagged by
      // hand. Runs off the bat, byes and leg-byes all rotate; the penalty
      // run on a wide/no-ball does not, because nobody ran it.
      if (runsRunByBatsmen({ runs, extra }) % 2 === 1) swapEnds(cur);

      if (wicket) {
        // Who actually went. Defaults to whoever is now at the striker's
        // end, which is right for bowled / caught / lbw / stumped — those
        // carry no runs, so nothing rotated above. A run-out can take
        // either batter and often follows an odd run that already crossed
        // them, so there the scorer names the victim and we believe it
        // rather than guessing from an end.
        const outId =
          (typeof raw.outBatterId === "string" && raw.outBatterId) ||
          cur.strikerId;
        if (outId) {
          const f = batFigures.get(outId);
          if (f) f.out = true;
          if (!cur.dismissed.includes(outId)) cur.dismissed.push(outId);
          if (cur.nonStrikerId === outId) cur.nonStrikerId = null;
          else cur.strikerId = null;
        }
        cur.partnership = { runs: 0, balls: 0 };
      }

      if (cur.ballsThisOver >= 6) {
        // Over complete: the batsmen keep their ends but change which one
        // faces, and a different bowler must come on.
        swapEnds(cur);
        cur.thisOver = [];
        cur.ballsThisOver = 0;
        cur.lastOverBowlerId = cur.bowlerId;
        cur.bowlerId = null;
        cur.needsBowler = true;
      } else {
        cur.needsBowler = false;
      }

      // One player can never occupy both ends.
      if (cur.nonStrikerId && cur.nonStrikerId === cur.strikerId) cur.nonStrikerId = null;
    }
  }

  // Publish the crease figures for whoever is still out there.
  const cur = st.current;
  // A batter is needed whenever an end is empty and the innings is live —
  // which covers the opening pair (both ends empty) and a fallen wicket
  // (one end empty) with the same rule, rather than only firing after a
  // dismissal the way the old flag did. That gap is how deliveries used
  // to get logged with nobody locked in at the start of an innings.
  cur.needsBatter =
    st.inning > 0 &&
    (!cur.strikerId || !cur.nonStrikerId) &&
    (st.innings[st.innings.length - 1]?.wickets ?? 0) < maxWickets;
  cur.batters = [cur.strikerId, cur.nonStrikerId]
    .filter((id): id is string => !!id)
    .map((id) => {
      const f = batFigures.get(id) || { runs: 0, balls: 0, out: false };
      return { id, runs: f.runs, balls: f.balls };
    });
  cur.bowler = cur.bowlerId
    ? { id: cur.bowlerId, ...(bowlFigures.get(cur.bowlerId) || { balls: 0, runs: 0, wickets: 0 }) }
    : null;
  // Every bowler's workload this innings — the console compares this
  // against the tournament's max-overs-per-bowler rule.
  cur.spells = [...bowlFigures.entries()].map(([id, f]) => ({ id, balls: f.balls }));
  return st;
}

export type FootballState = {
  sport: "FOOTBALL";
  goals: Record<string, number>; // teamId -> goals
  running: boolean;
  /** Who's just been involved — the football answer to "who's on strike". */
  current: {
    lastGoal: { teamId: string; memberId: string | null; assistId: string | null } | null;
    /** Scorers so far, newest first, for the on-screen scorer strip. */
    scorers: { teamId: string; memberId: string | null }[];
    cards: { teamId: string; memberId: string | null; card: string }[];
  };
};

export function foldFootball(events: EventRow[]): FootballState {
  const st: FootballState = {
    sport: "FOOTBALL",
    goals: {},
    running: false,
    current: { lastGoal: null, scorers: [], cards: [] },
  };
  for (const e of events) {
    if (e.kind === "GOAL" && e.teamId) {
      st.goals[e.teamId] = (st.goals[e.teamId] || 0) + 1;
      const d = (e.data || {}) as { assistId?: string };
      st.current.lastGoal = {
        teamId: e.teamId,
        memberId: e.memberId || null,
        assistId: d.assistId || null,
      };
      st.current.scorers.unshift({ teamId: e.teamId, memberId: e.memberId || null });
    } else if (e.kind === "CARD" && e.teamId) {
      const d = (e.data || {}) as { card?: string };
      st.current.cards.unshift({
        teamId: e.teamId,
        memberId: e.memberId || null,
        card: d.card === "red" ? "red" : "yellow",
      });
    } else if (e.kind === "CLOCK_START") st.running = true;
    else if (e.kind === "CLOCK_STOP") st.running = false;
  }
  return st;
}

export type PickleballState = {
  sport: "PICKLEBALL";
  games: { home: number; away: number }[]; // finished games (home/away = team order)
  current: { home: number; away: number };
  gamesWon: { home: number; away: number };
  /** Who serves next — pickleball's "who's on strike". The side that won
   *  the last rally serves; at the start of a game nobody has served yet. */
  servingTeamId: string | null;
  gameNumber: number;
};

export function foldPickleball(
  events: EventRow[],
  homeTeamId: string,
): PickleballState {
  const st: PickleballState = {
    sport: "PICKLEBALL",
    games: [],
    current: { home: 0, away: 0 },
    gamesWon: { home: 0, away: 0 },
    servingTeamId: null,
    gameNumber: 1,
  };
  for (const e of events) {
    if (e.kind === "POINT" && e.teamId) {
      if (e.teamId === homeTeamId) st.current.home += 1;
      else st.current.away += 1;
      st.servingTeamId = e.teamId;
    } else if (e.kind === "GAME_END") {
      st.games.push({ ...st.current });
      if (st.current.home > st.current.away) st.gamesWon.home += 1;
      else if (st.current.away > st.current.home) st.gamesWon.away += 1;
      st.current = { home: 0, away: 0 };
      st.servingTeamId = null;
      st.gameNumber += 1;
    }
  }
  return st;
}

// ── Stat derivation from events ─────────────────────────────────────
function deriveStats(
  sport: string,
  events: EventRow[],
  memberTeam: Map<string, string>
): { memberId: string; teamId: string; statKey: string; value: number }[] {
  const acc = new Map<string, number>(); // "memberId:statKey" -> value
  const bump = (memberId: string | null | undefined, statKey: string, by = 1) => {
    if (!memberId || !memberTeam.has(memberId)) return;
    const k = `${memberId}:${statKey}`;
    acc.set(k, (acc.get(k) || 0) + by);
  };
  for (const e of events) {
    const d = (e.data || {}) as Record<string, unknown>;
    if (sport === "CRICKET" && e.kind === "BALL") {
      bump(
        d.batterId as string,
        "runs",
        Math.min(MAX_RUNS_PER_BALL, Math.max(0, Number(d.runs) || 0))
      );
      if (d.wicket) bump(d.bowlerId as string, "wickets", 1);
    } else if (sport === "FOOTBALL" && e.kind === "GOAL") {
      bump(e.memberId, "goals", 1);
      bump(d.assistId as string, "assists", 1);
    } else if (sport === "PICKLEBALL" && e.kind === "POINT") {
      bump(e.memberId, "points", 1);
    }
  }
  return [...acc.entries()]
    .filter(([, v]) => v > 0)
    .map(([k, value]) => {
      const [memberId, statKey] = k.split(":");
      return { memberId, teamId: memberTeam.get(memberId)!, statKey, value };
    });
}

// ── Refold + persist ────────────────────────────────────────────────
async function refoldMatch(matchId: string): Promise<void> {
  const match = await db.tournamentMatch.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      tournamentId: true,
      homeTeamId: true,
      awayTeamId: true,
      tournament: { select: { sport: true, statFields: true } },
      homeTeam: { select: { members: { select: { id: true } } } },
      awayTeam: { select: { members: { select: { id: true } } } },
    },
  });
  if (!match || !match.homeTeamId || !match.awayTeamId) return;

  const events = await db.tournamentMatchEvent.findMany({
    where: { matchId },
    orderBy: { seq: "asc" },
    select: { seq: true, kind: true, teamId: true, memberId: true, data: true },
  });

  const sport = match.tournament.sport;
  let liveState: unknown;
  let homeScore = 0;
  let awayScore = 0;
  if (sport === "CRICKET") {
    const st = foldCricket(events);
    liveState = st;
    for (const inn of st.innings) {
      if (inn.teamId === match.homeTeamId) homeScore = inn.runs;
      if (inn.teamId === match.awayTeamId) awayScore = inn.runs;
    }
  } else if (sport === "FOOTBALL") {
    const st = foldFootball(events);
    liveState = st;
    homeScore = st.goals[match.homeTeamId] || 0;
    awayScore = st.goals[match.awayTeamId] || 0;
  } else {
    const st = foldPickleball(events, match.homeTeamId);
    liveState = st;
    homeScore = st.gamesWon.home;
    awayScore = st.gamesWon.away;
  }

  const memberTeam = new Map<string, string>();
  for (const m of match.homeTeam?.members || []) memberTeam.set(m.id, match.homeTeamId);
  for (const m of match.awayTeam?.members || []) memberTeam.set(m.id, match.awayTeamId);
  const validKeys = new Set(
    (Array.isArray(match.tournament.statFields) ? match.tournament.statFields : [])
      .map((f) => (f && typeof f === "object" ? (f as { key?: string }).key : null))
      .filter(Boolean) as string[]
  );
  const stats = deriveStats(sport, events, memberTeam).filter((s) => validKeys.has(s.statKey));

  await db.$transaction(async (tx) => {
    await tx.tournamentMatch.update({
      where: { id: matchId },
      data: { liveState: liveState as never, homeScore, awayScore },
    });
    // Only take over the stat rows when the event log actually carries
    // player attribution. A match scored without tagging players derives
    // nothing, and blowing the rows away would destroy stats the admin
    // entered by hand on the Scores tab.
    if (stats.length) {
      await tx.tournamentPlayerStat.deleteMany({ where: { matchId } });
      await tx.tournamentPlayerStat.createMany({
        data: stats.map((s) => ({ ...s, tournamentId: match.tournamentId, matchId })),
      });
    }
  });
}

// ── Public engine API ───────────────────────────────────────────────
const ALLOWED_KINDS: Record<string, string[]> = {
  // CREASE locks who is standing where; RETIRE takes a batter off without
  // a dismissal. Both are cricket-only and, like every other kind here,
  // are rejected outright for the wrong sport.
  CRICKET: ["INNINGS_START", "BALL", "CREASE", "RETIRE"],
  FOOTBALL: ["CLOCK_START", "CLOCK_STOP", "GOAL", "CARD"],
  PICKLEBALL: ["POINT", "GAME_END"],
};

const CRICKET_EXTRAS = new Set(["wd", "nb", "b", "lb"]);
const CARD_KINDS = new Set(["yellow", "red"]);

/** Rebuild event.data from known keys only, bounded and type-checked. The
 *  raw client blob is never persisted: it is public (the live feed returns
 *  it to every viewer) and unbounded blobs are a response-amplification
 *  lever as well as a scoring-integrity hole. */
function sanitiseEventData(
  sport: string,
  kind: string,
  raw: Record<string, unknown>
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  const str = (v: unknown) => (typeof v === "string" && v.length <= 64 ? v : undefined);

  if (sport === "CRICKET" && kind === "BALL") {
    out.runs = Math.min(MAX_RUNS_PER_BALL, Math.max(0, Math.floor(Number(raw.runs) || 0)));
    if (raw.wicket) out.wicket = true;
    const extra = str(raw.extra);
    if (extra && CRICKET_EXTRAS.has(extra)) out.extra = extra;
    const wicketKind = str(raw.wicketKind);
    if (wicketKind) out.wicketKind = wicketKind.slice(0, 24);
    for (const key of MEMBER_REF_KEYS) {
      const ref = str(raw[key]);
      if (ref) out[key] = ref;
    }
  } else if (sport === "FOOTBALL" && kind === "GOAL") {
    const assist = str(raw.assistId);
    if (assist) out.assistId = assist;
    if (raw.ownGoal) out.ownGoal = true;
  } else if (sport === "FOOTBALL" && kind === "CARD") {
    const card = str(raw.card);
    out.card = card && CARD_KINDS.has(card) ? card : "yellow";
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** What the guards need to know about the match, beyond the event log. */
export type LiveGuardContext = {
  sport: string;
  homeTeamId: string;
  awayTeamId: string;
  /** memberId -> teamId for both rosters. */
  memberTeam: Map<string, string>;
  /** Cricket over quota per bowler; 0 = no limit. */
  maxOversPerBowler: number;
  /** Cricket overs per side; 0 = unlimited. Match override wins. */
  oversPerInnings: number;
  /** Cricket wickets per side. Omitted = the standard ten. */
  wicketsPerInnings?: number;
};

/**
 * State-dependent rules — the ones that need to know what has already
 * happened, not just whether a field is well-formed.
 *
 * This lives on the SERVER because the scorer code is the whole
 * credential: anyone holding it can POST straight at the endpoint, so a
 * disabled button in the console is a courtesy, not a control. Every rule
 * here is re-checked against a fresh fold of the log on each event.
 *
 * Returns a scorer-facing message, or null when the event is legal.
 */
export function validateLiveEvent(
  ctx: LiveGuardContext,
  events: EventRow[],
  input: LiveEventInput
): string | null {
  const teamOf = (id: string | null | undefined) => (id ? ctx.memberTeam.get(id) : undefined);
  const other = (teamId: string) => (teamId === ctx.homeTeamId ? ctx.awayTeamId : ctx.homeTeamId);
  const d = (input.data || {}) as Record<string, unknown>;

  if (ctx.sport === "CRICKET") {
    const maxWickets = ctx.wicketsPerInnings || DEFAULT_WICKETS_PER_INNINGS;
    const st = foldCricket(events, maxWickets);
    if (input.kind === "INNINGS_START") {
      if (!input.teamId) return "Pick which team is batting";
      if (st.inning >= 2) return "Both innings have already been played";
      if (st.innings.some((i) => i.teamId === input.teamId)) return "That team has already batted";
      return null;
    }
    if (input.kind === "CREASE") {
      if (st.inning === 0 || !st.battingTeamId) return "Start an innings first";
      const strikerId = typeof d.strikerId === "string" ? d.strikerId : null;
      const nonStrikerId = typeof d.nonStrikerId === "string" ? d.nonStrikerId : null;
      const cur = st.current;
      for (const id of [strikerId, nonStrikerId]) {
        if (!id) continue;
        if (teamOf(id) !== st.battingTeamId) return "That player isn't in the batting side";
        if (cur.dismissed.includes(id)) return "That batter is already out";
      }
      // The two ends are two different people — a pair that folds to one
      // player at both ends is how the crease silently empties.
      if (strikerId && strikerId === cur.nonStrikerId && !nonStrikerId) {
        return "That batter is already at the other end";
      }
      if (nonStrikerId && nonStrikerId === cur.strikerId && !strikerId) {
        return "That batter is already on strike";
      }
      if (strikerId && nonStrikerId && strikerId === nonStrikerId) {
        return "Pick two different batters";
      }
      return null;
    }
    if (input.kind === "RETIRE") {
      if (st.inning === 0) return "Start an innings first";
      const id = (typeof d.batterId === "string" ? d.batterId : null) || input.memberId;
      if (!id) return "Pick which batter is retiring";
      const cur = st.current;
      if (cur.strikerId !== id && cur.nonStrikerId !== id) {
        return "That batter isn't at the crease";
      }
      return null;
    }
    if (input.kind === "BALL") {
      if (st.inning === 0 || !st.battingTeamId) return "Start an innings before scoring a ball";
      const cur = st.current;
      const inn = st.innings[st.innings.length - 1];
      const batterId = (typeof d.batterId === "string" ? d.batterId : null) || input.memberId || null;
      const bowlerId = typeof d.bowlerId === "string" ? d.bowlerId : null;

      // The two that started this whole thread: a delivery with nobody on
      // strike and nobody bowling is not a delivery, it's a typo.
      if (!batterId) return "Pick the batter on strike first";
      if (!bowlerId) return "Pick the bowler first";

      const bowlingTeamId = other(st.battingTeamId);
      if (teamOf(batterId) !== st.battingTeamId) return "That batter isn't in the batting side";
      if (teamOf(bowlerId) !== bowlingTeamId) return "That bowler isn't in the fielding side";
      if (cur.dismissed.includes(batterId)) return "That batter is already out";
      if (inn && inn.wickets >= maxWickets) return "All out — end the innings";
      // The innings is only as long as the tournament says it is.
      if (ctx.oversPerInnings > 0 && inn && inn.balls >= ctx.oversPerInnings * 6) {
        return `Innings complete — ${ctx.oversPerInnings} overs bowled. End the innings.`;
      }

      // Quota and the consecutive-overs law both bite only when the bowler
      // is STARTING an over; mid-over they're already committed.
      const startingOver = cur.thisOver.length === 0;
      if (startingOver && cur.lastOverBowlerId && bowlerId === cur.lastOverBowlerId) {
        return "A bowler can't bowl two overs in a row";
      }
      if (ctx.maxOversPerBowler > 0) {
        const balls = cur.spells.find((s) => s.id === bowlerId)?.balls ?? 0;
        if (balls >= ctx.maxOversPerBowler * 6) {
          return `That bowler has already bowled their ${ctx.maxOversPerBowler} overs`;
        }
      }
      return null;
    }
    return null;
  }

  if (ctx.sport === "FOOTBALL") {
    const st = foldFootball(events);
    if (input.kind === "GOAL") {
      if (!input.teamId) return "Pick which team scored";
      const ownGoal = d.ownGoal === true;
      const assistId = typeof d.assistId === "string" ? d.assistId : null;
      if (input.memberId) {
        // An own goal is credited to the conceding side's player, so the
        // scorer legitimately belongs to the OTHER team.
        const expected = ownGoal ? other(input.teamId) : input.teamId;
        if (teamOf(input.memberId) !== expected) {
          return ownGoal
            ? "An own goal must name a player from the other side"
            : "That scorer isn't in the team that scored";
        }
      }
      if (assistId) {
        if (ownGoal) return "An own goal can't have an assist";
        if (assistId === input.memberId) return "The assist can't be the scorer";
        if (teamOf(assistId) !== input.teamId) return "That assist isn't in the team that scored";
      }
      return null;
    }
    if (input.kind === "CARD") {
      if (!input.teamId) return "Pick which team the card is for";
      if (!input.memberId) return "Pick the player being carded";
      if (teamOf(input.memberId) !== input.teamId) return "That player isn't in that team";
      const theirs = st.current.cards.filter((c) => c.memberId === input.memberId);
      if (theirs.some((c) => c.card === "red")) return "That player has already been sent off";
      if (d.card !== "red" && theirs.filter((c) => c.card === "yellow").length >= 2) {
        return "That player already has two yellows";
      }
      return null;
    }
    if (input.kind === "CLOCK_START" && st.running) return "The clock is already running";
    if (input.kind === "CLOCK_STOP" && !st.running) return "The clock isn't running";
    return null;
  }

  if (ctx.sport === "PICKLEBALL") {
    const st = foldPickleball(events, ctx.homeTeamId);
    if (input.kind === "POINT") {
      if (!input.teamId) return "Pick which side won the rally";
      if (input.memberId && teamOf(input.memberId) !== input.teamId) {
        return "That player isn't in that side";
      }
      return null;
    }
    if (input.kind === "GAME_END") {
      // Deliberately NOT checking "11, win by 2" — the target score isn't
      // configurable per tournament and venues play to 15 and 21 too. What
      // IS universal: a game with no points hasn't started, and a level
      // game has no winner to award.
      const { home, away } = st.current;
      if (home + away === 0) return "No points scored in this game yet";
      if (home === away) return "The game is level — it can't end in a tie";
      return null;
    }
    return null;
  }

  return null;
}

export async function applyLiveEvent(
  matchId: string,
  input: LiveEventInput,
  actor: string
): Promise<{ ok: boolean; error?: string }> {
  const match = await db.tournamentMatch.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      status: true,
      homeTeamId: true,
      awayTeamId: true,
      oversPerInnings: true,
      clockStartedAt: true,
      clockElapsedSec: true,
      tournament: {
        select: {
          sport: true,
          liveScoringEnabled: true,
          maxOversPerBowler: true,
          oversPerInnings: true,
          wicketsPerInnings: true,
        },
      },
      homeTeam: { select: { members: { select: { id: true } } } },
      awayTeam: { select: { members: { select: { id: true } } } },
    },
  });
  if (!match) return { ok: false, error: "Match not found" };
  if (!match.tournament.liveScoringEnabled) return { ok: false, error: "Live scoring is off" };
  if (match.status !== "LIVE") return { ok: false, error: "Match is not live" };
  const allowed = ALLOWED_KINDS[match.tournament.sport] || [];
  if (!allowed.includes(input.kind)) return { ok: false, error: `Invalid event for ${match.tournament.sport}` };
  if (input.teamId && ![match.homeTeamId, match.awayTeamId].includes(input.teamId)) {
    return { ok: false, error: "Team is not in this match" };
  }

  // Every player reference must be on one of these two rosters — otherwise
  // a scorer can name anyone in the database (including another
  // tournament's player) in this match's public timeline.
  const rosterIds = new Set<string>([
    ...(match.homeTeam?.members || []).map((m) => m.id),
    ...(match.awayTeam?.members || []).map((m) => m.id),
  ]);
  if (input.memberId && !rosterIds.has(input.memberId)) {
    return { ok: false, error: "Player is not in this match" };
  }
  const rawData = (input.data || {}) as Record<string, unknown>;
  for (const key of MEMBER_REF_KEYS) {
    const ref = rawData[key];
    if (ref && (typeof ref !== "string" || !rosterIds.has(ref))) {
      return { ok: false, error: "Player is not in this match" };
    }
  }
  // Now the rules that depend on what has already happened. Re-folded from
  // the log on every event, so this holds no matter who is POSTing.
  if (match.homeTeamId && match.awayTeamId) {
    const memberTeam = new Map<string, string>();
    for (const m of match.homeTeam?.members || []) memberTeam.set(m.id, match.homeTeamId);
    for (const m of match.awayTeam?.members || []) memberTeam.set(m.id, match.awayTeamId);
    const prior = await db.tournamentMatchEvent.findMany({
      where: { matchId },
      orderBy: { seq: "asc" },
      select: { seq: true, kind: true, teamId: true, memberId: true, data: true },
    });
    const problem = validateLiveEvent(
      {
        sport: match.tournament.sport,
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
        memberTeam,
        maxOversPerBowler: match.tournament.maxOversPerBowler ?? 0,
        // A match may be shortened (rain, a late start), and the innings
        // cap has to follow the overs actually being played rather than
        // the ones originally scheduled.
        oversPerInnings:
          match.oversPerInnings ?? match.tournament.oversPerInnings ?? 0,
        wicketsPerInnings: match.tournament.wicketsPerInnings ?? undefined,
      },
      prior,
      input
    );
    if (problem) return { ok: false, error: problem };
  }

  // Persist a whitelisted, bounded copy of the payload — never the raw blob.
  const data = sanitiseEventData(match.tournament.sport, input.kind, rawData);

  // Append with the next seq (retry once on the unique-collision race).
  for (let attempt = 0; attempt < 2; attempt++) {
    const max = await db.tournamentMatchEvent.aggregate({
      where: { matchId },
      _max: { seq: true },
    });
    try {
      await db.tournamentMatchEvent.create({
        data: {
          matchId,
          seq: (max._max.seq ?? 0) + 1,
          kind: input.kind,
          teamId: input.teamId || null,
          memberId: input.memberId || null,
          data: (data as never) ?? undefined,
          createdBy: actor,
        },
      });
      break;
    } catch (e) {
      if (attempt === 1) throw e;
    }
  }

  // Football clock bookkeeping on the match row itself.
  if (input.kind === "CLOCK_START" && !match.clockStartedAt) {
    await db.tournamentMatch.update({ where: { id: matchId }, data: { clockStartedAt: new Date() } });
  } else if (input.kind === "CLOCK_STOP" && match.clockStartedAt) {
    const extra = Math.round((Date.now() - match.clockStartedAt.getTime()) / 1000);
    await db.tournamentMatch.update({
      where: { id: matchId },
      data: { clockStartedAt: null, clockElapsedSec: match.clockElapsedSec + extra },
    });
  }

  await refoldMatch(matchId);
  return { ok: true };
}

export async function undoLastEvent(matchId: string): Promise<{ ok: boolean; error?: string }> {
  // Undo is a LIVE-only correction. Without this guard the scorer code
  // doubles as a permanent rewrite key: an undo on a finished match
  // silently changes its score while status/winner stay frozen, and the
  // refold wipes any player stats the admin entered by hand. Reopening a
  // completed match is an admin action (reopenMatch), not a scorer one.
  const match = await db.tournamentMatch.findUnique({
    where: { id: matchId },
    select: { status: true },
  });
  if (!match) return { ok: false, error: "Match not found" };
  if (match.status !== "LIVE") {
    return { ok: false, error: "Match is not live — reopen it from the admin console to edit" };
  }
  const last = await db.tournamentMatchEvent.findFirst({
    where: { matchId },
    orderBy: { seq: "desc" },
  });
  if (!last) return { ok: false, error: "Nothing to undo" };
  // Undo a clock event → restore the previous clock condition.
  if (last.kind === "CLOCK_START") {
    await db.tournamentMatch.update({ where: { id: matchId }, data: { clockStartedAt: null } });
  } else if (last.kind === "CLOCK_STOP") {
    // Re-open the clock; the elapsed seconds it banked are recomputed as
    // "banked - that stop's contribution" is unknowable, so restart now.
    await db.tournamentMatch.update({ where: { id: matchId }, data: { clockStartedAt: new Date() } });
  }
  await db.tournamentMatchEvent.delete({ where: { id: last.id } });
  await refoldMatch(matchId);
  return { ok: true };
}

export async function startLiveMatch(matchId: string): Promise<{ ok: boolean; error?: string }> {
  const match = await db.tournamentMatch.findUnique({
    where: { id: matchId },
    select: {
      status: true,
      homeTeamId: true,
      awayTeamId: true,
      tournament: { select: { liveScoringEnabled: true } },
    },
  });
  if (!match) return { ok: false, error: "Match not found" };
  if (!match.tournament.liveScoringEnabled) return { ok: false, error: "Live scoring is off" };
  if (match.status !== "SCHEDULED") return { ok: false, error: "Match already started or done" };
  if (!match.homeTeamId || !match.awayTeamId) return { ok: false, error: "Teams not decided yet" };
  await db.tournamentMatch.update({ where: { id: matchId }, data: { status: "LIVE" } });
  return { ok: true };
}

/** End the live match and submit the fold as the final result. A tied
 *  knockout needs `winnerTeamId`; a tied round-robin becomes a draw. */
export async function endLiveMatch(
  matchId: string,
  winnerTeamId?: string | null
): Promise<{ ok: boolean; error?: string; needsWinner?: boolean }> {
  const match = await db.tournamentMatch.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      status: true,
      stage: true,
      tournamentId: true,
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
      clockStartedAt: true,
      clockElapsedSec: true,
      liveState: true,
    },
  });
  if (!match || match.status !== "LIVE") return { ok: false, error: "Match is not live" };
  const home = match.homeScore ?? 0;
  const away = match.awayScore ?? 0;
  const isRR = match.stage === "POOL" || match.stage === "LEAGUE";

  let winner: string | null = null;
  let isDraw = false;
  if (home === away) {
    if (winnerTeamId && [match.homeTeamId, match.awayTeamId].includes(winnerTeamId)) {
      winner = winnerTeamId;
    } else if (isRR) {
      isDraw = true;
    } else {
      return { ok: false, needsWinner: true, error: "Tied — pick the winner" };
    }
  } else {
    winner = home > away ? match.homeTeamId : match.awayTeamId;
  }

  // Bank any running football clock.
  const clockPatch = match.clockStartedAt
    ? {
        clockStartedAt: null,
        clockElapsedSec:
          match.clockElapsedSec + Math.round((Date.now() - match.clockStartedAt.getTime()) / 1000),
      }
    : {};

  await db.tournamentMatch.update({
    where: { id: matchId },
    data: { status: "COMPLETED", winnerTeamId: winner, isDraw, ...clockPatch },
  });
  const { applyProgression } = await import("@/lib/tournament-progression");
  await applyProgression(match.tournamentId);
  return { ok: true };
}

/** Football display clock (seconds) from persisted fields. */
export function footballClockSeconds(m: {
  clockStartedAt: Date | string | null;
  clockElapsedSec: number;
}): number {
  const started = m.clockStartedAt ? new Date(m.clockStartedAt).getTime() : null;
  return m.clockElapsedSec + (started ? Math.max(0, Math.round((Date.now() - started) / 1000)) : 0);
}
