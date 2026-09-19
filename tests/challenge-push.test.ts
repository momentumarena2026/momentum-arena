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
  PUSH_VARIABLES,
  type PushVars,
  resolvePushes,
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

test("a fractional nudge marker is refused, because Int[] would round it", () => {
  // The bug this guards: remindedAt is an Int[], so 10.5 stores as 11 and
  // `alreadySent.includes(10.5)` is false forever — a per-minute cron then
  // sends the same push every minute for the life of the offer.
  assert.match(
    pushScheduleRefusal([{ minsLeft: 10.5, title: "t", body: "b" }], 30) ?? "",
    /whole positive number/,
  );
  assert.equal(pushScheduleRefusal([{ minsLeft: 10, title: "t", body: "b" }], 30), null);
});

test("a nudge is deduped by its exact stored marker", () => {
  // Integer markers round-trip through Int[] unchanged, so a sent marker
  // always matches on the next tick.
  const t = [{ minsLeft: 10, title: "t", body: "b" }];
  assert.equal(pushesDue({ templates: t, minsLeft: 9, alreadySent: [10] }).length, 0);
  assert.equal(pushesDue({ templates: t, minsLeft: 9, alreadySent: [] }).length, 1);
});

test("the admin screen's defaults are the lib's defaults, not a copy", () => {
  // These WERE duplicated into challenges-admin.tsx and had already drifted:
  // three of the six bodies lost their {date} placeholder, so the venue
  // proofread and previewed copy that was not what sent. The screen now
  // imports these; this asserts the shape they must keep.
  for (const t of [DEFAULT_WON_PUSH, ...DEFAULT_ADJACENT_PUSHES, ...DEFAULT_FALLBACK_PUSHES]) {
    assert.ok(t.title.trim().length > 0 && t.body.trim().length > 0);
    assert.ok(t.title.length <= 120, `title too long to send: ${t.title}`);
    assert.ok(t.body.length <= 300, `body too long to send: ${t.body}`);
  }
  // Every adjacent template names the day. "8pm–9pm is yours" with no date
  // is unreadable for a match two days out.
  for (const t of [DEFAULT_WON_PUSH, ...DEFAULT_ADJACENT_PUSHES]) {
    assert.ok(t.body.includes("{date}"), `no {date} in: ${t.body}`);
  }
});

test("every advertised variable is one renderPush can actually fill", () => {
  const sample = Object.fromEntries(PUSH_VARIABLES.map((v) => [v.name, v.example]));
  for (const v of PUSH_VARIABLES) {
    const out = renderPush(`{${v.name}}`, sample as never);
    assert.equal(out, v.example, `${v.name} did not substitute`);
  }
});

test("the built-in schedule is judged against the window, not skipped", () => {
  // Same regression on the other side: with no stored schedule, the built-in
  // nudges are what fire, so a 3-minute window must be refused against them.
  assert.ok(pushScheduleRefusal(DEFAULT_ADJACENT_PUSHES, 3));
  assert.ok(pushScheduleRefusal(DEFAULT_FALLBACK_PUSHES, 20));
  assert.equal(pushScheduleRefusal(DEFAULT_ADJACENT_PUSHES, 30), null);
});

test("a nudge ladder is trimmed to the offer's REAL window", () => {
  // spinFor clamps expiry to the start of the hour being sold, so a spin
  // ten minutes before that hour gets a ten-minute offer however long the
  // setting says. An untrimmed 30-minute ladder fires its whole length in
  // the first tick and consumes the markers that still mattered.
  const room = 10;
  const trimmed = DEFAULT_ADJACENT_PUSHES.filter((t) => (t.minsLeft ?? 0) < room);
  assert.deepEqual(trimmed.map((t) => t.minsLeft), [5]);
  const due = pushesDue({ templates: trimmed, minsLeft: 9, alreadySent: [] });
  assert.deepEqual(due.map((t) => t.minsLeft), []);
  assert.deepEqual(
    pushesDue({ templates: trimmed, minsLeft: 5, alreadySent: [] }).map((t) => t.minsLeft),
    [5],
  );
});

test("ABSENT means the built-in schedule; EMPTY means the venue turned nudges off", () => {
  // Collapsing these two made "no nudges" an unreachable configuration and
  // handed the venue's copy back to constants in the code — the one thing
  // this module was asked not to do.
  assert.deepEqual(resolvePushes(null, DEFAULT_ADJACENT_PUSHES), DEFAULT_ADJACENT_PUSHES);
  assert.deepEqual(resolvePushes(undefined, DEFAULT_ADJACENT_PUSHES), DEFAULT_ADJACENT_PUSHES);
  assert.deepEqual(resolvePushes("junk", DEFAULT_ADJACENT_PUSHES), DEFAULT_ADJACENT_PUSHES);
  assert.deepEqual(resolvePushes([], DEFAULT_ADJACENT_PUSHES), []);
  const custom = [{ minsLeft: 3, title: "t", body: "b" }];
  assert.deepEqual(resolvePushes(custom, DEFAULT_ADJACENT_PUSHES), custom);
});

test("the window is judged against the schedule that SENDS, whatever is stored", () => {
  for (const stored of [null, undefined, "junk"]) {
    assert.ok(
      pushScheduleRefusal(resolvePushes(stored, DEFAULT_ADJACENT_PUSHES), 3),
      `a 3-minute window must refuse the effective schedule for ${JSON.stringify(stored)}`,
    );
  }
  // An empty schedule fits any window — there is nothing to fire.
  assert.equal(pushScheduleRefusal(resolvePushes([], DEFAULT_ADJACENT_PUSHES), 1), null);
});
