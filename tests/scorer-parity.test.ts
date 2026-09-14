/**
 * The scoring PADS must offer what the engine accepts.
 *
 * A capability that exists in the engine and not on the pad is a
 * capability nobody has. Exactly that happened: the engine took
 * `{t:"WIDE", runs:3}` from the day it was written, the tournament console
 * offered wd/+1/+2/+3/+4, and both casual pads offered only a bare wide —
 * so a wide they ran three off could not be entered at all. Nothing
 * compared the surfaces, so nothing noticed.
 *
 * These read the actual pad sources and assert the controls are present.
 * Crude, deliberately: a test that imports and renders three React trees
 * across two platforms would be the thing nobody maintains.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXTRA_RUN_OPTIONS } from "../lib/cricket-rules";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const PADS = {
  "casual app": "apps/mobile/src/screens/match/MatchScoreScreen.tsx",
  "casual web": "app/match/[code]/score-client.tsx",
  "tournament app": "apps/mobile/src/screens/tournaments/ScorerConsoleScreen.tsx",
  "tournament web": "app/score/[code]/scorer-console.tsx",
};

test("the shared extras options cover every kind of extra", () => {
  assert.deepEqual(
    EXTRA_RUN_OPTIONS.map((r) => r.kind),
    ["WIDE", "NO_BALL", "BYE", "LEG_BYE"],
  );
  // Every kind must offer runs beyond the bare delivery, or the pad is
  // back to where it started.
  for (const row of EXTRA_RUN_OPTIONS) {
    assert.ok(
      row.options.some((o) => o.ran > 0),
      `${row.kind} must offer runs, not just the bare extra`,
    );
  }
});

test("both casual pads render the shared extras options", () => {
  // The tournament consoles predate the shared list and carry their own
  // equivalent grid; these two are the ones that had nothing.
  for (const name of ["casual app", "casual web"] as const) {
    const src = read(PADS[name]);
    assert.match(
      src,
      /EXTRA_RUN_OPTIONS/,
      `${name} must drive its extras from the shared options`,
    );
  }
});

test("every pad can record runs that beat the bat off a no-ball", () => {
  for (const name of ["casual app", "casual web"] as const) {
    const src = read(PADS[name]);
    assert.match(src, /byes:/, `${name} must be able to log no-ball byes`);
  }
});

test("every pad that records a wicket can say which end a run out was", () => {
  for (const name of ["casual app", "tournament app", "tournament web"] as const) {
    const src = read(PADS[name]);
    assert.match(src, /outAtEnd/, `${name} must ask which end`);
    assert.match(src, /beforeDelivery/, `${name} must be able to log a Mankad`);
  }
});

test("every console can retire a batter out, not only hurt", () => {
  for (const name of ["casual app", "tournament app", "tournament web"] as const) {
    const src = read(PADS[name]);
    assert.match(src, /out: true|out\b/, `${name} must offer retired out`);
  }
});

test("every surface that shows a scoreboard shows the free hit", () => {
  for (const name of ["casual app", "tournament app", "tournament web"] as const) {
    const src = read(PADS[name]);
    assert.match(src, /freeHit/i, `${name} must show the free hit`);
  }
});
