/**
 * Reading the cafe register.
 *
 * These rows become real orders at real prices, so the rules are tuned
 * the opposite way to the booking bot's: there, a wrong fuzzy match
 * costs one tap, and here it charges a customer for something they did
 * not buy. Refusing to answer is cheap. Guessing is not.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  matchItem,
  normalizeTerm,
  normalizePayment,
  priceMismatch,
  type MenuItem,
} from "../lib/cafe-register/match";

const MENU: MenuItem[] = [
  { id: "wb", name: "Water Bottle", price: 20 },
  { id: "sprite", name: "Sprite", price: 20 },
  { id: "sticks", name: "Sticks Chips", price: 25 },
  { id: "blue", name: "Blue Chips", price: 25 },
  { id: "pasta", name: "Pasta Chips", price: 25 },
  { id: "banta", name: "Banta", price: 10 },
  { id: "coke", name: "Coke", price: 20 },
  { id: "cake", name: "Cake", price: 40 },
];

test("an alias beats everything, because a human decided it", () => {
  // "W.B (F)" is shorthand nobody can decode from the text. Being told
  // once is the entire mechanism — and a told answer must not be
  // second-guessed by a closer spelling.
  const r = matchItem("W.B (F)", MENU, [{ term: "w b (f)", cafeItemId: "wb" }]);
  assert.equal(r.cafeItemId, "wb");
  assert.equal(r.matchSource, "alias");
});

test("the same shorthand written differently still matches", () => {
  // Case, punctuation and spacing vary page to page; none of them change
  // what the item is.
  const aliases = [{ term: "w b (f)", cafeItemId: "wb" }];
  for (const written of ["W.B (F)", "w.b(f)", "  W B  (F) ", "W-B (f)"]) {
    assert.equal(matchItem(written, MENU, aliases).cafeItemId, "wb", written);
  }
});

test("a bracketed suffix is part of the name, not noise", () => {
  // "(P)" may be the difference between two products. Dropping it would
  // silently merge them, and the merge would be invisible.
  assert.notEqual(normalizeTerm("sprite (p)"), normalizeTerm("sprite"));
  const r = matchItem("Sprite (P)", MENU, [{ term: "sprite (p)", cafeItemId: "sprite" }]);
  assert.equal(r.matchSource, "alias");
});

test("an exact menu name needs no alias", () => {
  const r = matchItem("Blue Chips", MENU, []);
  assert.equal(r.cafeItemId, "blue");
  assert.equal(r.matchSource, "exact");
});

test("an obvious misreading is recovered", () => {
  const r = matchItem("Pasta Chps", MENU, []);
  assert.equal(r.cafeItemId, "pasta");
  assert.equal(r.matchSource, "fuzzy");
});

test("short names get NO latitude", () => {
  // "Coke" and "Cake" are one edit apart and both plausible on a menu.
  // One edit of latitude here charges someone 40 for a 20 drink.
  const r = matchItem("Coky", MENU, []);
  assert.equal(r.cafeItemId, null, "must not guess between Coke and Cake");
  assert.equal(r.matchSource, "none");
});

test("a tie is answered with nothing, not a coin flip", () => {
  const menu: MenuItem[] = [
    { id: "a", name: "Masala Chips", price: 25 },
    { id: "b", name: "Masala Chaps", price: 25 },
  ];
  const r = matchItem("Masala Chhps", menu, []);
  assert.equal(r.cafeItemId, null);
});

test("an alias pointing at a deleted item does not match to nothing", () => {
  // The alias survives the item. Returning a match with no item behind
  // it would create an order line referencing a menu row that is gone.
  const r = matchItem("W.B (F)", MENU, [{ term: "w b (f)", cafeItemId: "deleted-id" }]);
  assert.equal(r.cafeItemId, null);
  assert.equal(r.matchSource, "none");
});

test("nothing readable matches nothing", () => {
  for (const junk of ["", "   ", "???"]) {
    assert.equal(matchItem(junk, MENU, []).cafeItemId, null, JSON.stringify(junk));
  }
});

// ── payment ────────────────────────────────────────────────────────

test("a tick in one column is a payment method", () => {
  assert.equal(normalizePayment("cash"), "CASH");
  assert.equal(normalizePayment("Online"), "UPI_QR");
  assert.equal(normalizePayment("UPI"), "UPI_QR");
});

test("an ambiguous mark is left for the admin", () => {
  // A payment method is not something to infer from an unclear pen
  // stroke — it decides which till the money is reconciled against.
  for (const v of [null, undefined, "", "both", "?"]) {
    assert.equal(normalizePayment(v), null, String(v));
  }
});

// ── money ──────────────────────────────────────────────────────────

test("a written price that disagrees with the menu is reported, not resolved", () => {
  // The three causes — a price change, a staff discount, a misread digit
  // — need different responses, so this only surfaces the difference.
  const item = MENU[1]; // Sprite, 20
  assert.equal(priceMismatch(40, 2, item), null, "2 x 20 = 40, no mismatch");
  assert.deepEqual(priceMismatch(30, 1, item), { expected: 20, written: 30 });
  assert.equal(priceMismatch(null, 1, item), null, "nothing written, nothing to check");
});

test("quantity is taken into account before crying mismatch", () => {
  const item = MENU[0]; // Water Bottle, 20
  assert.equal(priceMismatch(60, 3, item), null);
});
