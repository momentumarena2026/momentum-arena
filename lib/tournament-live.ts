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
const MAX_WICKETS_PER_INNINGS = 10;
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
});

/** Short label for one delivery, as it reads on a scoreboard over-strip. */
function ballLabel(d: { runs: number; extra?: string | null; wicket?: boolean }): string {
  if (d.wicket) return "W";
  if (d.extra === "wd") return d.runs > 1 ? `${d.runs - 1}wd` : "wd";
  if (d.extra === "nb") return d.runs > 1 ? `${d.runs - 1}nb` : "nb";
  if (d.extra === "b") return `${d.runs}b`;
  if (d.extra === "lb") return `${d.runs}lb`;
  return String(d.runs);
}

export function foldCricket(events: EventRow[]): CricketState {
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
    } else if (e.kind === "BALL" && st.innings.length > 0) {
      const inn = st.innings[st.innings.length - 1];
      const raw = (e.data || {}) as {
        runs?: number;
        extra?: string | null;
        wicket?: boolean;
        batterId?: string;
        bowlerId?: string;
      };
      const runs = Math.min(MAX_RUNS_PER_BALL, Math.max(0, Number(raw.runs) || 0));
      const extra = raw.extra || null;
      const wicket = !!raw.wicket;
      const legal = extra !== "wd" && extra !== "nb"; // wides/no-balls are re-bowled
      const batterId = raw.batterId || e.memberId || null;
      const bowlerId = raw.bowlerId || null;

      inn.runs += runs;
      if (wicket) inn.wickets = Math.min(MAX_WICKETS_PER_INNINGS, inn.wickets + 1);
      if (legal) inn.balls += 1;

      const cur = st.current;
      // ── Who's on strike. The scorer sends the batter with each ball, so
      // the striker is simply whoever just faced; the previous striker
      // becomes the non-striker when they change.
      if (batterId) {
        if (cur.strikerId && cur.strikerId !== batterId) {
          cur.nonStrikerId = cur.strikerId;
        }
        cur.strikerId = batterId;
        const f = batFigures.get(batterId) || { runs: 0, balls: 0, out: false };
        if (extra !== "wd") f.balls += 1; // a wide isn't a ball faced
        if (!extra) f.runs += runs;
        if (wicket) f.out = true;
        batFigures.set(batterId, f);
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

      if (wicket) {
        // The dismissed batter walks off — and is out of this innings for
        // good, so the console can stop offering them.
        if (cur.strikerId) {
          const f = batFigures.get(cur.strikerId);
          if (f) f.out = true;
          if (!cur.dismissed.includes(cur.strikerId)) cur.dismissed.push(cur.strikerId);
        }
        cur.strikerId = null;
        cur.partnership = { runs: 0, balls: 0 };
        cur.needsBatter = true;
      } else {
        cur.needsBatter = false;
      }

      if (cur.ballsThisOver >= 6) {
        // Over complete: strike rotates, and a different bowler must come on.
        // Only swap when there IS someone at the other end — otherwise the
        // rotation would move the striker into an empty slot and the same
        // player would end up listed at both ends.
        if (cur.nonStrikerId) {
          const s = cur.strikerId;
          cur.strikerId = cur.nonStrikerId;
          cur.nonStrikerId = s;
        }
        cur.thisOver = [];
        cur.ballsThisOver = 0;
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
  CRICKET: ["INNINGS_START", "BALL"],
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
      clockStartedAt: true,
      clockElapsedSec: true,
      tournament: { select: { sport: true, liveScoringEnabled: true } },
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
