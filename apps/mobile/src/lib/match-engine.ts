/**
 * The match engine, app side — an exact mirror of lib/public-match.ts on
 * the web. Keep the two in sync.
 *
 * Why a copy rather than a fetch: the scorer's taps are applied HERE
 * first. Replaying locally is what lets the pad respond instantly and
 * keeps working through a dead patch of ground-side wifi; the server
 * replays the same log and is still the authority when they disagree.
 *
 * validateScoreEvent must be mirrored too, not just replay(): the phone
 * appends optimistically and flushes in batches, so if it accepted a tap
 * the server would reject, the whole batch bounces and the scorer loses
 * the over. Both sides must reach the same verdict from the same log.
 */

export type PublicMatchSport = "CRICKET" | "FOOTBALL" | "PICKLEBALL";

export type WicketKind =
  | "BOWLED"
  | "CAUGHT"
  | "LBW"
  | "RUN_OUT"
  | "STUMPED"
  | "HIT_WICKET"
  | "OTHER";

/**
 * The event log. Everything the scoreboard knows is derived from this by
 * `replay`, which is why undo is a pop rather than an inverse operation,
 * and why adding a field here never needs a migration: rosters and
 * player tagging ride in the log alongside the runs.
 *
 * Player references are plain names — a scratch match has no accounts
 * behind its XI, and asking a scorer to register eleven users before the
 * first ball would kill the feature.
 */
export type ScoreEvent =
  // Setup — valid for every sport.
  | { t: "SQUAD"; side: "A" | "B"; players: string[] }
  // Cricket
  | { t: "OPEN"; striker: string; nonStriker: string; bowler: string }
  | { t: "BOWLER"; name: string }
  | { t: "RUN"; runs: number }
  | { t: "BYE"; runs: number }
  | { t: "LEG_BYE"; runs: number }
  | { t: "WIDE"; runs?: number }
  | { t: "NO_BALL"; runs?: number }
  | {
      t: "WICKET";
      kind?: WicketKind;
      /** Defaults to the striker. */
      batter?: string;
      fielder?: string;
      /** Who walks in; the log stays replayable without it. */
      newBatter?: string;
    }
  | { t: "RETIRE"; batter?: string; newBatter?: string }
  | { t: "SWAP" }
  | { t: "END_INNINGS" }
  // Football / pickleball
  | { t: "POINT"; side: "A" | "B"; player?: string; assist?: string }
  | { t: "CARD"; side: "A" | "B"; player: string; kind: "YELLOW" | "RED" };

export interface BatterCard {
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  /** null while not out; otherwise how they went. */
  out: WicketKind | "RETIRED" | null;
  outBy: string | null;
}

export interface BowlerCard {
  balls: number;
  runs: number;
  wickets: number;
}

export interface PublicMatchState {
  /** Cricket: 0 = first innings, 1 = second. Others: always 0. */
  innings: number;
  runsA: number;
  runsB: number;
  wicketsA: number;
  wicketsB: number;
  /** Legal balls bowled in each innings. */
  ballsA: number;
  ballsB: number;

  // ---- Rosters (all sports) ----
  squadA: string[];
  squadB: string[];

  // ---- Cricket detail ----
  striker: string | null;
  nonStriker: string | null;
  /** null right after an over ends — the scorer must name the next one. */
  bowler: string | null;
  /** Who bowled the over that just finished, so the "no two overs in a
   *  row" rule has something to check against. */
  lastOverBowler: string | null;
  /** Batting card for the side currently in, keyed by player name. */
  batting: Record<string, BatterCard>;
  bowling: Record<string, BowlerCard>;
  extras: { wide: number; noBall: number; bye: number; legBye: number };
  /** Short labels for the over in progress: ["1", "W", "wd", "4"]. */
  thisOver: string[];

  // ---- Football / pickleball detail ----
  scorers: Array<{ side: "A" | "B"; player: string; assist: string | null }>;
  cards: Array<{ side: "A" | "B"; player: string; kind: "YELLOW" | "RED" }>;
}

const EMPTY: PublicMatchState = {
  innings: 0,
  runsA: 0,
  runsB: 0,
  wicketsA: 0,
  wicketsB: 0,
  ballsA: 0,
  ballsB: 0,
  squadA: [],
  squadB: [],
  striker: null,
  nonStriker: null,
  bowler: null,
  lastOverBowler: null,
  batting: {},
  bowling: {},
  extras: { wide: 0, noBall: 0, bye: 0, legBye: 0 },
  thisOver: [],
  scorers: [],
  cards: [],
};

function emptyState(): PublicMatchState {
  return {
    ...EMPTY,
    squadA: [],
    squadB: [],
    batting: {},
    bowling: {},
    extras: { wide: 0, noBall: 0, bye: 0, legBye: 0 },
    thisOver: [],
    scorers: [],
    cards: [],
  };
}

/** Rebuild the scoreboard from scratch. The single source of truth. */
export function replay(
  events: ScoreEvent[],
  sport: PublicMatchSport,
): PublicMatchState {
  const s = emptyState();

  const bat = (name: string | null): BatterCard | null => {
    if (!name) return null;
    if (!s.batting[name]) {
      s.batting[name] = { runs: 0, balls: 0, fours: 0, sixes: 0, out: null, outBy: null };
    }
    return s.batting[name];
  };
  const bowl = (name: string | null): BowlerCard | null => {
    if (!name) return null;
    if (!s.bowling[name]) s.bowling[name] = { balls: 0, runs: 0, wickets: 0 };
    return s.bowling[name];
  };
  const swap = () => {
    const t = s.striker;
    s.striker = s.nonStriker;
    s.nonStriker = t;
  };

  for (const e of events) {
    // Rosters are sport-agnostic and always applied.
    if (e.t === "SQUAD") {
      const names = e.players.map((p) => p.trim()).filter(Boolean).slice(0, 20);
      if (e.side === "A") s.squadA = names;
      else s.squadB = names;
      continue;
    }

    if (sport !== "CRICKET") {
      if (e.t === "POINT") {
        if (e.side === "A") s.runsA += 1;
        else s.runsB += 1;
        if (e.player) {
          s.scorers.push({ side: e.side, player: e.player, assist: e.assist ?? null });
        }
      } else if (e.t === "CARD") {
        s.cards.push({ side: e.side, player: e.player, kind: e.kind });
      }
      continue;
    }

    // ---- Cricket: everything lands on whichever side is batting. ----
    const batA = s.innings === 0;
    const addRuns = (n: number) => {
      if (batA) s.runsA += n;
      else s.runsB += n;
    };
    /** A legal delivery: counts for the over, the bowler and the batter. */
    const legalBall = () => {
      if (batA) s.ballsA += 1;
      else s.ballsB += 1;
      const b = bowl(s.bowler);
      if (b) b.balls += 1;
      // Six legal balls close the over: strike rotates and the scorer
      // has to name the next bowler, exactly like a real scorebook.
      const balls = batA ? s.ballsA : s.ballsB;
      if (balls % 6 === 0) {
        swap();
        s.lastOverBowler = s.bowler;
        s.bowler = null;
        s.thisOver = [];
      }
    };
    const note = (label: string) => {
      // Only the over in progress; legalBall() clears it on the sixth.
      s.thisOver.push(label);
    };

    switch (e.t) {
      case "OPEN":
        s.striker = e.striker;
        s.nonStriker = e.nonStriker;
        s.bowler = e.bowler;
        bat(e.striker);
        bat(e.nonStriker);
        bowl(e.bowler);
        break;

      case "BOWLER":
        s.bowler = e.name;
        bowl(e.name);
        break;

      case "RUN": {
        const n = Math.max(0, Math.min(7, e.runs));
        addRuns(n);
        const b = bat(s.striker);
        if (b) {
          b.runs += n;
          b.balls += 1;
          if (n === 4) b.fours += 1;
          if (n === 6) b.sixes += 1;
        }
        const bo = bowl(s.bowler);
        if (bo) bo.runs += n;
        note(String(n));
        legalBall();
        if (n % 2 === 1) swap();
        break;
      }

      case "BYE":
      case "LEG_BYE": {
        const n = Math.max(0, Math.min(7, e.runs));
        addRuns(n);
        if (e.t === "BYE") s.extras.bye += n;
        else s.extras.legBye += n;
        // The batter faced it but scored nothing off the bat; byes are
        // not charged to the bowler either.
        const b = bat(s.striker);
        if (b) b.balls += 1;
        note(`${n}${e.t === "BYE" ? "b" : "lb"}`);
        legalBall();
        if (n % 2 === 1) swap();
        break;
      }

      case "WIDE": {
        const extra = Math.max(0, Math.min(6, e.runs ?? 0));
        addRuns(1 + extra);
        s.extras.wide += 1 + extra;
        const bo = bowl(s.bowler);
        if (bo) bo.runs += 1 + extra;
        note(extra > 0 ? `wd+${extra}` : "wd");
        // No legal ball. Batters cross on the extras they run.
        if (extra % 2 === 1) swap();
        break;
      }

      case "NO_BALL": {
        const off = Math.max(0, Math.min(7, e.runs ?? 0));
        addRuns(1 + off);
        s.extras.noBall += 1;
        const b = bat(s.striker);
        if (b) {
          b.runs += off;
          b.balls += 1;
          if (off === 4) b.fours += 1;
          if (off === 6) b.sixes += 1;
        }
        const bo = bowl(s.bowler);
        if (bo) bo.runs += 1 + off;
        note(off > 0 ? `nb+${off}` : "nb");
        // No legal ball — the over doesn't advance.
        if (off % 2 === 1) swap();
        break;
      }

      case "WICKET": {
        if (batA) s.wicketsA += 1;
        else s.wicketsB += 1;
        const who = e.batter ?? s.striker;
        const card = bat(who);
        if (card) {
          card.balls += 1;
          card.out = e.kind ?? "OTHER";
          card.outBy = e.fielder ?? s.bowler ?? null;
        }
        // A run-out isn't the bowler's wicket.
        const bo = bowl(s.bowler);
        if (bo && e.kind !== "RUN_OUT") bo.wickets += 1;
        note("W");
        legalBall();
        // The incoming batter takes the departed one's end. legalBall()
        // may have swapped on the over change, so resolve against
        // whichever end the out batter is standing at now.
        if (e.newBatter) {
          bat(e.newBatter);
          if (s.nonStriker === who) s.nonStriker = e.newBatter;
          else s.striker = e.newBatter;
        } else if (s.striker === who) {
          s.striker = null;
        } else if (s.nonStriker === who) {
          s.nonStriker = null;
        }
        break;
      }

      case "RETIRE": {
        const who = e.batter ?? s.striker;
        const card = bat(who);
        if (card) card.out = "RETIRED";
        if (e.newBatter) {
          bat(e.newBatter);
          if (s.nonStriker === who) s.nonStriker = e.newBatter;
          else s.striker = e.newBatter;
        } else if (s.striker === who) {
          s.striker = null;
        } else if (s.nonStriker === who) {
          s.nonStriker = null;
        }
        break;
      }

      case "SWAP":
        swap();
        break;

      case "END_INNINGS":
        if (s.innings === 0) {
          s.innings = 1;
          // Fresh cards for the side coming in — the old innings is
          // already banked in runsA/wicketsA/ballsA.
          s.striker = null;
          s.nonStriker = null;
          s.bowler = null;
          s.lastOverBowler = null;
          s.batting = {};
          s.bowling = {};
          s.extras = { wide: 0, noBall: 0, bye: 0, legBye: 0 };
          s.thisOver = [];
        }
        break;

      case "POINT":
      case "CARD":
        break;
    }
  }
  return s;
}

/**
 * Rules for a scratch match.
 *
 * Mirrors validateLiveEvent in lib/tournament-live.ts — same shape (return
 * a scorer-facing message, or null when the event is legal), same rules
 * where they apply. The two feature sets differ (no per-bowler quota here,
 * squads are free-text and optional), but the reasoning is identical: a
 * disabled button is a courtesy, not a control, so every rule is
 * re-checked server-side against a fresh replay of the log.
 *
 * The APP runs this too, against its local replay, before appending a tap.
 * That is not belt-and-braces — it's required: the phone scores optimistically
 * and flushes in batches, so if it accepted a tap the server would reject,
 * the whole batch bounces and the scorer loses the over. Both sides must
 * reach the same verdict from the same log.
 */

/** Standard XI: 10 wickets ends an innings. When the scorer has entered a
 *  squad we use it instead, so a 6-a-side game ends at 5 down. */
const DEFAULT_MAX_WICKETS = 10;

export interface MatchRules {
  sport: PublicMatchSport;
  /** null / 0 = unlimited (a casual knock with no agreed length). */
  oversPerInnings?: number | null;
}

/** Wickets that end the current innings, given who's actually playing. */
function maxWickets(state: PublicMatchState): number {
  const squad = state.innings === 0 ? state.squadA : state.squadB;
  return squad.length > 1 ? squad.length - 1 : DEFAULT_MAX_WICKETS;
}

/**
 * Is the innings in progress over? Returns the reason, or null.
 *
 * Exported because the UI needs the same answer to decide whether to show
 * the scoring pad or an "end the innings" prompt — the bug this was written
 * for was the pad staying live past the last over, and a "pick the next
 * bowler" prompt appearing for an over that could never be bowled.
 */
export function inningsOver(
  state: PublicMatchState,
  rules: MatchRules,
): string | null {
  if (rules.sport !== "CRICKET") return null;
  const balls = state.innings === 0 ? state.ballsA : state.ballsB;
  const wickets = state.innings === 0 ? state.wicketsA : state.wicketsB;
  const limit = rules.oversPerInnings ?? 0;
  if (limit > 0 && balls >= limit * 6) {
    return `Over limit reached — ${limit} ${limit === 1 ? "over" : "overs"} bowled.`;
  }
  if (wickets >= maxWickets(state)) return "All out.";
  // Second innings only: once the target is passed the game is decided.
  if (state.innings === 1 && state.runsB > state.runsA) {
    return "Target chased.";
  }
  return null;
}

/** Events that put a ball on the scoreboard. */
const DELIVERIES = new Set([
  "RUN",
  "BYE",
  "LEG_BYE",
  "WIDE",
  "NO_BALL",
  "WICKET",
]);

export function validateScoreEvent(
  state: PublicMatchState,
  event: ScoreEvent,
  rules: MatchRules,
): string | null {
  // Rosters are always editable — a scorer routinely adds a latecomer.
  if (event.t === "SQUAD") {
    const names = event.players.map((p) => p.trim()).filter(Boolean);
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) {
      return "Two players have the same name — make them unique";
    }
    return null;
  }

  if (rules.sport !== "CRICKET") {
    const squadFor = (side: "A" | "B") => (side === "A" ? state.squadA : state.squadB);
    if (event.t === "POINT" && event.player) {
      // Only enforced once a squad exists; a pickup game may have none.
      const squad = squadFor(event.side);
      if (squad.length > 0 && !squad.includes(event.player)) {
        return `${event.player} isn't in that side`;
      }
    }
    if (event.t === "CARD") {
      const squad = squadFor(event.side);
      if (squad.length > 0 && !squad.includes(event.player)) {
        return `${event.player} isn't in that side`;
      }
      const alreadyOff = state.cards.some(
        (c) => c.player === event.player && c.kind === "RED",
      );
      if (alreadyOff) return `${event.player} has already been sent off`;
    }
    return null;
  }

  // ---- Cricket ----
  const batting = state.innings === 0 ? state.squadA : state.squadB;
  const bowling = state.innings === 0 ? state.squadB : state.squadA;
  const inSquad = (squad: string[], name: string) =>
    squad.length === 0 || squad.includes(name);

  if (event.t === "OPEN") {
    if (state.striker) return "The openers are already set";
    if (event.striker === event.nonStriker) {
      return "The two batters must be different people";
    }
    if (!inSquad(batting, event.striker)) return "The striker isn't in the batting side";
    if (!inSquad(batting, event.nonStriker)) {
      return "The non-striker isn't in the batting side";
    }
    if (!inSquad(bowling, event.bowler)) return "That bowler isn't in the fielding side";
    return null;
  }

  if (event.t === "BOWLER") {
    // The reported bug: the innings was over on overs, yet the console
    // still asked for — and accepted — the next bowler.
    const done = inningsOver(state, rules);
    if (done) return `${done} End the innings instead.`;
    if (!inSquad(bowling, event.name)) return "That bowler isn't in the fielding side";
    if (state.bowler === event.name) return `${event.name} is already bowling`;
    // Only bites when an over is actually starting; mid-over the bowler is
    // already committed. thisOver is cleared the moment an over closes.
    if (state.thisOver.length === 0 && state.lastOverBowler === event.name) {
      return "A bowler can't bowl two overs in a row";
    }
    return null;
  }

  if (DELIVERIES.has(event.t)) {
    // Innings-over FIRST. Closing an over nulls the bowler and a last
    // wicket can null the striker, so checking those first told the scorer
    // to "pick the bowler" when the truth was "the innings is finished" —
    // a correct block for the wrong reason, which is its own bug.
    const done = inningsOver(state, rules);
    if (done) return `${done} End the innings.`;
    if (!state.striker) return "Set the openers before scoring a ball";
    if (!state.bowler) return "Pick the bowler for this over first";
    if (event.t === "WICKET") {
      const who = event.batter ?? state.striker;
      if (who && state.batting[who]?.out) return `${who} is already out`;
      if (event.newBatter) {
        if (!inSquad(batting, event.newBatter)) {
          return "The incoming batter isn't in the batting side";
        }
        if (state.batting[event.newBatter]?.out) {
          return `${event.newBatter} is already out`;
        }
        if (
          event.newBatter === state.striker ||
          event.newBatter === state.nonStriker
        ) {
          return `${event.newBatter} is already batting`;
        }
      }
    }
    return null;
  }

  if (event.t === "RETIRE") {
    if (!state.striker && !state.nonStriker) return "Nobody is batting";
    if (event.newBatter) {
      if (!inSquad(batting, event.newBatter)) {
        return "The incoming batter isn't in the batting side";
      }
      if (state.batting[event.newBatter]?.out) return `${event.newBatter} is already out`;
      if (
        event.newBatter === state.striker ||
        event.newBatter === state.nonStriker
      ) {
        return `${event.newBatter} is already batting`;
      }
    }
    return null;
  }

  if (event.t === "SWAP") {
    if (!state.striker || !state.nonStriker) return "Both batters must be at the crease";
    return null;
  }

  if (event.t === "END_INNINGS") {
    if (state.innings >= 1) return "Both innings have already been played";
    return null;
  }

  return null;
}

/** Balls → "12.3" overs, the way a scoreboard reads. */
export function oversLabel(balls: number): string {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}

