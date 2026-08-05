/**
 * The match engine, app side — an exact mirror of lib/public-match.ts on
 * the web. Keep the two in sync.
 *
 * Why a copy rather than a fetch: the scorer's taps are applied HERE
 * first. Replaying locally is what lets the pad respond instantly and
 * keeps working through a dead patch of ground-side wifi; the server
 * replays the same log and is still the authority when they disagree.
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

/** Balls → "12.3" overs, the way a scoreboard reads. */
export function oversLabel(balls: number): string {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}

