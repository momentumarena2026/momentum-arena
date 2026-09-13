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
