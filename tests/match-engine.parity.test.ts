/**
 * Parity suite for the scratch-match scoring engine.
 *
 * `lib/public-match.ts` is the documented source of truth and
 * `apps/mobile/src/lib/match-engine.ts` is its hand-maintained mirror. The
 * mirror exists because the phone replays the event log locally for instant
 * taps and the server replays the same log on write — "the log is the wire
 * format", so if the two replays ever disagree the phone and the scoreboard
 * silently fork mid-match.
 *
 * Nothing enforced that until now. These tests drive both implementations with
 * identical event logs and assert byte-identical derived state.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  replay as serverReplay,
  inningsOver as serverInningsOver,
  validateScoreEvent as serverValidate,
  oversLabel as serverOversLabel,
  type ScoreEvent,
  type PublicMatchSport,
} from "../lib/public-match";

import {
  replay as mobileReplay,
  inningsOver as mobileInningsOver,
  validateScoreEvent as mobileValidate,
  oversLabel as mobileOversLabel,
} from "../apps/mobile/src/lib/match-engine";

function assertSameState(events: ScoreEvent[], sport: PublicMatchSport, label: string) {
  const a = serverReplay(events, sport);
  const b = mobileReplay(events, sport as never);
  assert.deepEqual(b, a, `replay diverged: ${label}`);
}

/** The mixed over hand-verified in PROJECT-CONTEXT.md §5. */
const mixedOver: ScoreEvent[] = [
  { t: "SQUAD", side: "A", players: ["Asha", "Bilal", "Chen", "Dev"] },
  { t: "SQUAD", side: "B", players: ["Eve", "Farid", "Gita", "Hari"] },
  { t: "OPEN", striker: "Asha", nonStriker: "Bilal", bowler: "Eve" },
  { t: "RUN", runs: 1 },
  { t: "RUN", runs: 4 },
  { t: "WIDE" },
  { t: "BYE", runs: 2 },
  { t: "NO_BALL", runs: 1 },
  { t: "LEG_BYE", runs: 1 },
  { t: "RUN", runs: 6 },
  { t: "RUN", runs: 0 },
];

test("the hand-verified mixed over replays identically", () => {
  assertSameState(mixedOver, "CRICKET", "mixed over");
});

test("wickets, retirements and strike rotation replay identically", () => {
  const events: ScoreEvent[] = [
    ...mixedOver,
    { t: "WICKET", kind: "BOWLED", batter: "Asha", newBatter: "Chen" },
    { t: "RUN", runs: 3 },
    { t: "BOWLER", name: "Farid" },
    { t: "RUN", runs: 1 },
    { t: "RETIRE", batter: "Bilal", newBatter: "Dev" },
    { t: "WICKET", kind: "RUN_OUT", batter: "Dev", fielder: "Gita", newBatter: null as never },
    { t: "SWAP" },
    { t: "RUN", runs: 2 },
  ];
  assertSameState(events, "CRICKET", "wickets + retire");
});

test("innings changeover replays identically", () => {
  const events: ScoreEvent[] = [
    ...mixedOver,
    { t: "END_INNINGS" },
    { t: "OPEN", striker: "Eve", nonStriker: "Farid", bowler: "Asha" },
    { t: "RUN", runs: 4 },
    { t: "WICKET", kind: "CAUGHT", batter: "Eve", fielder: "Chen", newBatter: "Gita" },
    { t: "RUN", runs: 1 },
  ];
  assertSameState(events, "CRICKET", "second innings");
});

test("football and pickleball replay identically", () => {
  for (const sport of ["FOOTBALL", "PICKLEBALL"] as PublicMatchSport[]) {
    const events: ScoreEvent[] = [
      { t: "SQUAD", side: "A", players: ["Asha", "Bilal"] },
      { t: "SQUAD", side: "B", players: ["Eve", "Farid"] },
      { t: "POINT", side: "A", player: "Asha", assist: "Bilal" },
      { t: "POINT", side: "B", player: "Eve" },
      { t: "POINT", side: "A" },
      { t: "CARD", side: "B", player: "Farid", kind: "YELLOW" },
      { t: "CARD", side: "B", player: "Farid", kind: "RED" },
      { t: "POINT", side: "A", player: "Bilal", assist: "Asha" },
    ];
    assertSameState(events, sport, sport);
  }
});

test("an empty log and a squad-only log replay identically", () => {
  for (const sport of ["CRICKET", "FOOTBALL", "PICKLEBALL"] as PublicMatchSport[]) {
    assertSameState([], sport, `empty/${sport}`);
    assertSameState(
      [{ t: "SQUAD", side: "A", players: ["  Asha  ", "", "Bilal"] }],
      sport,
      `squad-trim/${sport}`,
    );
  }
});

/**
 * Deterministic fuzz. A fixed LCG so a failure is always reproducible — the
 * runner forbids Math.random-style nondeterminism in a parity check, because a
 * flaky divergence is worse than none.
 */
test("2000 pseudo-random logs replay identically", () => {
  let seed = 0x9e3779b9;
  const rnd = (n: number) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % n;
  };
  const names = ["Asha", "Bilal", "Chen", "Dev", "Eve", "Farid"];
  const pick = () => names[rnd(names.length)];

  for (let i = 0; i < 2000; i++) {
    const sport = (["CRICKET", "FOOTBALL", "PICKLEBALL"] as PublicMatchSport[])[rnd(3)];
    const events: ScoreEvent[] = [
      { t: "SQUAD", side: "A", players: names.slice(0, 3) },
      { t: "SQUAD", side: "B", players: names.slice(3) },
    ];
    if (sport === "CRICKET") {
      events.push({ t: "OPEN", striker: names[0], nonStriker: names[1], bowler: names[3] });
    }
    const len = 4 + rnd(24);
    for (let j = 0; j < len; j++) {
      switch (rnd(sport === "CRICKET" ? 11 : 3)) {
        case 0: events.push({ t: "RUN", runs: rnd(7) }); break;
        case 1: events.push({ t: "BYE", runs: 1 + rnd(3) }); break;
        case 2: events.push({ t: "LEG_BYE", runs: 1 + rnd(3) }); break;
        case 3: events.push({ t: "WIDE", runs: rnd(3) }); break;
        case 4: events.push({ t: "NO_BALL", runs: rnd(4) }); break;
        case 5: events.push({ t: "WICKET", kind: "BOWLED", batter: pick(), newBatter: pick() }); break;
        case 6: events.push({ t: "BOWLER", name: pick() }); break;
        case 7: events.push({ t: "SWAP" }); break;
        case 8: events.push({ t: "RETIRE", batter: pick(), newBatter: pick() }); break;
        case 9: events.push({ t: "END_INNINGS" }); break;
        default: events.push({ t: "POINT", side: rnd(2) ? "A" : "B", player: pick() });
      }
    }
    assertSameState(events, sport, `fuzz#${i} seed-derived`);
  }
});

test("inningsOver, validateScoreEvent and oversLabel agree", () => {
  for (let balls = 0; balls < 130; balls++) {
    assert.equal(
      mobileOversLabel(balls),
      serverOversLabel(balls),
      `oversLabel(${balls})`,
    );
  }

  const ruleSets = [
    { sport: "CRICKET" as const, oversPerInnings: null },
    { sport: "CRICKET" as const, oversPerInnings: 0 },
    { sport: "CRICKET" as const, oversPerInnings: 1 },
    { sport: "CRICKET" as const, oversPerInnings: 2 },
    { sport: "FOOTBALL" as const },
    { sport: "PICKLEBALL" as const },
  ];

  const logs: ScoreEvent[][] = [
    [],
    mixedOver,
    [...mixedOver, { t: "END_INNINGS" }],
    [...mixedOver, { t: "WICKET", kind: "BOWLED", batter: "Asha", newBatter: "Chen" }],
  ];

  for (const rules of ruleSets) {
    for (const events of logs) {
      const sv = serverReplay(events, rules.sport);
      const mv = mobileReplay(events, rules.sport as never);

      assert.equal(
        mobileInningsOver(mv as never, rules as never),
        serverInningsOver(sv, rules),
        `inningsOver(${rules.sport}, overs=${"oversPerInnings" in rules ? rules.oversPerInnings : "-"})`,
      );

      for (const e of [
        ...mixedOver,
        { t: "SQUAD", side: "A", players: ["Asha", "asha"] } as ScoreEvent,
        { t: "POINT", side: "A", player: "Nobody" } as ScoreEvent,
        { t: "WICKET", kind: "BOWLED", batter: "Asha" } as ScoreEvent,
      ]) {
        assert.deepEqual(
          mobileValidate(mv as never, e as never, rules as never),
          serverValidate(sv, e, rules),
          `validateScoreEvent(${e.t}) under ${rules.sport}`,
        );
      }
    }
  }
});
