/**
 * The awards engine: Player of the Match, Best Batter / Bowler, and the
 * tournament MVP rating.
 *
 * Two kinds of test live here.
 *
 *   PARITY   lib/tournament-awards.ts folds the event log a THIRD time,
 *            separately from lib/tournament-scorecard.ts, because awards
 *            need maidens and fielding credit that no scorecard line
 *            carries. Two folds of one log drift. The parity tests assert
 *            that the figures both folds DO share — runs, balls,
 *            boundaries, wickets, bowler runs — come out identical from
 *            the same events. That is the guard the repo's
 *            "must stay in sync" rule asks for.
 *
 *   RULES    The weights encode judgements (a wicket is worth ~25 runs; a
 *            six-ball cameo is not a strike rate). Those are pinned so a
 *            later tweak is a deliberate, visible change.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AWARD_WEIGHTS,
  computeMatchAwards,
  computeTournamentAwards,
  deriveMatchPerfs,
  emptyPerf,
  awardPoints,
  type MatchPerf,
} from "../lib/tournament-awards";
import { foldScorecard } from "../lib/tournament-scorecard";
import { awardsForMatch } from "../lib/tournament-awards-query";

const HOME = "team-home";
const AWAY = "team-away";

const memberTeam = new Map<string, string>([
  ["amit", HOME],
  ["bala", HOME],
  ["chetan", HOME],
  ["dev", AWAY],
  ["esh", AWAY],
  ["farid", AWAY],
]);

let seq = 0;
type Ev = { seq: number; kind: string; teamId: string | null; memberId: string | null; data: unknown };
const ev = (kind: string, data: Record<string, unknown> = {}, teamId: string | null = null, memberId: string | null = null): Ev => ({
  seq: seq++,
  kind,
  teamId,
  memberId,
  data,
});
const reset = () => {
  seq = 0;
};

const ball = (d: Record<string, unknown> = {}) =>
  ev("BALL", { runs: 0, batterId: "amit", bowlerId: "dev", ...d });

const perfOf = (perfs: MatchPerf[], id: string) =>
  perfs.find((p) => p.memberId === id) ?? emptyPerf(id, "?");

// ── Fold correctness ────────────────────────────────────────────────

test("batting: runs, balls faced, boundaries and the no-ball rule", () => {
  reset();
  const perfs = deriveMatchPerfs(
    "CRICKET",
    [
      ev("INNINGS_START", {}, HOME),
      ball({ runs: 4 }),
      ball({ runs: 6 }),
      ball({ runs: 1 }),
      // A wide is not a ball faced and not the batter's run.
      ball({ runs: 1, extra: "wd" }),
      // A no-ball hit for four: the batter gets 4 and it IS a four.
      ball({ runs: 5, extra: "nb" }),
      // Four byes are not the batter's runs and not a boundary for them.
      ball({ runs: 4, extra: "b" }),
    ],
    memberTeam,
  );
  const amit = perfOf(perfs, "amit");
  assert.equal(amit.batRuns, 4 + 6 + 1 + 4, "byes and wides are not the batter's runs");
  assert.equal(amit.batBalls, 5, "a wide is not a ball faced; a no-ball is");
  assert.equal(amit.fours, 2, "the no-ball struck for four counts as a four");
  assert.equal(amit.sixes, 1);
});

test("bowling: a run-out does not go on the bowler's figures", () => {
  reset();
  const perfs = deriveMatchPerfs(
    "CRICKET",
    [
      ev("INNINGS_START", {}, HOME),
      ball({ wicket: true, dismissal: "bowled", outBatterId: "amit" }),
      ball({ wicket: true, dismissal: "runout", outBatterId: "bala", fielderId: "esh", batterId: "bala" }),
    ],
    memberTeam,
  );
  assert.equal(perfOf(perfs, "dev").wickets, 1, "only the bowled dismissal is the bowler's");
  assert.equal(perfOf(perfs, "esh").runOuts, 1, "the fielder gets the run-out");
});

test("fielding: catches, stumpings and run-outs are credited to the fielder", () => {
  reset();
  const perfs = deriveMatchPerfs(
    "CRICKET",
    [
      ev("INNINGS_START", {}, HOME),
      ball({ wicket: true, dismissal: "caught", outBatterId: "amit", fielderId: "esh" }),
      ball({ wicket: true, dismissal: "stumped", outBatterId: "bala", fielderId: "esh", batterId: "bala" }),
      ball({ wicket: true, dismissal: "runout", outBatterId: "chetan", fielderId: "farid", batterId: "chetan" }),
    ],
    memberTeam,
  );
  assert.equal(perfOf(perfs, "esh").catches, 1);
  assert.equal(perfOf(perfs, "esh").stumpings, 1);
  assert.equal(perfOf(perfs, "farid").runOuts, 1);
});

test("maidens: byes do not break one, a wide does", () => {
  reset();
  // Six legal balls, four byes among them. Byes are not charged to the
  // bowler, so by the Laws this is still a maiden.
  const withByes = deriveMatchPerfs(
    "CRICKET",
    [
      ev("INNINGS_START", {}, HOME),
      ...Array.from({ length: 5 }, () => ball({ runs: 0 })),
      ball({ runs: 4, extra: "b" }),
    ],
    memberTeam,
  );
  assert.equal(perfOf(withByes, "dev").maidens, 1, "byes do not break a maiden");

  reset();
  // A wide IS charged to the bowler, so the over is not a maiden — and it
  // does not count as one of the six legal balls either.
  const withWide = deriveMatchPerfs(
    "CRICKET",
    [
      ev("INNINGS_START", {}, HOME),
      ball({ runs: 1, extra: "wd" }),
      ...Array.from({ length: 6 }, () => ball({ runs: 0 })),
    ],
    memberTeam,
  );
  assert.equal(perfOf(withWide, "dev").maidens, 0, "a wide breaks the maiden");
  assert.equal(perfOf(withWide, "dev").bowlBalls, 6, "the wide is not a legal ball");
});

test("maidens: a part-over at the end of an innings is not a maiden", () => {
  reset();
  const perfs = deriveMatchPerfs(
    "CRICKET",
    [ev("INNINGS_START", {}, HOME), ...Array.from({ length: 4 }, () => ball({ runs: 0 }))],
    memberTeam,
  );
  assert.equal(perfOf(perfs, "dev").maidens, 0, "four dot balls is not an over");
});

test("maidens: an unfinished over is not carried across an innings break", () => {
  reset();
  const perfs = deriveMatchPerfs(
    "CRICKET",
    [
      ev("INNINGS_START", {}, HOME),
      ...Array.from({ length: 3 }, () => ball({ runs: 0 })),
      ev("INNINGS_START", {}, AWAY),
      ...Array.from({ length: 3 }, () => ball({ runs: 0, batterId: "dev", bowlerId: "amit" })),
    ],
    memberTeam,
  );
  assert.equal(perfOf(perfs, "dev").maidens, 0, "three dots either side of the break is not a maiden");
  assert.equal(perfOf(perfs, "amit").maidens, 0);
});

// ── Parity with the scorecard fold ──────────────────────────────────

test("PARITY: awards fold agrees with the scorecard fold on shared figures", () => {
  reset();
  const events: Ev[] = [
    ev("INNINGS_START", {}, HOME),
    ball({ runs: 4 }),
    ball({ runs: 1, extra: "wd" }),
    ball({ runs: 5, extra: "nb" }),
    ball({ runs: 4, extra: "b" }),
    ball({ runs: 2, extra: "lb" }),
    ball({ runs: 6 }),
    ball({ runs: 0 }),
    ball({ wicket: true, dismissal: "caught", outBatterId: "amit", fielderId: "esh" }),
    ball({ runs: 3, batterId: "bala" }),
    ball({ wicket: true, dismissal: "runout", outBatterId: "bala", batterId: "bala", fielderId: "farid" }),
  ];

  const perfs = deriveMatchPerfs("CRICKET", events, memberTeam);
  const teams: Record<string, { id: string; name: string; color: string | null }> = {
    [HOME]: { id: HOME, name: "Home", color: null },
    [AWAY]: { id: AWAY, name: "Away", color: null },
  };
  const card = foldScorecard({
    sport: "CRICKET",
    events: events.map((e) => ({ ...e, createdAt: new Date(0) })),
    nameOf: new Map([
      ["amit", "Amit"], ["bala", "Bala"], ["chetan", "Chetan"],
      ["dev", "Dev"], ["esh", "Esh"], ["farid", "Farid"],
    ]),
    teamOf: (id) => (id ? teams[id] ?? null : null),
  });

  const inn = card.innings[0];
  assert.ok(inn, "the scorecard produced an innings");

  for (const row of inn.batting) {
    const p = perfOf(perfs, row.memberId);
    assert.equal(p.batRuns, row.runs, `batting runs disagree for ${row.name}`);
    assert.equal(p.batBalls, row.balls, `balls faced disagree for ${row.name}`);
    assert.equal(p.fours, row.fours, `fours disagree for ${row.name}`);
    assert.equal(p.sixes, row.sixes, `sixes disagree for ${row.name}`);
  }
  for (const row of inn.bowling) {
    const p = perfOf(perfs, row.memberId);
    assert.equal(p.bowlBalls, row.balls, `bowler balls disagree for ${row.name}`);
    assert.equal(p.bowlRuns, row.runs, `bowler runs disagree for ${row.name}`);
    assert.equal(p.wickets, row.wickets, `wickets disagree for ${row.name}`);
  }
});

// ── Points rules ────────────────────────────────────────────────────

const batPerf = (over: Partial<MatchPerf>): MatchPerf => ({ ...emptyPerf("x", HOME), appeared: true, ...over });

test("a wicket is worth about 25 runs — the anchor the table rests on", () => {
  const batter = batPerf({ batRuns: 25, batBalls: 25 });
  const bowler = batPerf({ bowlBalls: 24, bowlRuns: 24, wickets: 1 });
  assert.equal(AWARD_WEIGHTS.cricket.perWicket, 25);
  // Not exactly equal (bonuses and rate bands differ), but the run-value of
  // a wicket must be in the same league as 25 runs or the two disciplines
  // cannot share one ranking.
  const b = awardPoints("CRICKET", batter).total;
  const w = awardPoints("CRICKET", bowler).total;
  assert.ok(Math.abs(b - w) <= 15, `batter ${b} vs bowler ${w} are not comparable`);
});

test("strike rate is ignored below the sample floor", () => {
  // 12 off 6 is a strike rate of 200, but six balls is a cameo.
  const cameo = awardPoints("CRICKET", batPerf({ batRuns: 12, batBalls: 6 }));
  assert.ok(
    !cameo.lines.some((l) => l.label.startsWith("Strike rate")),
    "a 6-ball innings must not earn a strike-rate bonus",
  );
  // The same rate over enough balls does earn it.
  const real = awardPoints("CRICKET", batPerf({ batRuns: 40, batBalls: 20 }));
  assert.ok(real.lines.some((l) => l.label.startsWith("Strike rate")));
});

test("economy is ignored below two overs", () => {
  const oneOver = awardPoints("CRICKET", batPerf({ bowlBalls: 6, bowlRuns: 1 }));
  assert.ok(!oneOver.lines.some((l) => l.label.startsWith("Economy")));
  const four = awardPoints("CRICKET", batPerf({ bowlBalls: 24, bowlRuns: 8 }));
  assert.ok(four.lines.some((l) => l.label.startsWith("Economy")));
});

test("a duck is only penalised if they were actually out", () => {
  const out = awardPoints("CRICKET", batPerf({ batRuns: 0, batBalls: 3, out: true }));
  const notOut = awardPoints("CRICKET", batPerf({ batRuns: 0, batBalls: 3, out: false }));
  assert.ok(out.total < notOut.total, "being dismissed for nought must cost more than being 0 not out");
});

test("milestones pay once, at the highest reached", () => {
  const fifty = awardPoints("CRICKET", batPerf({ batRuns: 50, batBalls: 40 }));
  const milestoneLines = fifty.lines.filter((l) => l.label.includes("milestone"));
  assert.equal(milestoneLines.length, 1, "a fifty must not also pay the thirty bonus");
  assert.equal(milestoneLines[0].label, "50+ milestone");
});

// ── Match awards ────────────────────────────────────────────────────

test("match awards pick the right three players", () => {
  const perfs: MatchPerf[] = [
    // A big hundred — clear best batter, and the most points overall.
    batPerf({ memberId: "amit", batRuns: 102, batBalls: 60 }),
    // A five-for — clear best bowler.
    batPerf({ memberId: "dev", bowlBalls: 24, bowlRuns: 18, wickets: 5 }),
    batPerf({ memberId: "bala", batRuns: 10, batBalls: 12 }),
  ];
  const a = computeMatchAwards("CRICKET", perfs);
  assert.equal(a.bestBatter?.memberId, "amit");
  assert.equal(a.bestBowler?.memberId, "dev");
  assert.ok(a.playerOfMatch, "someone won it");
  assert.equal(a.rows.length, 3);
});

test("best batter is not awarded to someone who never batted", () => {
  const a = computeMatchAwards("CRICKET", [
    batPerf({ memberId: "dev", bowlBalls: 24, bowlRuns: 10, wickets: 3 }),
  ]);
  assert.equal(a.bestBatter, null, "a bowler-only card has no best batter");
  assert.equal(a.bestBowler?.memberId, "dev");
});

test("a tie for Player of the Match goes to the all-rounder, and is stable", () => {
  // Two players on exactly equal totals: one purely a batter, one whose
  // points come from batting AND fielding.
  //   single : 50 runs off 50 = 50 + 16 (fifty) + 0 (SR 100)      = 66
  //   tuned  : 36 runs off 36 = 36 +  8 (thirty) + 0 (SR 100)     = 44
  //            + 1 stumping (12) + 1 catch (10)                   = 66
  const single = batPerf({ memberId: "zz-single", batRuns: 50, batBalls: 50 });
  const tuned = batPerf({ memberId: "aa-allround", batRuns: 36, batBalls: 36, stumpings: 1, catches: 1 });
  assert.equal(
    awardPoints("CRICKET", single).total,
    awardPoints("CRICKET", tuned).total,
    "fixture must be an exact tie for the tiebreak to be under test",
  );

  const a = computeMatchAwards("CRICKET", [single, tuned]);
  assert.equal(
    a.playerOfMatch?.memberId,
    "aa-allround",
    "on equal points the all-round game should win",
  );
  // Stability: the same input in the other order gives the same winner.
  const b = computeMatchAwards("CRICKET", [tuned, single]);
  assert.equal(a.playerOfMatch?.memberId, b.playerOfMatch?.memberId, "the winner must not depend on input order");
});

test("no attributed players means no awards, not a crash", () => {
  const a = computeMatchAwards("CRICKET", []);
  assert.equal(a.playerOfMatch, null);
  assert.equal(a.bestBatter, null);
  assert.equal(a.bestBowler, null);
  assert.deepEqual(a.rows, []);
});

// ── Tournament awards ───────────────────────────────────────────────

test("MVP ranks on points per match, not total", () => {
  // Steady is good in four matches; Burst is better in two.
  const steady = (i: number) => batPerf({ memberId: "steady", batRuns: 30, batBalls: 25 + i });
  const burst = (i: number) => batPerf({ memberId: "burst", batRuns: 80, batBalls: 50 + i });
  const t = computeTournamentAwards("CRICKET", [
    [steady(0), burst(0)],
    [steady(1), burst(1)],
    [steady(2)],
    [steady(3)],
  ]);
  assert.equal(t.mvp[0].memberId, "burst", "the higher per-match rating must rank first");
  const steadyRow = t.mvp.find((r) => r.memberId === "steady")!;
  assert.ok(steadyRow.totalPoints > 0);
  assert.equal(steadyRow.matches, 4);
});

test("a one-match wonder is held below the qualified players", () => {
  const t = computeTournamentAwards(
    "CRICKET",
    [
      [batPerf({ memberId: "wonder", batRuns: 150, batBalls: 60 }), batPerf({ memberId: "regular", batRuns: 40, batBalls: 30 })],
      [batPerf({ memberId: "regular", batRuns: 40, batBalls: 30 })],
      [batPerf({ memberId: "regular", batRuns: 40, batBalls: 30 })],
    ],
    { minMatches: 2 },
  );
  assert.equal(t.mvp[0].memberId, "regular", "one huge innings must not top the table");
  const wonder = t.mvp.find((r) => r.memberId === "wonder")!;
  assert.equal(wonder.qualified, false);
  assert.ok(wonder.rating > t.mvp[0].rating, "their rating is higher — they are simply not qualified");
});

test("milestone bonuses are per innings, not per tournament", () => {
  // Six innings of 20 is 120 runs but no milestone; one innings of 120 is.
  const spread = computeTournamentAwards(
    "CRICKET",
    Array.from({ length: 6 }, () => [batPerf({ memberId: "p", batRuns: 20, batBalls: 18 })]),
  );
  const single = computeTournamentAwards("CRICKET", [
    [batPerf({ memberId: "p", batRuns: 120, batBalls: 100 })],
    [batPerf({ memberId: "p", batRuns: 0, batBalls: 0 })],
  ]);
  assert.equal(spread.mvp[0].runs, 120);
  assert.equal(single.mvp[0].runs, 120);
  assert.ok(
    single.mvp[0].totalPoints > spread.mvp[0].totalPoints,
    "a hundred must be worth more than six twenties of the same aggregate",
  );
});

test("football MVP uses goals, assists and cards", () => {
  reset();
  const perfs = deriveMatchPerfs(
    "FOOTBALL",
    [
      ev("GOAL", { assistId: "bala" }, HOME, "amit"),
      ev("GOAL", {}, HOME, "amit"),
      ev("CARD", { card: "yellow" }, AWAY, "dev"),
      ev("CARD", { card: "red" }, AWAY, "esh"),
    ],
    memberTeam,
  );
  assert.equal(perfOf(perfs, "amit").goals, 2);
  assert.equal(perfOf(perfs, "bala").assists, 1);
  assert.equal(perfOf(perfs, "dev").yellowCards, 1);
  assert.equal(perfOf(perfs, "esh").redCards, 1);

  const a = computeMatchAwards("FOOTBALL", perfs);
  assert.equal(a.playerOfMatch?.memberId, "amit");
  assert.equal(a.bestBatter, null, "football has no batter award");
  assert.equal(a.bestBowler, null, "football has no bowler award");
});

test("racket sports: untagged points produce no awards at all", () => {
  reset();
  // POINT with a team but no member — the common case when the scorer is
  // only tracking the score.
  const untagged = deriveMatchPerfs(
    "TABLE_TENNIS",
    [ev("POINT", {}, HOME), ev("POINT", {}, HOME), ev("POINT", {}, AWAY)],
    memberTeam,
  );
  assert.deepEqual(untagged, [], "no player tagged means nobody to award");

  reset();
  const tagged = deriveMatchPerfs(
    "TABLE_TENNIS",
    [ev("POINT", {}, HOME, "amit"), ev("POINT", {}, HOME, "amit"), ev("POINT", {}, AWAY, "dev")],
    memberTeam,
  );
  assert.equal(perfOf(tagged, "amit").pointsWon, 2);
  assert.equal(computeMatchAwards("TABLE_TENNIS", tagged).playerOfMatch?.memberId, "amit");
});

test("players from outside the match are ignored", () => {
  reset();
  const perfs = deriveMatchPerfs(
    "CRICKET",
    [ev("INNINGS_START", {}, HOME), ball({ runs: 4, batterId: "stranger" })],
    memberTeam,
  );
  assert.equal(
    perfs.find((p) => p.memberId === "stranger"),
    undefined,
    "a member id not on either side must not create a performance",
  );
  // The bowler on that same delivery IS on the match and must still be folded,
  // so the guard rejects the stranger rather than discarding the ball.
  assert.equal(perfOf(perfs, "dev").bowlRuns, 4);
});

test("a rating can be negative, which every bar chart must clamp", () => {
  // Found in real data: a batter out for 0 off 1 ball and nothing else is
  // a net negative contribution. The engine is right to say so, but an
  // unclamped `width: rating/max * 100%` then goes negative. Both the web
  // Leaders tab and the mobile one clamp at 0; this pins the precondition
  // so nobody "fixes" the negative away without noticing why it mattered.
  const t = computeTournamentAwards("CRICKET", [
    [batPerf({ memberId: "duck", batRuns: 0, batBalls: 1, out: true })],
    [batPerf({ memberId: "duck", batRuns: 0, batBalls: 1, out: true })],
  ]);
  assert.ok(t.mvp[0].rating < 0, "a pair of ducks must rate below zero");
});

// ── The display seam (awardsForMatch) ───────────────────────────────

test("each match award quotes its own discipline, not the whole game", () => {
  // Found in the iOS app: the BEST BATTER card read "13* (10) · 1/14 (0.4)",
  // quoting bowling figures under a batting heading.
  reset();
  const members = new Map([
    ["amit", { id: "amit", name: "Amit", teamId: HOME, teamName: "Home", teamColor: null }],
    ["dev", { id: "dev", name: "Dev", teamId: AWAY, teamName: "Away", teamColor: null }],
  ]);
  const events = [
    ev("INNINGS_START", {}, HOME),
    // Amit: an all-rounder — bats, bowls and takes a catch.
    ...Array.from({ length: 12 }, () => ball({ runs: 4, batterId: "amit", bowlerId: "dev" })),
    ev("BALL", { runs: 0, batterId: "dev", bowlerId: "amit", wicket: true, dismissal: "caught", outBatterId: "dev", fielderId: "amit" }),
  ];
  const a = awardsForMatch({ sport: "CRICKET", events, members });

  assert.match(a.bestBatter!.summary, /^\d+\*? \(\d+\)$/, `batting card must be batting only, got "${a.bestBatter!.summary}"`);
  assert.ok(!a.bestBatter!.summary.includes("/"), "no bowling figures on the batting card");
  // A bowling line is "W/R (overs)" — brackets are expected there; what must
  // NOT appear is the batter's "48 (12)" alongside it.
  assert.match(
    a.bestBowler!.summary,
    /^\d+\/\d+ \(\d+\.\d+\)$/,
    `bowling card must be figures only, got "${a.bestBowler!.summary}"`,
  );
});

test("a manual player of the match wins and is flagged as the organiser's", () => {
  reset();
  const members = new Map([
    ["amit", { id: "amit", name: "Amit", teamId: HOME, teamName: "Home", teamColor: null }],
    ["dev", { id: "dev", name: "Dev", teamId: AWAY, teamName: "Away", teamColor: null }],
  ]);
  const events = [
    ev("INNINGS_START", {}, HOME),
    ...Array.from({ length: 12 }, () => ball({ runs: 6, batterId: "amit", bowlerId: "dev" })),
  ];

  const computed = awardsForMatch({ sport: "CRICKET", events, members });
  assert.equal(computed.playerOfMatch?.memberId, "amit", "the engine would pick the centurion");
  assert.equal(computed.playerOfMatchIsManual, false);

  // The organiser disagrees. Their choice wins, and says so.
  const overridden = awardsForMatch({ sport: "CRICKET", events, members, manualPlayerOfMatchId: "dev" });
  assert.equal(overridden.playerOfMatch?.memberId, "dev", "the organiser's pick must win");
  assert.equal(overridden.playerOfMatchIsManual, true);
  // Best batter is still decided by the maths — the override is POTM only.
  assert.equal(overridden.bestBatter?.memberId, "amit");
});

test("a manual id that is not in the match is ignored, not rendered blank", () => {
  reset();
  const members = new Map([
    ["amit", { id: "amit", name: "Amit", teamId: HOME, teamName: "Home", teamColor: null }],
  ]);
  const events = [ev("INNINGS_START", {}, HOME), ball({ runs: 4, batterId: "amit", bowlerId: "amit" })];
  const a = awardsForMatch({ sport: "CRICKET", events, members, manualPlayerOfMatchId: "ghost" });
  assert.equal(a.playerOfMatch?.memberId, "amit", "falls back to the computed winner");
  assert.equal(a.playerOfMatchIsManual, false);
});
