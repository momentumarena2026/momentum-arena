/**
 * Matching a typed phone number to an account.
 *
 * A team registered at the venue was never linked to its captain, and the
 * bill came weeks later as a prize pass that could not be issued. The
 * number was right there on the row the whole time — in a different format
 * from the one on the account.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { last10, matchUserByPhone } from "../lib/phone-match";

test("every way the same number gets typed reduces to the same ten digits", () => {
  for (const raw of [
    "9876543210",
    "+919876543210",
    "919876543210",
    "09876543210",
    "98765 43210",
    "+91 98765-43210",
    "  9876543210  ",
  ]) {
    assert.equal(last10(raw), "9876543210", raw);
  }
});

test("things that are not a mobile number are refused", () => {
  // Too short to identify anyone.
  assert.equal(last10("12345"), null);
  assert.equal(last10(""), null);
  assert.equal(last10(null), null);
  // Indian mobiles start 6-9; a landline would match the wrong person.
  assert.equal(last10("0512345678"), null);
  assert.equal(last10("1234567890"), null);
});

const clientWith = (ids: string[]) => ({
  user: {
    findMany: async (args: { take: number }) =>
      ids.slice(0, args.take).map((id) => ({ id })),
  },
});

test("exactly one account is safe to link", async () => {
  assert.deepEqual(await matchUserByPhone(clientWith(["u1"]), "+919876543210"), {
    kind: "one",
    userId: "u1",
  });
});

test("no account is not an error — they simply haven't signed up", async () => {
  assert.deepEqual(await matchUserByPhone(clientWith([]), "9876543210"), { kind: "none" });
});

test("two accounts are never guessed between", async () => {
  // Linking the wrong one hands a stranger somebody else's passes and
  // booking history, which is worse than leaving it unlinked.
  assert.deepEqual(await matchUserByPhone(clientWith(["u1", "u2"]), "9876543210"), {
    kind: "many",
    count: 2,
  });
});

test("an unusable number never reaches the database", async () => {
  let queried = false;
  const client = {
    user: {
      findMany: async () => {
        queried = true;
        return [];
      },
    },
  };
  assert.deepEqual(await matchUserByPhone(client as never, "123"), { kind: "unusable" });
  assert.equal(queried, false);
});
