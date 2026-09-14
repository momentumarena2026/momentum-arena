/**
 * The TOURNAMENT fold, against the Laws.
 *
 * This is the engine that scores the Cup, and until now it shared no code
 * with the casual one — so the run-out bug reported from a real match was
 * fixed last week in the engine the Cup does not use. These tests pin the
 * behaviour in the engine that actually runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldCricket, type EventRow } from "../lib/tournament-live";

const A = "team-a";
const B = "team-b";
let seq = 0;
const ev = (kind: string, data: Record<string, unknown>, teamId: string | null = null): EventRow => ({
  seq: seq++,
  kind,
  teamId,
  memberId: null,
  data,
});

/** An innings under way with Amit on strike and Bala at the bowler's end. */
function start(): EventRow[] {
  seq = 0;
  return [
    ev("INNINGS_START", {}, A),
    ev("CREASE", { strikerId: "amit", nonStrikerId: "bala" }),
  ];
}

const ball = (d: Record<string, unknown>) =>
  ev("BALL", { runs: 0, batterId: "amit", bowlerId: "dev", ...d });

test("the reported bug: striker run out at the bowler's end", () => {
  // Amit on strike sets off for a single; Bala runs towards the batting
  // end; Amit is run out at the bowler's end. Bala must keep strike and
  // the vacancy must be at the NON-striker's end.
  const st = foldCricket([
    ...start(),
    ball({ wicket: true, dismissal: "runout", outBatterId: "amit", outAtEnd: "NON_STRIKER" }),
  ]);
  assert.equal(st.current.strikerId, "bala", "the survivor faces next");
  assert.equal(st.current.nonStrikerId, null, "the new batter comes in down there");
});

test("sent back instead — run out at their own end", () => {
  const st = foldCricket([
    ...start(),
    ball({ wicket: true, dismissal: "runout", outBatterId: "amit", outAtEnd: "STRIKER" }),
  ]);
  assert.equal(st.current.strikerId, null, "the vacancy is on strike");
  assert.equal(st.current.nonStrikerId, "bala");
});

test("omitting the end keeps the old meaning, so finished matches replay the same", () => {
  const st = foldCricket([
    ...start(),
    ball({ wicket: true, dismissal: "runout", outBatterId: "amit" }),
  ]);
  assert.equal(st.current.strikerId, null);
  assert.equal(st.current.nonStrikerId, "bala");
});

test("a Mankad costs no ball in the over", () => {
  const st = foldCricket([
    ...start(),
    ball({ runs: 1 }),
    ball({
      wicket: true,
      dismissal: "runout",
      outBatterId: "amit",
      outAtEnd: "NON_STRIKER",
      beforeDelivery: true,
    }),
  ]);
  assert.equal(st.innings[0].balls, 1, "only the single counted");
  assert.equal(st.current.ballsThisOver, 1);
});

test("the rare four are never the bowler's wicket", () => {
  for (const dismissal of ["obstructing", "hitballtwice", "timedout", "retiredout"]) {
    const st = foldCricket([...start(), ball({ wicket: true, dismissal })]);
    assert.equal(st.innings[0].wickets, 1, `${dismissal} costs a wicket`);
    assert.equal(
      st.current.bowler?.wickets ?? 0,
      0,
      `${dismissal} must not go on the bowler's figures`,
    );
  }
});

test("but a bowled still is", () => {
  const st = foldCricket([...start(), ball({ wicket: true, dismissal: "bowled" })]);
  assert.equal(st.current.bowler?.wickets, 1);
});

test("byes off a no-ball are not the striker's runs", () => {
  // Three to the team: the penalty and two they ran after it beat the bat.
  const st = foldCricket([...start(), ball({ runs: 3, extra: "nb", byes: 2 })]);
  assert.equal(st.innings[0].runs, 3);
  const amit = st.current.batters.find((b) => b.id === "amit");
  assert.equal(amit?.runs, 0, "the striker hit nothing");
});

test("a no-ball arms the free hit, a legal ball consumes it", () => {
  const armed = foldCricket([...start(), ball({ runs: 1, extra: "nb" })]);
  assert.equal(armed.current.freeHit, true);
  const used = foldCricket([...start(), ball({ runs: 1, extra: "nb" }), ball({ runs: 0 })]);
  assert.equal(used.current.freeHit, false);
});

test("a wide on a free hit leaves it standing", () => {
  const st = foldCricket([
    ...start(),
    ball({ runs: 1, extra: "nb" }),
    ball({ runs: 1, extra: "wd" }),
  ]);
  assert.equal(st.current.freeHit, true);
});

/**
 * Super overs.
 *
 * A tied knockout has to resolve. Modelled as more innings — 1 and 2 are
 * the match, 3 and 4 the first super over, 5 and 6 the second — so the
 * fold, the scorecard and the over-strip all keep working untouched.
 */
import {
  superOverRound,
  inningsLimits,
  roundIsTied,
  nextSuperOverBattingTeam,
  superOverWinner,
  validateLiveEvent,
} from "../lib/tournament-live";

test("innings 1 and 2 are the match; 3 and 4 are the first super over", () => {
  assert.equal(superOverRound(1), 0);
  assert.equal(superOverRound(2), 0);
  assert.equal(superOverRound(3), 1);
  assert.equal(superOverRound(4), 1);
  assert.equal(superOverRound(5), 2);
  assert.equal(superOverRound(6), 2);
});

test("a super over is one over and two wickets, whatever the tournament plays", () => {
  const ctx = { oversPerInnings: 10, wicketsPerInnings: 8 };
  assert.deepEqual(inningsLimits(2, ctx), { overs: 10, wickets: 8 });
  assert.deepEqual(inningsLimits(3, ctx), { overs: 1, wickets: 2 });
});

/** A finished innings of `runs` for `teamId`. */
const innings = (teamId: string, runs: number) => ({ teamId, runs, wickets: 0, balls: 6 });

const stateOf = (inns: ReturnType<typeof innings>[]) =>
  ({
    sport: "CRICKET" as const,
    inning: inns.length,
    battingTeamId: inns[inns.length - 1]?.teamId ?? null,
    innings: inns,
    target: null,
    current: {
      strikerId: null, nonStrikerId: null, bowlerId: null, batters: [], bowler: null,
      thisOver: [], ballsThisOver: 0, partnership: { runs: 0, balls: 0 },
      needsBatter: false, needsBowler: false, dismissed: [], spells: [],
      lastOverBowlerId: null, freeHit: false,
    },
  });

test("a tie is only called on a finished round", () => {
  assert.equal(roundIsTied(stateOf([innings(A, 40)])), null, "half a match is not a tie");
  assert.equal(roundIsTied(stateOf([innings(A, 40), innings(B, 40)])), true);
  assert.equal(roundIsTied(stateOf([innings(A, 40), innings(B, 39)])), false);
});

test("the side that batted second opens the super over", () => {
  const st = stateOf([innings(A, 40), innings(B, 40)]);
  assert.equal(nextSuperOverBattingTeam(st), B);
  // And it alternates: B batted second in super over one, so B opens two.
  const st2 = stateOf([innings(A, 40), innings(B, 40), innings(B, 11), innings(A, 11)]);
  assert.equal(nextSuperOverBattingTeam(st2), A);
});

test("a super over can only be started after a tie, by the right side", () => {
  const ctx = {
    sport: "CRICKET",
    homeTeamId: A,
    awayTeamId: B,
    memberTeam: new Map<string, string>(),
    maxOversPerBowler: 2,
    oversPerInnings: 10,
    wicketsPerInnings: 8,
  };
  /** A finished round: one legal ball each, `a` and `b` off the bat.
   *  Kept under the per-ball ceiling — a single delivery cannot produce
   *  forty runs, and the sanitiser quite rightly clamps it. */
  const round = (first: string, second: string, a: number, b: number): EventRow[] => {
    seq = 0;
    return [
      ev("INNINGS_START", {}, first),
      ev("BALL", { runs: a, batterId: "x", bowlerId: "y" }),
      ev("INNINGS_START", {}, second),
      ev("BALL", { runs: b, batterId: "p", bowlerId: "q" }),
    ];
  };
  const start = (teamId: string) => ({ kind: "INNINGS_START", teamId });

  const decided = round(A, B, 5, 4);
  assert.match(
    validateLiveEvent(ctx as never, decided, start(B) as never) ?? "",
    /already has a winner/i,
  );

  const tied = round(A, B, 4, 4);
  assert.equal(
    validateLiveEvent(ctx as never, tied, start(B) as never),
    null,
    "the side that batted second may open the super over",
  );
  assert.match(
    validateLiveEvent(ctx as never, tied, start(A) as never) ?? "",
    /batted second bats first/i,
  );
});

test("the super over decides it, and the match score is left alone", () => {
  const tiedStill = stateOf([innings(A, 40), innings(B, 40), innings(B, 11), innings(A, 11)]);
  assert.equal(superOverWinner(tiedStill), null, "still level — another one is owed");

  const decided = stateOf([innings(A, 40), innings(B, 40), innings(B, 12), innings(A, 11)]);
  assert.equal(superOverWinner(decided), B);

  // Won on the SECOND super over, the first having been tied.
  const twice = stateOf([
    innings(A, 40), innings(B, 40),
    innings(B, 11), innings(A, 11),
    innings(A, 9), innings(B, 8),
  ]);
  assert.equal(superOverWinner(twice), A);
});

test("retiring out costs a wicket; retiring hurt does not", () => {
  const hurt = foldCricket([
    ...start(),
    ev("RETIRE", { batterId: "amit" }),
  ]);
  assert.equal(hurt.innings[0].wickets, 0, "hurt is not a dismissal");
  assert.ok(!hurt.current.dismissed.includes("amit"), "so they can come back");

  const out = foldCricket([
    ...start(),
    ev("RETIRE", { batterId: "amit", out: true }),
  ]);
  assert.equal(out.innings[0].wickets, 1, "retired out is a wicket");
  assert.ok(out.current.dismissed.includes("amit"), "and they are gone for good");
  assert.equal(out.current.bowler?.wickets ?? 0, 0, "but never the bowler's");
});
