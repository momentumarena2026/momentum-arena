/**
 * Every hand-written list of sports, pinned against the Prisma enum.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────
 * Adding TABLE_TENNIS in 2026-10 turned up thirty-nine places with the
 * three sports typed out as a literal. Five were `Record<Sport, …>` and
 * the compiler caught them in seconds. The other thirty-four were
 * runtime arrays and local unions, and nothing would have reported a
 * miss: the sport simply would not appear in that picker, that filter,
 * that validator. A coupon scoped to it would have been rejected as
 * invalid by a schema that had never heard of it — and the only symptom
 * would have been a customer saying "it says my code isn't valid".
 *
 * Most of those now derive from one source. A few genuinely cannot:
 *
 *   lib/challenge-rules.ts   pure by design, no database — importing
 *                            Object.values(Sport) would drag the Prisma
 *                            runtime into it.
 *   lib/sport-theme.ts       used by client components, where the
 *                            generated client is dead weight.
 *   apps/mobile/**           the app has no Prisma client at all.
 *
 * Those four keep their literals and are pinned here instead. This test
 * is the thing that fails when somebody adds a sport to schema.prisma
 * and stops there.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Sport } from "@prisma/client";
import { ALL_SPORTS, COURT_CONFIGS, SPORT_INFO } from "../lib/court-config";
import { KNOWN_SPORTS } from "../lib/challenge-rules";
import { ALL_SPORTS as APP_SPORTS } from "../apps/mobile/src/lib/sport-theme";

const enumSports = (Object.values(Sport) as string[]).sort();

test("the canonical web list IS the enum", () => {
  // ALL_SPORTS is Object.values(Sport), so this is a tripwire for the
  // export changing shape rather than a real risk today.
  assert.deepEqual([...ALL_SPORTS].sort(), enumSports);
});

test("challenge-rules has not drifted", () => {
  assert.deepEqual(
    [...KNOWN_SPORTS].sort(),
    enumSports,
    "lib/challenge-rules.ts KNOWN_SPORTS is hand-written — add the new sport there too",
  );
});

test("the mobile app knows every sport", () => {
  // The app cannot import the enum, so this is the only thing standing
  // between a new sport and it being invisible on every phone.
  assert.deepEqual(
    [...APP_SPORTS].sort(),
    enumSports,
    "apps/mobile/src/lib/sport-theme.ts ALL_SPORTS is hand-written — add the new sport there too",
  );
});

test("every sport has display info, so nothing renders blank", () => {
  for (const s of enumSports) {
    const info = SPORT_INFO[s as Sport];
    assert.ok(info, `SPORT_INFO is missing ${s}`);
    assert.ok(info.name.trim().length > 0, `${s} has no display name`);
    assert.ok(info.icon.trim().length > 0, `${s} has no icon`);
  }
});

test("every sport is bookable — it has at least one court config", () => {
  // A sport in the enum with no CourtConfig is a sport that appears in
  // pickers and filters and then has nothing to sell. That is worse
  // than not adding it.
  for (const s of enumSports) {
    const configs = COURT_CONFIGS.filter((c) => c.sport === s);
    assert.ok(configs.length > 0, `${s} has no court config — it would be unbookable`);
  }
});

test("every court config occupies at least one zone", () => {
  // Zones are what stop two sports being sold the same hour. A config
  // with no zones conflicts with nothing and is therefore sellable on
  // top of anything else on the same ground.
  for (const c of COURT_CONFIGS) {
    assert.ok(c.zones.length > 0, `${c.sport} ${c.label} claims no zone`);
  }
});

test("table tennis and pickleball occupy the SAME zone", () => {
  // The single most expensive mistake available in this change: give
  // table tennis its own zone and the one court is sellable twice over
  // at the same hour, to two different customers, with nothing
  // reporting it until both turn up.
  //
  // Asserted as a property of the pair rather than as a literal, so it
  // keeps holding if the zone is ever renamed.
  const tt = COURT_CONFIGS.filter((c) => c.sport === "TABLE_TENNIS");
  const pb = COURT_CONFIGS.filter((c) => c.sport === "PICKLEBALL");
  assert.ok(tt.length > 0 && pb.length > 0);
  for (const t of tt) {
    assert.ok(
      pb.some((p) => p.zones.some((z) => t.zones.includes(z))),
      `${t.label} shares no zone with any pickleball court — the court could be double-sold`,
    );
  }
});

test("football and cricket still share their zones — the precedent this copies", () => {
  // Stated so the table-tennis rule above reads as "the same thing we
  // already do" rather than as a special case.
  const football = COURT_CONFIGS.find((c) => c.sport === "FOOTBALL");
  const cricketFull = COURT_CONFIGS.find(
    (c) => c.sport === "CRICKET" && c.size === "FULL",
  );
  assert.ok(football && cricketFull);
  assert.ok(
    football!.zones.every((z) => cricketFull!.zones.includes(z)),
    "the football field no longer overlaps the cricket one",
  );
});
