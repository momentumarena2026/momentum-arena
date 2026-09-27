/**
 * Loser pays.
 *
 * The feature is a signal between two captains and nothing else: both
 * sides still pay their half in advance, and the losing side hands the
 * winner's half back on the ground afterwards. The arena is not party
 * to it.
 *
 * So the property these tests exist to protect is not really any single
 * rule — it is that NOTHING here can stop a match happening. The last
 * test in this file is the important one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loserPaysState,
  loserPaysToggleRefusal,
  loserPaysAnswerRefusal,
  loserPaysPhrase,
  type ChallengeStatus,
} from "../lib/challenge-rules";

const POSTER = "user-poster";
const ACCEPTOR = "user-acceptor";
const STRANGER = "user-stranger";

const challenge = (over: Partial<{
  status: ChallengeStatus;
  createdByUserId: string;
  acceptedByUserId: string | null;
  loserPays: boolean;
  loserPaysAgreed: boolean | null;
}> = {}) => ({
  status: "OPEN" as ChallengeStatus,
  createdByUserId: POSTER,
  acceptedByUserId: null as string | null,
  loserPays: true,
  loserPaysAgreed: null as boolean | null,
  ...over,
});

// ── State ──────────────────────────────────────────────────────────────

test("the four states are distinguishable, and 'declined' is not 'never asked'", () => {
  assert.equal(loserPaysState({ loserPays: false, loserPaysAgreed: null }), "NOT_PROPOSED");
  assert.equal(loserPaysState({ loserPays: true, loserPaysAgreed: null }), "PROPOSED");
  assert.equal(loserPaysState({ loserPays: true, loserPaysAgreed: true }), "AGREED");
  assert.equal(loserPaysState({ loserPays: true, loserPaysAgreed: false }), "DECLINED");
});

test("an answer on a proposal that was withdrawn reads as never proposed", () => {
  // The poster turned it off again before anyone took the match. The
  // stale answer must not resurrect the terms.
  assert.equal(loserPaysState({ loserPays: false, loserPaysAgreed: true }), "NOT_PROPOSED");
});

// ── The poster's toggle ────────────────────────────────────────────────

test("the poster can set it freely while nobody has taken the match", () => {
  assert.equal(loserPaysToggleRefusal(challenge(), POSTER, false), null);
  assert.equal(loserPaysToggleRefusal(challenge({ status: "COUNTERED" }), POSTER, false), null);
});

test("nobody but the poster can set it", () => {
  assert.match(loserPaysToggleRefusal(challenge(), ACCEPTOR, false) ?? "", /captain who posted/);
  assert.match(loserPaysToggleRefusal(challenge(), STRANGER, false) ?? "", /captain who posted/);
});

test("it locks the moment somebody has taken the match", () => {
  // The rule worth arguing about. A poster who could flip this after
  // the fact would be changing terms the other captain already agreed
  // to and paid against — from their phone, with the other side finding
  // out at the ground.
  assert.match(
    loserPaysToggleRefusal(challenge({ acceptedByUserId: ACCEPTOR }), POSTER, false) ?? "",
    /terms are fixed now/,
  );
  // ...and a placed payment locks it even before an acceptor is named,
  // because money has already moved against the terms as posted.
  assert.match(
    loserPaysToggleRefusal(challenge(), POSTER, true) ?? "",
    /terms are fixed now/,
  );
});

test("a dead match cannot have its terms edited", () => {
  for (const status of ["EXPIRED", "WITHDRAWN", "SLOT_LOST"] as ChallengeStatus[]) {
    assert.match(loserPaysToggleRefusal(challenge({ status }), POSTER, false) ?? "", /no longer live/);
  }
});

// ── The acceptor's answer ──────────────────────────────────────────────

test("there is nothing to answer when it was never proposed", () => {
  assert.match(
    loserPaysAnswerRefusal(challenge({ loserPays: false }), ACCEPTOR) ?? "",
    /not posted as loser-pays/,
  );
});

test("the poster does not answer their own proposal", () => {
  assert.match(loserPaysAnswerRefusal(challenge(), POSTER) ?? "", /other captain answers/);
});

test("an answer cannot be given twice", () => {
  assert.equal(loserPaysAnswerRefusal(challenge(), ACCEPTOR), null);
  assert.match(
    loserPaysAnswerRefusal(challenge({ loserPaysAgreed: true }), ACCEPTOR) ?? "",
    /already been answered/,
  );
  // Declining is an answer too — it must not be re-openable.
  assert.match(
    loserPaysAnswerRefusal(challenge({ loserPaysAgreed: false }), ACCEPTOR) ?? "",
    /already been answered/,
  );
});

// ── The words ──────────────────────────────────────────────────────────

test("each captain is told the thing that is true for them", () => {
  assert.match(loserPaysPhrase("PROPOSED", "poster", 500) ?? "", /Whoever takes the match will answer/);
  assert.match(loserPaysPhrase("PROPOSED", "stranger", 500) ?? "", /They have asked for loser-pays/);
  assert.match(loserPaysPhrase("DECLINED", "poster", 500) ?? "", /did not want loser-pays/);
  assert.match(loserPaysPhrase("DECLINED", "acceptor", 500) ?? "", /You turned loser-pays down/);
});

test("the agreed message names the actual amount, because 'settle up' is not actionable", () => {
  const said = loserPaysPhrase("AGREED", "acceptor", 500) ?? "";
  assert.match(said, /₹500/);
  assert.match(said, /arena is not involved/);
});

test("a missing amount degrades to words rather than rendering a broken figure", () => {
  const said = loserPaysPhrase("AGREED", "poster", null) ?? "";
  assert.match(said, /their half/);
  assert.doesNotMatch(said, /₹/);
  assert.doesNotMatch(said, /null|NaN|undefined/);
});

test("large amounts are grouped the Indian way", () => {
  assert.match(loserPaysPhrase("AGREED", "poster", 120000) ?? "", /₹1,20,000/);
});

test("nothing is said when nothing was proposed", () => {
  for (const v of ["poster", "acceptor", "stranger"] as const) {
    assert.equal(loserPaysPhrase("NOT_PROPOSED", v, 500), null);
  }
});

test("a stranger is never told to hand money to anybody", () => {
  // They are not in the match. They may see that terms exist, so they
  // can decide whether to take it — but not an instruction.
  const said = loserPaysPhrase("AGREED", "stranger", 500) ?? "";
  assert.match(said, /agreed by both captains/i);
  assert.doesNotMatch(said, /hands/);
});

// ── The property that matters ──────────────────────────────────────────

test("NOTHING here can stop a match being posted, taken or played", () => {
  // The guarantee the venue was given: loser-pays is communication, and
  // the payment structure is untouched. These functions may refuse an
  // EDIT to the terms and an ANSWER to the question. Neither of those
  // is a booking. If someone ever makes one of them gate a payment,
  // this test is where the argument should happen.
  //
  // Asserted structurally: every refusal string below is about the
  // terms, and none mentions paying, booking or the court.
  const refusals = [
    loserPaysToggleRefusal(challenge(), ACCEPTOR, false),
    loserPaysToggleRefusal(challenge({ acceptedByUserId: ACCEPTOR }), POSTER, false),
    loserPaysToggleRefusal(challenge({ status: "EXPIRED" }), POSTER, false),
    loserPaysAnswerRefusal(challenge({ loserPays: false }), ACCEPTOR),
    loserPaysAnswerRefusal(challenge(), POSTER),
    loserPaysAnswerRefusal(challenge({ loserPaysAgreed: true }), ACCEPTOR),
  ].filter((r): r is string => r !== null);

  assert.equal(refusals.length, 6, "every case above should refuse");
  for (const r of refusals) {
    assert.doesNotMatch(r, /\bpay(ment)?\b(?!-pays)/i, `"${r}" sounds like it blocks money`);
    assert.doesNotMatch(r, /\bbook(ing)?\b/i, `"${r}" sounds like it blocks a booking`);
    assert.doesNotMatch(r, /\bcourt\b/i, `"${r}" sounds like it blocks a court`);
  }
});
