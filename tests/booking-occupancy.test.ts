/**
 * Who still holds a court, and who does not.
 *
 * The reported case: one booking covering 4–6pm, the customer never turns
 * up, the front desk marks it ABSENT at half past four — and the 5–6pm
 * hour stayed off sale to every customer on the website and the app. The
 * counter could re-sell it, because actions/admin-booking.ts kept its own
 * narrower list; nobody else could.
 *
 * That divergence is the thing these tests pin. There are two questions
 * and they must not be conflated again:
 *
 *   SALE_BLOCKING  does this booking hold the court against a NEW sale?
 *   OCCUPYING      does this booking still exist, to draw and to count?
 *
 * The source-level tests matter as much as the value ones: the bug
 * survived because three files hardcoded their own
 * ["CONFIRMED","PENDING","COMPLETED","ABSENT"] instead of importing the
 * shared rule, so fixing the constant would have missed them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SALE_BLOCKING_BOOKING_STATUSES,
  OCCUPYING_BOOKING_STATUSES,
} from "../lib/availability";

// `npm test` runs `tsx --test tests/*.test.ts` from the repo root, and
// tsx's CJS transform leaves import.meta.dirname undefined — so resolve
// from cwd, which is the repo root for every supported invocation.
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("a no-show does not hold the court against a new sale", () => {
  assert.ok(
    !(SALE_BLOCKING_BOOKING_STATUSES as readonly string[]).includes("ABSENT"),
    "ABSENT must not block a sale — the court is empty and the advance is already forfeit",
  );
});

test("a closed-out session DOES still hold the court", () => {
  // The front desk routinely closes a booking out while the party is
  // still playing. This is the defect 9ca11a42 fixed; do not lose it
  // while fixing the no-show case.
  assert.ok(
    (SALE_BLOCKING_BOOKING_STATUSES as readonly string[]).includes("COMPLETED"),
    "COMPLETED must keep blocking — the party is often still on the court",
  );
  for (const s of ["CONFIRMED", "PENDING"]) {
    assert.ok((SALE_BLOCKING_BOOKING_STATUSES as readonly string[]).includes(s), `${s} must block`);
  }
});

test("a no-show is still on the books, so it still draws and still counts", () => {
  // The admin calendar renders from this one. A re-sold cell with no
  // pill explaining who the other booking was reads as a double-booking
  // bug, and the venue keeps the forfeited advance so the money tiles
  // must keep counting it too.
  assert.ok(
    (OCCUPYING_BOOKING_STATUSES as readonly string[]).includes("ABSENT"),
    "ABSENT must stay on the books for rendering and revenue",
  );
  assert.ok(
    !(OCCUPYING_BOOKING_STATUSES as readonly string[]).includes("CANCELLED"),
    "CANCELLED is the only status that truly disappears",
  );
});

test("the two rules differ by exactly ABSENT, and nothing else", () => {
  const extra = (OCCUPYING_BOOKING_STATUSES as readonly string[]).filter(
    (s) => !(SALE_BLOCKING_BOOKING_STATUSES as readonly string[]).includes(s),
  );
  assert.deepEqual(extra, ["ABSENT"], "any other divergence is a mistake, not a decision");
});

// ── The guard that would have caught the original bug ────────────────

/**
 * Files that decide whether a slot can be SOLD. Every one of them must
 * reach that decision through the shared constant: the customer grid,
 * the hold conflict guard and the write-time check have to agree, or a
 * slot shown as free is refused at checkout — worse than never offering
 * it at all.
 */
const SALE_DECIDING_FILES = [
  "lib/availability.ts",
  "lib/bowling-availability.ts",
  "actions/booking.ts",
  "actions/recurring-booking.ts",
  "actions/equipment.ts",
];

test("no sale-deciding file hardcodes its own status list", () => {
  // Matches a Prisma status filter that spells ABSENT out inline, e.g.
  //   status: { in: ["CONFIRMED", "PENDING", "COMPLETED", "ABSENT"] }
  // lib/availability.ts is allowed to NAME both constants; what nothing
  // may do is write the list out by hand next to a sale query.
  const inlineList = /status:\s*\{\s*in:\s*\[[^\]]*"ABSENT"[^\]]*\]/;
  for (const f of SALE_DECIDING_FILES) {
    const src = read(f);
    assert.ok(
      !inlineList.test(src),
      `${f} hardcodes a status list containing ABSENT — import SALE_BLOCKING_BOOKING_STATUSES instead`,
    );
  }
});

test("every sale-deciding file imports the shared rule", () => {
  for (const f of SALE_DECIDING_FILES) {
    const src = read(f);
    assert.ok(
      src.includes("SALE_BLOCKING_BOOKING_STATUSES"),
      `${f} decides sales but never references SALE_BLOCKING_BOOKING_STATUSES`,
    );
  }
});

test("the admin counter no longer keeps a private copy of the rule", () => {
  // actions/admin-booking.ts used to declare its own narrower list. That
  // private copy WAS the bug: the counter could re-sell a no-show and
  // the customer could not, and nothing made the two agree.
  const src = read("actions/admin-booking.ts");
  assert.ok(
    !/const OCCUPYING_BOOKING_STATUSES\s*=\s*\[/.test(src),
    "admin-booking.ts must not re-declare the occupancy rule; alias the shared one",
  );
  assert.ok(
    src.includes("SALE_BLOCKING_BOOKING_STATUSES"),
    "admin-booking.ts should take the rule from lib/availability.ts",
  );
});

test("the admin calendar still renders from the on-the-books rule", () => {
  const src = read("actions/admin-calendar.ts");
  assert.ok(
    src.includes("OCCUPYING_BOOKING_STATUSES"),
    "the calendar must keep the ABSENT-inclusive rule or no-shows vanish from it",
  );
  assert.ok(
    !src.includes("SALE_BLOCKING_BOOKING_STATUSES"),
    "the calendar is a rendering question, not a sale one",
  );
});
