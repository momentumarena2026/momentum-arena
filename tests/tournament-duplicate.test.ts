/**
 * Duplicate-a-tournament: does the copied payload actually satisfy the real
 * create contract?
 *
 * This is the failure mode worth guarding. Every other wizard payload is typed
 * by a human into a form that validates as they go; a duplicate is assembled
 * programmatically from a database row, so a field the admin never touched can
 * arrive invalid — and the error surfaces at submit, on a form they did not
 * fill in. So these tests validate against `wizardSchema` itself, the same
 * object createTournament runs, rather than a restatement of it.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { wizardSchema } from "../lib/tournament-wizard-schema";
import {
  duplicateWizardInput,
  DUPLICABLE_FIELDS,
  COPY_SUFFIX,
  type DuplicableTournament,
} from "../lib/tournament-duplicate";

/** A fully-populated cricket cup, of the shape DUPLICABLE_FIELDS selects. */
function cup(over: Partial<DuplicableTournament> = {}): DuplicableTournament {
  return {
    name: "Momentum Summer Cup",
    sport: "CRICKET",
    format: "POOLS_KNOCKOUT",
    description: "Our flagship eight-a-side cup.",
    rules: "<p>Ten overs a side. <strong>Eight wickets.</strong></p>",
    bannerImageUrl: "https://example.blob.vercel-storage.com/banner.jpg",
    totalTeams: 12,
    poolCount: 4,
    teamsPerPool: 3,
    advancePerPool: 2,
    thirdPlaceMatch: true,
    bracketSeeding: "POOL_ORDER",
    membersPerTeamMin: 8,
    membersPerTeamMax: 11,
    maxOversPerBowler: 2,
    oversPerInnings: 10,
    wicketsPerInnings: 8,
    host: "VENUE",
    organizerName: null,
    organizerPhone: null,
    organizerEmail: null,
    quotedAmount: 0,
    organizerNote: null,
    entryFee: 4000,
    feeMode: "ADVANCE",
    advancePct: 50,
    allowCoupons: true,
    allowRewardPoints: true,
    waitlistEnabled: true,
    pointsWin: 2,
    pointsDraw: 1,
    pointsLoss: 0,
    tiebreakers: ["NRR", "H2H", "SCORE_DIFF"],
    statFields: [
      { key: "runs", label: "Runs" },
      { key: "wickets", label: "Wickets" },
    ],
    prizePool: 50000,
    prizes: [
      { place: "Winner", label: "₹30,000 + Trophy" },
      {
        place: "Runner-up",
        label: "₹20,000 + 10h pass",
        pass: {
          awardTo: 2,
          courtConfigId: "court_abc123",
          totalHours: 10,
          validityDays: 90,
          bands: [{ dayType: "WEEKDAY", timeType: "OFF_PEAK" }],
          name: "Runner-up pass",
        },
      },
    ],
    liveScoringEnabled: true,
    liveScreenPlatform: "BOTH",
    ...over,
  };
}

test("a duplicate satisfies the real create schema", () => {
  const parsed = wizardSchema.safeParse(duplicateWizardInput(cup()));
  assert.ok(
    parsed.success,
    `duplicate rejected by wizardSchema: ${
      parsed.success ? "" : JSON.stringify(parsed.error.issues, null, 2)
    }`,
  );
});

test("every date is cleared, so last season's timeline cannot be inherited", () => {
  // The one genuinely dangerous default: copied dates would produce a
  // tournament whose registration already closed and whose start date is in
  // the past, which the status flow would publish without complaint.
  const d = duplicateWizardInput(cup());
  for (const k of ["regOpenAt", "regCloseAt", "revealAt", "startDate", "endDate"] as const) {
    assert.equal(d[k], "", `${k} must be blank on a duplicate`);
  }
});

test("the copy is named distinctly and never exceeds the schema ceiling", () => {
  assert.equal(
    duplicateWizardInput(cup()).name,
    `Momentum Summer Cup${COPY_SUFFIX}`,
  );

  // 80 is wizardSchema's max. A name already at the ceiling must still
  // produce a payload that validates — the admin never typed this field.
  const long = "x".repeat(80);
  const d = duplicateWizardInput(cup({ name: long }));
  assert.equal(d.name.length, 80);
  assert.ok(wizardSchema.safeParse(d).success, "long-name duplicate must validate");
});

test("scorerCode is never even selected from the database", () => {
  // This payload is serialised into the browser. Reusing last season's code
  // would also let that scorer into the new event.
  assert.ok(
    !Object.prototype.hasOwnProperty.call(DUPLICABLE_FIELDS, "scorerCode"),
    "scorerCode must not be in the duplicate select",
  );
  assert.ok(!("scorerCode" in duplicateWizardInput(cup())));
});

test("identity and child rows are not carried over", () => {
  // A duplicate is a template, not a fork of a running event. These are all
  // owned by createTournament or belong to the source tournament alone.
  const d = duplicateWizardInput(cup()) as Record<string, unknown>;
  for (const k of ["id", "slug", "status", "archivedAt", "createdBy", "teams", "matches", "pools", "slots"]) {
    assert.ok(!(k in d), `${k} must not appear in a duplicate payload`);
  }
});

test("the settings worth copying actually survive", () => {
  // The whole point of the feature: the tedious structural config comes over
  // intact so only the dates and money need revisiting.
  const src = cup();
  const d = duplicateWizardInput(src);
  assert.equal(d.format, "POOLS_KNOCKOUT");
  assert.equal(d.totalTeams, 12);
  assert.equal(d.poolCount, 4);
  assert.equal(d.advancePerPool, 2);
  assert.equal(d.oversPerInnings, 10);
  assert.equal(d.wicketsPerInnings, 8);
  assert.equal(d.entryFee, 4000);
  assert.deepEqual(d.tiebreakers, ["NRR", "H2H", "SCORE_DIFF"]);
  assert.deepEqual(d.statFields, src.statFields);
  assert.deepEqual(d.prizes, src.prizes, "prize passes must survive intact");
  assert.equal(d.rules, src.rules, "rich-text rules must survive intact");
});

test("a third-party hosted event duplicates without inventing a fee", () => {
  const d = duplicateWizardInput(
    cup({
      host: "THIRD_PARTY",
      organizerName: "Acme Sports",
      organizerPhone: "9876543210",
      organizerEmail: "ops@acme.example",
      quotedAmount: 60000,
      organizerNote: "Nets included.",
      entryFee: 0,
      feeMode: "FREE",
    }),
  );
  assert.ok(wizardSchema.safeParse(d).success);
  assert.equal(d.host, "THIRD_PARTY");
  assert.equal(d.organizerName, "Acme Sports");
  assert.equal(d.quotedAmount, 60000);
  assert.equal(d.entryFee, 0);
});

test("nullable text fields become empty strings, not the string 'null'", () => {
  // The wizard's inputs are controlled; a null would make React warn and the
  // field uneditable, and "null" would be worse — it looks typed.
  const d = duplicateWizardInput(
    cup({ description: null, rules: null, bannerImageUrl: null, organizerNote: null }),
  );
  assert.equal(d.description, "");
  assert.equal(d.rules, "");
  assert.equal(d.bannerImageUrl, "");
  assert.ok(wizardSchema.safeParse(d).success);
});

test("every format and sport combination duplicates cleanly", () => {
  for (const format of ["LEAGUE", "KNOCKOUT", "POOLS_KNOCKOUT"]) {
    for (const sport of ["CRICKET", "FOOTBALL", "PICKLEBALL"]) {
      // Non-pool formats legitimately carry zeroed pool maths.
      const pools = format === "POOLS_KNOCKOUT";
      const d = duplicateWizardInput(
        cup({
          format,
          sport,
          poolCount: pools ? 4 : 0,
          teamsPerPool: pools ? 3 : 0,
          advancePerPool: pools ? 2 : 0,
          tiebreakers: sport === "CRICKET" ? ["NRR", "H2H"] : ["H2H", "SCORE_DIFF"],
        }),
      );
      const parsed = wizardSchema.safeParse(d);
      assert.ok(parsed.success, `${sport}/${format} rejected`);
    }
  }
});
