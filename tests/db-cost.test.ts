/**
 * The database-cost gate.
 *
 * In October 2026 the Neon bill doubled because two crons moved to a
 * one-minute schedule. Neon bills COMPUTE TIME and an idle compute
 * suspends only after a few minutes, so a query every sixty seconds
 * meant production never slept. The change was small, well-argued, and
 * its cost was invisible at review time — nothing in CI had an opinion
 * about it.
 *
 * These tests pin the model that now does, and the live schedule it
 * judges. The scenarios are not invented: the first is the actual
 * regression, replayed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cronCost,
  expandField,
  fireMinutes,
  DEFAULT_SUSPEND_SECONDS,
  type CronEntry,
} from "../lib/db-cost";

const c = (schedule: string, path = "/api/cron/x"): CronEntry => ({ path, schedule });

test("the September regression is detected, and named", () => {
  // What shipped on 20-21 Sept: two crons on a one-minute tick.
  const report = cronCost([
    c("* * * * *", "/api/cron/challenge-offers"),
    c("* * * * *", "/api/cron/process-reports"),
    c("30 * * * *", "/api/cron/daily-push"),
  ]);
  assert.equal(report.awakeMinutesPerDay, 1440, "a one-minute cron pins the whole day");
  assert.equal(report.uptimeFraction, 1);
  assert.deepEqual(
    report.alwaysOn.sort(),
    ["/api/cron/challenge-offers", "/api/cron/process-reports"],
    "both culprits must be named, not just the total flagged",
  );
});

test("clustering is cheaper than spreading, which is the whole fix", () => {
  // Four hourly jobs. Same work, same number of invocations — only the
  // minutes differ. This is the counter-intuitive part: the comment in
  // rollup-metrics used to claim the offsets were a courtesy.
  const spread = cronCost([c("0 * * * *"), c("5 * * * *"), c("20 * * * *"), c("30 * * * *")]);
  const together = cronCost([c("30 * * * *"), c("30 * * * *"), c("30 * * * *"), c("30 * * * *")]);
  assert.equal(spread.invocationsPerDay, together.invocationsPerDay, "same amount of work");
  assert.ok(
    spread.awakeMinutesPerDay > together.awakeMinutesPerDay,
    "spreading must cost more, or the model has lost the point",
  );
  assert.equal(together.awakeMinutesPerDay, 120, "24 wakes x 5 min");
  assert.equal(spread.awakeMinutesPerDay, 480, "4 separate windows an hour");
});

test("a 5-minute tick is NOT safe at the 5-minute default", () => {
  // The trap: `*/5` against a 300s suspend window resets the idle timer
  // exactly at the boundary, so it never suspends. An earlier draft of
  // the fix used */5 and would have saved nothing.
  const report = cronCost([c("*/5 * * * *")], DEFAULT_SUSPEND_SECONDS);
  assert.equal(report.awakeMinutesPerDay, 1440);
  assert.deepEqual(report.alwaysOn, ["/api/cron/x"]);
  // ...and is fine once the window is shorter than the gap.
  const shorter = cronCost([c("*/5 * * * *")], 60);
  assert.ok(shorter.awakeMinutesPerDay < 400, "with a 60s window a 5-min tick does suspend");
  assert.deepEqual(shorter.alwaysOn, []);
});

test("the hold wraps past midnight", () => {
  // A 23:58 fire still holds 00:00-00:02 the next day. Every day is the
  // same day, so the wrap folds back to the start rather than being lost.
  const report = cronCost([c("58 23 * * *")], 300);
  assert.equal(report.awakeMinutesPerDay, 5, "2 minutes before midnight + 3 after");
});

test("an unparseable schedule throws rather than scoring zero", () => {
  // Fails CLOSED. A field this cannot read must never be silently
  // treated as "fires rarely" — that is the one direction in which a
  // cost gate lying actually matters.
  for (const bad of ["* * * *", "bogus * * * *", "*/0 * * * *", "70 * * * *", "5-2 * * * *"]) {
    assert.throws(() => fireMinutes(bad), `"${bad}" should be rejected`);
  }
});

test("cron fields expand the way cron does", () => {
  assert.deepEqual(expandField("*/15", 0, 59), [0, 15, 30, 45]);
  assert.deepEqual(expandField("30", 0, 59), [30]);
  assert.deepEqual(expandField("1-4", 0, 59), [1, 2, 3, 4]);
  assert.deepEqual(expandField("0,30", 0, 59), [0, 30]);
  assert.deepEqual(expandField("*", 0, 23).length, 24);
  assert.deepEqual(fireMinutes("30 4 * * *"), [4 * 60 + 30]);
});

test("a weekly job is counted as if it ran daily", () => {
  // Deliberate over-estimate. Day-of-week is ignored, so the gate can be
  // too cautious but never too permissive.
  assert.deepEqual(fireMinutes("30 4 * * 1"), fireMinutes("30 4 * * *"));
});

test("the committed schedule is within the committed baseline", () => {
  // The live gate, also run here so `npm test` fails locally before CI
  // does. If this goes red, either move the new job onto :30 or raise
  // the baseline on purpose — see .github/db-cost-baseline.json.
  const crons: CronEntry[] = JSON.parse(readFileSync("vercel.json", "utf8")).crons ?? [];
  const baseline = JSON.parse(readFileSync(".github/db-cost-baseline.json", "utf8"));
  const report = cronCost(crons);

  assert.deepEqual(
    report.alwaysOn.filter((p) => !baseline.allowAlwaysOnCrons.includes(p)),
    [],
    "a cron would hold the database permanently awake without approval",
  );
  assert.ok(
    report.awakeMinutesPerDay <= baseline.awakeMinutesPerDay,
    `the schedule now costs ${report.awakeMinutesPerDay} awake min/day against a ` +
      `baseline of ${baseline.awakeMinutesPerDay}. Raise the baseline deliberately, ` +
      `with a reason, or move the job onto :30.`,
  );
});

test("the baseline carries an approval, not just a number", () => {
  const baseline = JSON.parse(readFileSync(".github/db-cost-baseline.json", "utf8"));
  for (const field of ["approvedBy", "reviewedOn", "reason"]) {
    assert.ok(
      String(baseline[field] ?? "").trim().length > 0,
      `.github/db-cost-baseline.json is missing \`${field}\` — the baseline is an ` +
        `approval record, and the next person needs to tell a decision from a rubber stamp`,
    );
  }
});
