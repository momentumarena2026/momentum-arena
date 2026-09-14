/**
 * Finding the customer behind a phone number somebody typed at a counter.
 *
 * The same person is stored as 9876543210, +919876543210, 09876543210 and
 * "98765 43210" depending on which form captured them, so an equality
 * check on the raw string finds nobody. Everything here works on the last
 * ten digits, which is the part that actually identifies an Indian mobile.
 *
 * This exists because a tournament team registered at the venue was never
 * linked to its captain's account, and the consequence surfaced weeks
 * later as a prize pass that could not be issued — there was a customer,
 * and a row pointing at them by phone, and no foreign key between the two.
 */

/** The ten digits that identify the subscriber, or null if it isn't one. */
export function last10(raw: string | null | undefined): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  const tail = digits.slice(-10);
  // Indian mobiles start 6–9. Anything else is a landline or a typo, and
  // matching on it would risk attaching the wrong account.
  if (!/^[6-9]\d{9}$/.test(tail)) return null;
  return tail;
}

export type PhoneMatch =
  | { kind: "none" }
  /** Exactly one account — safe to link without asking. */
  | { kind: "one"; userId: string }
  /** Two or more. Never guessed: linking the wrong one hands a stranger
   *  somebody else's passes and booking history. */
  | { kind: "many"; count: number }
  | { kind: "unusable" };

/**
 * Look up the account behind a typed phone number.
 *
 * `client` is passed in rather than imported so the diagnostic scripts,
 * which construct their own PrismaClient against production, use exactly
 * this rule instead of a copy of it.
 */
export async function matchUserByPhone(
  client: {
    user: {
      findMany: (args: {
        where: { phone: { endsWith: string } };
        select: { id: true };
        take: number;
      }) => Promise<{ id: string }[]>;
    };
  },
  raw: string | null | undefined,
): Promise<PhoneMatch> {
  const tail = last10(raw);
  if (!tail) return { kind: "unusable" };
  const users = await client.user.findMany({
    where: { phone: { endsWith: tail } },
    select: { id: true },
    take: 2,
  });
  if (users.length === 0) return { kind: "none" };
  if (users.length > 1) return { kind: "many", count: users.length };
  return { kind: "one", userId: users[0].id };
}
