/**
 * The promo's copy and its nudge schedule (lib/challenge-push.ts).
 *
 * These exist because every string and every timing in this promo belongs
 * to the venue, and the two ways that goes wrong are both silent: a nudge
 * configured outside its own window never fires and nothing says so, and a
 * cron that skips a minute quietly eats the last-call push — the one that
 * actually converts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  renderPush,
  pushesDue,
  pushScheduleRefusal,
  DEFAULT_ADJACENT_PUSHES,
  DEFAULT_FALLBACK_PUSHES,
  DEFAULT_WON_PUSH,
  type PushVars,
} from "../lib/challenge-push";

const vars: PushVars = {
  minsLeft: 5,
  pct: 20,
  price: 1600,
  saving: 400,
  hour: "9pm–10pm",
  date: "Sun, 20 Sep",
  court: "Full Field",
};

test("every placeholder the admin screen advertises actually resolves", () => {
  const all = "{minsLeft}|{pct}|{price}|{saving}|{hour}|{date}|{court}";
  assert.equal(renderPush(all, vars), "5|20|1600|400|9pm–10pm|Sun, 20 Sep|Full Field");
});

test("an unknown placeholder is left alone, not turned into 'undefined'", () => {
  // A typo in the venue's copy should read as a typo to whoever proofreads
  // the notification, not as a bug in the promo.
  assert.equal(renderPush("Hi {nmae}, {pct}% off", vars), "Hi {nmae}, 20% off");
  assert.equal(renderPush("no placeholders here", vars), "no placeholders here");
});

test("the shipped default copy renders with no leftovers", () => {
  for (const t of [DEFAULT_WON_PUSH, ...DEFAULT_ADJACENT_PUSHES, ...DEFAULT_FALLBACK_PUSHES]) {
    for (const s of [t.title, t.body]) {
      const out = renderPush(s, vars);
      assert.ok(!/\{\w+\}/.test(out), `unresolved placeholder in: ${out}`);
    }
  }
});

test("a nudge fires once, when its marker is reached", () => {
  const t = DEFAULT_ADJACENT_PUSHES; // 15 and 5
  assert.deepEqual(pushesDue({ templates: t, minsLeft: 20, alreadySent: [] }), []);
  assert.deepEqual(
    pushesDue({ templates: t, minsLeft: 15, alreadySent: [] }).map((x) => x.minsLeft),
    [15],
  );
  // Already sent the 15 — do not send it again a minute later.
  assert.deepEqual(
    pushesDue({ templates: t, minsLeft: 14, alreadySent: [15] }).map((x) => x.minsLeft),
    [],
  );
});

test("a cron that skipped minutes still sends the last call, most urgent first", () => {
  // The scheduler stalled from 16 minutes left to 4. Both markers are
  // overdue; the player must get the one that still means something.
  const due = pushesDue({ templates: DEFAULT_ADJACENT_PUSHES, minsLeft: 4, alreadySent: [] });
  assert.deepEqual(due.map((x) => x.minsLeft), [5, 15]);
});

test("nothing is sent once the offer is dead", () => {
  // A "5 minutes left" push arriving after expiry is worse than silence:
  // the player taps it and finds nothing there.
  for (const minsLeft of [0, -1, -60]) {
    assert.deepEqual(pushesDue({ templates: DEFAULT_ADJACENT_PUSHES, minsLeft, alreadySent: [] }), []);
  }
});

test("a nudge that could never fire inside its own window is refused", () => {
  // The silent failure this whole check exists for.
  assert.match(
    pushScheduleRefusal([{ minsLeft: 60, title: "t", body: "b" }], 30) ?? "",
    /never fire inside a 30-minute offer/,
  );
  assert.equal(pushScheduleRefusal(DEFAULT_ADJACENT_PUSHES, 30), null);
  assert.equal(pushScheduleRefusal(DEFAULT_FALLBACK_PUSHES, 120), null);
  // The defaults must fit the windows they ship with.
  assert.equal(pushScheduleRefusal(DEFAULT_FALLBACK_PUSHES, 61), null);
});

test("malformed schedules are refused with something the admin can act on", () => {
  assert.match(pushScheduleRefusal([{ minsLeft: 0, title: "t", body: "b" }], 30) ?? "", /positive/);
  assert.match(pushScheduleRefusal([{ minsLeft: 5, title: "", body: "b" }], 30) ?? "", /title and a body/);
  assert.match(
    pushScheduleRefusal(
      [
        { minsLeft: 5, title: "a", body: "b" },
        { minsLeft: 5, title: "c", body: "d" },
      ],
      30,
    ) ?? "",
    /Two nudges are both set to 5/,
  );
  assert.equal(pushScheduleRefusal([], 30), null); // no nudges is a valid choice
});
