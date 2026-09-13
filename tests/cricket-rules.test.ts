/**
 * The shared Laws module — the single implementation both the casual
 * engine and the tournament fold now call.
 *
 * These assert the rules directly, independent of either caller's state
 * shape, so a drift shows up here rather than as a wrong scorecard.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  creditsBowler,
  consumesBall,
  isFaced,
  armsFreeHit,
  splitRuns,
  crossed,
  endsAfterWicket,
  dismissalRefusal,
  bowlerSpent,
} from "../lib/cricket-rules";

test("only wickets earned off the stumps are the bowler's", () => {
  for (const k of ["BOWLED", "CAUGHT", "LBW", "STUMPED", "HIT_WICKET"] as const) {
    assert.equal(creditsBowler(k), true, k);
  }
  for (const k of [
    "RUN_OUT",
    "OBSTRUCTING_FIELD",
    "HIT_BALL_TWICE",
    "TIMED_OUT",
    "RETIRED_OUT",
  ] as const) {
    assert.equal(creditsBowler(k), false, k);
  }
  // Unknown keeps its old meaning so finished matches don't change.
  assert.equal(creditsBowler(null), true);
  assert.equal(creditsBowler("OTHER"), true);
});

test("only a legal delivery uses up a ball", () => {
  assert.equal(consumesBall({ delivery: "LEGAL" }), true);
  assert.equal(consumesBall({ delivery: "WIDE" }), false);
  assert.equal(consumesBall({ delivery: "NO_BALL" }), false);
  // A Mankad is no delivery at all.
  assert.equal(consumesBall({ delivery: "LEGAL", beforeDelivery: true }), false);
});

test("nobody faces a wide, or a ball that was never bowled", () => {
  assert.equal(isFaced({ delivery: "LEGAL" }), true);
  assert.equal(isFaced({ delivery: "NO_BALL" }), true);
  assert.equal(isFaced({ delivery: "WIDE" }), false);
  assert.equal(isFaced({ delivery: "LEGAL", beforeDelivery: true }), false);
});

test("every no-ball earns a free hit", () => {
  assert.equal(armsFreeHit("NO_BALL"), true);
  assert.equal(armsFreeHit("WIDE"), false);
  assert.equal(armsFreeHit("LEGAL"), false);
});

test("runs land in the right column for each delivery", () => {
  // Off the bat on a legal ball.
  assert.deepEqual(splitRuns({ delivery: "LEGAL", runs: 2 }), {
    team: 2, toStriker: 2, toWideExtras: 0, toNoBallExtras: 0, toBowler: 2, ran: 2,
  });
  // A wide they ran two on: penalty plus both runs, all wides, none the bat's.
  assert.deepEqual(splitRuns({ delivery: "WIDE", runs: 2 }), {
    team: 3, toStriker: 0, toWideExtras: 3, toNoBallExtras: 0, toBowler: 3, ran: 2,
  });
  // A no-ball hit for one with one bye: the bat keeps its run, the bye doesn't.
  assert.deepEqual(splitRuns({ delivery: "NO_BALL", runs: 1, byes: 1 }), {
    team: 3, toStriker: 1, toWideExtras: 0, toNoBallExtras: 2, toBowler: 3, ran: 2,
  });
});

test("the batters cross on an odd number of runs, however they came", () => {
  assert.equal(crossed(splitRuns({ delivery: "LEGAL", runs: 1 }).ran), true);
  assert.equal(crossed(splitRuns({ delivery: "NO_BALL", byes: 1 }).ran), true);
  assert.equal(crossed(splitRuns({ delivery: "WIDE", runs: 2 }).ran), false);
});

// ── the run-out truth table, at the rules level ────────────────────
const pair = { striker: "A", nonStriker: "B", newBatter: "C" } as const;

test("the new batter takes the end the dismissal happened at", () => {
  assert.deepEqual(endsAfterWicket({ ...pair, outBatter: "A", outAtEnd: "STRIKER" }), {
    striker: "C", nonStriker: "B",
  });
  // The case this module exists for.
  assert.deepEqual(endsAfterWicket({ ...pair, outBatter: "A", outAtEnd: "NON_STRIKER" }), {
    striker: "B", nonStriker: "C",
  });
  assert.deepEqual(endsAfterWicket({ ...pair, outBatter: "B", outAtEnd: "NON_STRIKER" }), {
    striker: "A", nonStriker: "C",
  });
  assert.deepEqual(endsAfterWicket({ ...pair, outBatter: "B", outAtEnd: "STRIKER" }), {
    striker: "C", nonStriker: "A",
  });
});

test("omitting the end means their own end, so old logs replay unchanged", () => {
  assert.deepEqual(endsAfterWicket({ ...pair, outBatter: "A" }), {
    striker: "C", nonStriker: "B",
  });
  assert.deepEqual(endsAfterWicket({ ...pair, outBatter: "B" }), {
    striker: "A", nonStriker: "C",
  });
  // And with nobody named, the striker is assumed.
  assert.deepEqual(endsAfterWicket({ striker: "A", nonStriker: "B", newBatter: "C" }), {
    striker: "C", nonStriker: "B",
  });
});

test("with nobody to come in, the dismissal end is left vacant", () => {
  assert.deepEqual(endsAfterWicket({ striker: "A", nonStriker: "B", outBatter: "A" }), {
    striker: null, nonStriker: "B",
  });
  assert.deepEqual(
    endsAfterWicket({ striker: "A", nonStriker: "B", outBatter: "A", outAtEnd: "NON_STRIKER" }),
    { striker: "B", nonStriker: null },
  );
});

// ── what each delivery may produce ─────────────────────────────────
test("a free hit protects the batter from everything off the stumps", () => {
  for (const k of ["BOWLED", "CAUGHT", "LBW", "STUMPED", "HIT_WICKET"] as const) {
    assert.match(dismissalRefusal(k, { freeHit: true }) ?? "", /free hit/i, k);
  }
  assert.equal(dismissalRefusal("RUN_OUT", { freeHit: true }), null);
});

test("a no-ball and a wide each allow their own short list", () => {
  assert.match(dismissalRefusal("BOWLED", { delivery: "NO_BALL" }) ?? "", /no-ball/i);
  assert.equal(dismissalRefusal("RUN_OUT", { delivery: "NO_BALL" }), null);
  assert.match(dismissalRefusal("CAUGHT", { delivery: "WIDE" }) ?? "", /wide/i);
  assert.equal(dismissalRefusal("STUMPED", { delivery: "WIDE" }), null);
});

test("only a run out can happen before the ball is bowled", () => {
  assert.match(dismissalRefusal("BOWLED", { beforeDelivery: true }) ?? "", /before the ball/i);
  assert.equal(dismissalRefusal("RUN_OUT", { beforeDelivery: true }), null);
});

test("an unnamed dismissal is never refused", () => {
  // Old logs have to keep replaying.
  assert.equal(dismissalRefusal(null, { freeHit: true, delivery: "NO_BALL" }), null);
});

test("a bowler is spent once they've bowled their overs", () => {
  assert.equal(bowlerSpent({ ballsBowled: 11, maxOvers: 2 }), false);
  assert.equal(bowlerSpent({ ballsBowled: 12, maxOvers: 2 }), true);
  // No cap configured means no limit.
  assert.equal(bowlerSpent({ ballsBowled: 600, maxOvers: 0 }), false);
  assert.equal(bowlerSpent({ ballsBowled: 600 }), false);
});

/**
 * The web module and its app-side mirror must answer identically.
 *
 * Driven across the whole input grid rather than diffed as text, because
 * what matters is the answers, not the characters. This is the check that
 * makes the copy safe: the two full engines drifted precisely because
 * nothing compared them.
 */
import * as mobile from "../apps/mobile/src/lib/cricket-rules";
import * as web from "../lib/cricket-rules";

const KINDS = [...web.WICKET_KINDS, null] as const;
const DELIVERIES = ["LEGAL", "WIDE", "NO_BALL"] as const;
const ENDS = ["STRIKER", "NON_STRIKER", null] as const;

test("mirror parity: every rule, across every input", () => {
  for (const k of KINDS) {
    assert.equal(mobile.creditsBowler(k as never), web.creditsBowler(k), `creditsBowler ${k}`);
    for (const d of DELIVERIES) {
      for (const free of [true, false]) {
        for (const before of [true, false]) {
          const ctx = { delivery: d, freeHit: free, beforeDelivery: before };
          assert.equal(
            mobile.dismissalRefusal(k as never, ctx as never),
            web.dismissalRefusal(k, ctx),
            `dismissalRefusal ${k} ${d} free=${free} before=${before}`,
          );
        }
      }
    }
  }

  for (const d of DELIVERIES) {
    assert.equal(mobile.armsFreeHit(d as never), web.armsFreeHit(d), `armsFreeHit ${d}`);
    for (const before of [true, false]) {
      assert.equal(
        mobile.consumesBall({ delivery: d as never, beforeDelivery: before }),
        web.consumesBall({ delivery: d, beforeDelivery: before }),
      );
      assert.equal(
        mobile.isFaced({ delivery: d as never, beforeDelivery: before }),
        web.isFaced({ delivery: d, beforeDelivery: before }),
      );
    }
    for (let runs = 0; runs <= 7; runs++) {
      for (const byes of [0, 1, 2]) {
        assert.deepEqual(
          mobile.splitRuns({ delivery: d as never, runs, byes }),
          web.splitRuns({ delivery: d, runs, byes }),
          `splitRuns ${d} ${runs}+${byes}`,
        );
      }
    }
  }

  for (const out of ["A", "B", null] as const) {
    for (const end of ENDS) {
      for (const incoming of ["C", null] as const) {
        const args = {
          striker: "A",
          nonStriker: "B",
          outBatter: out,
          outAtEnd: end,
          newBatter: incoming,
        };
        assert.deepEqual(
          mobile.endsAfterWicket(args as never),
          web.endsAfterWicket(args),
          `endsAfterWicket out=${out} end=${end} in=${incoming}`,
        );
      }
    }
  }

  for (const balls of [0, 5, 6, 11, 12, 13]) {
    for (const cap of [0, 1, 2, 4, null]) {
      assert.equal(
        mobile.bowlerSpent({ ballsBowled: balls, maxOvers: cap }),
        web.bowlerSpent({ ballsBowled: balls, maxOvers: cap }),
        `bowlerSpent ${balls}/${cap}`,
      );
    }
  }
});
