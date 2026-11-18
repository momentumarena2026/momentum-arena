/**
 * Re-attributing a corrected venue collection across the instalments it
 * actually arrived in.
 *
 * `BookingSettlement` rows are the ledger for venue-side money: one row
 * per visit, each with its own `receivedAt`. `updateRemainderSplit` is a
 * CORRECTION of how an already-collected balance was recorded — "that
 * Rs.500 was UPI, not cash" — not a new instalment. So it must not
 * append a row dated today: that would move money the customer handed
 * over last Tuesday onto the day someone noticed the typo, which is the
 * exact failure the settlement rows exist to stop.
 *
 * Instead the corrected totals are spread back over the rows that are
 * already there, in proportion to HOW MUCH OF THE BALANCE EACH ONE
 * CLOSED — not in proportion to the individual leg being corrected.
 * That distinction is the whole point. A Rs.1200 balance taken as
 * Rs.300 then Rs.900, corrected from cash to UPI, must stay Rs.300 on
 * the first date and Rs.900 on the second; proportioning by the UPI leg
 * instead would find no prior UPI anywhere and dump all Rs.1200 on the
 * later visit, moving Rs.300 of real money to a day it did not arrive.
 * So a correction changes which COLUMN a row's money sits in, never
 * which DATE. For the case that actually happens — one instalment, one
 * row — this reduces to editing that row in place.
 *
 * Integer rupees throughout, matching the `Payment.remainder*` columns.
 * The newest row absorbs the rounding remainder, so the legs always sum
 * to exactly the target and never to one rupee short.
 */

export interface SettlementLegs {
  cashAmount: number;
  upiAmount: number;
  discountAmount: number;
}

const LEGS = ["cashAmount", "upiAmount", "discountAmount"] as const;

/**
 * Spread `target` across `rows` (OLDEST FIRST) in proportion to how
 * much of the balance each row closed. Returns one set of legs per
 * input row, in the same order.
 *
 * Each row's weight is its whole contribution — cash + UPI + the
 * goodwill cut, since a cut closed part of the balance too — so the
 * weights sum to the balance and a row ends up holding the same share
 * of money it always held, now in the corrected mix of columns.
 *
 * Rows that between them hold nothing (everything was re-attributed
 * away by an earlier correction) have no shares to go by, so the whole
 * target lands on the newest row.
 */
export function reallocateSettlements(
  rows: SettlementLegs[],
  target: SettlementLegs,
): SettlementLegs[] {
  if (rows.length === 0) return [];

  const out: SettlementLegs[] = rows.map(() => ({
    cashAmount: 0,
    upiAmount: 0,
    discountAmount: 0,
  }));
  const last = rows.length - 1;

  const weights = rows.map(
    (r) => r.cashAmount + r.upiAmount + r.discountAmount,
  );
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  for (const leg of LEGS) {
    const want = target[leg];
    if (want <= 0) continue; // already zero in `out`
    if (totalWeight <= 0) {
      out[last][leg] = want;
      continue;
    }
    let given = 0;
    for (let i = 0; i < last; i++) {
      const share = Math.floor((weights[i] * want) / totalWeight);
      out[i][leg] = share;
      given += share;
    }
    // The newest row takes the rounding remainder, so the legs sum to
    // the target to the rupee rather than landing a rupee short.
    out[last][leg] = want - given;
  }

  return out;
}

/**
 * Rupees that actually moved in an instalment. The goodwill-discount leg
 * is deliberately excluded — it is a reason the balance closed, not
 * money, and `Payment.amount` excludes it for the same reason.
 */
export function settlementAmount(legs: SettlementLegs): number {
  return legs.cashAmount + legs.upiAmount;
}

/**
 * Headline method for display. Mirrors `CafeOrderSettlement.method`:
 * convenience only, with the per-leg columns as the truth. A tie goes to
 * CASH, as it does on the cafe side.
 */
export function settlementMethod(legs: SettlementLegs): "CASH" | "UPI_QR" {
  return legs.upiAmount > legs.cashAmount ? "UPI_QR" : "CASH";
}
