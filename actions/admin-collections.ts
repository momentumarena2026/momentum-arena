"use server";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireSuperadmin } from "@/lib/admin-auth";

/**
 * Cash vs online, day by day — the till-and-bank tally.
 *
 * Answers the question the P&L deliberately does not: not "what did we
 * earn" but "what did I physically take in notes today, and what landed
 * in the account". Those are different numbers and it is the second pair
 * that gets reconciled against a cash box and a bank statement.
 *
 * ── Basis: MONEY RECEIVED, not revenue recognised ───────────────────
 *
 * The Overall P&L books booking income on the PLAY date and cafe income
 * on the order date, because that is the right basis for profit. This
 * report books every rupee on the day it actually changed hands, which
 * is the only basis a tally can use. The two will not agree, by design —
 * an advance taken in October for a November game is October money here
 * and November income there.
 *
 * It also counts what was COLLECTED, never what was owed: a goodwill
 * discount on the floor is not money, so it never appears.
 *
 * ── Where each rupee's date comes from ──────────────────────────────
 *
 *  Bookings, advance   Payment.confirmedAt, method = Payment.method
 *  Bookings, remainder the LAST REMAINDER_COLLECTED edit-history row for
 *                      that booking; amounts from the structured
 *                      remainderCash/UpiAmount columns, never parsed out
 *                      of the note text
 *  Passes              UserPass.purchasedAt
 *  Tournaments         TournamentTeam.paidAt / OrganizerPayment.receivedAt
 *  Camps               CampRegistration.paidAt
 *  Cafe, at counter    CafePayment.confirmedAt, split across its
 *                      splitCash/splitUpiAmount when it was mixed
 *  Cafe, settled later CafeOrderSettlement.receivedAt
 *
 * The booking remainder is the one with a story. Payment.confirmedAt is
 * stamped when the ADVANCE is confirmed and is then left alone, so it
 * cannot date money handed over at the venue days later — and about a
 * quarter of booking income arrives that way. The collection event IS
 * timestamped, in BookingEditHistory, but its amounts live only inside a
 * generated sentence ("Rs.200 Cash + Rs.500 UPI QR"). So this takes the
 * DATE from the history row and the AMOUNTS from the real columns: no
 * string parsing, nothing that a reworded note could silently break.
 *
 * 19 of 671 bookings were collected over two visits rather than one.
 * Their whole remainder is dated to the later visit, because the
 * per-visit amounts exist only in those sentences. `splitRemainders` on
 * the result reports how many rows that affected, so the approximation
 * is visible rather than assumed away.
 *
 * ── Unattributed ────────────────────────────────────────────────────
 *
 * Money whose method was never recorded is NOT quietly folded into
 * either column — it gets its own, because the point of this screen is
 * reconciliation and a number in the wrong column is worse than a
 * number you can see is missing. (Production has one such row: a ₹2,400
 * pass from 22 Aug with no method and no gateway id.)
 *
 * All amounts are RUPEES at every source. Verified against production
 * rather than taken from the column comments — the P&L header's claim
 * that CafePayment is in paise is stale and wrong.
 */

const IST_SHIFT = Prisma.sql`interval '330 minutes'`;

/**
 * Method string -> column. Deliberately a SQL CASE rather than a TS map:
 * the classification has to happen in the same pass that sums, or every
 * row comes back to Node just to be bucketed.
 *
 * TournamentTeam.paymentMethod is a free-text String, not the enum, and
 * production holds UPI_DQR and STATIC_QR in it — both online, neither a
 * PaymentMethod value. Matching on text covers the enum sources too.
 *
 * FREE and PASS are money that never moved: a comped pass, or a booking
 * paid by debiting hours whose cash arrived when the pass was bought.
 * They are dropped, not zeroed, so they cannot dilute an average.
 */
function channelCase(col: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN ${col} = 'CASH' THEN 'CASH'
      WHEN ${col} IN ('RAZORPAY','PHONEPE','UPI_QR','UPI_DQR','STATIC_QR') THEN 'ONLINE'
      ELSE 'UNATTRIBUTED'
    END`;
}

export interface CollectionsSplit {
  cash: number;
  online: number;
  unattributed: number;
  total: number;
}

export interface CollectionsDay extends CollectionsSplit {
  /** IST calendar day, "YYYY-MM-DD". */
  date: string;
  /**
   * The same day broken down by where the money came from, biggest
   * first — "₹1,000 cash yesterday" being ₹700 bookings and ₹300 cafe.
   * Carried per day rather than derived in the browser so the expanded
   * rows cannot disagree with the day totals above them.
   */
  sources: (CollectionsSplit & { source: string })[];
}

export interface CollectionsResult {
  days: CollectionsDay[];
  totals: { cash: number; online: number; unattributed: number; total: number };
  /** Same split per income stream, for the period as a whole. */
  bySource: {
    source: string;
    cash: number;
    online: number;
    unattributed: number;
    total: number;
  }[];
  /** Bookings whose remainder came in over two visits — see the header. */
  splitRemainders: number;
  from: string;
  to: string;
}

type Row = {
  day: string;
  channel: "CASH" | "ONLINE" | "UNATTRIBUTED";
  source: string;
  amount: number;
};

export async function getCollections(input: {
  from: string;
  to: string;
}): Promise<
  { success: true; data: CollectionsResult } | { success: false; error: string }
> {
  await requireSuperadmin();

  const bare = /^\d{4}-\d{2}-\d{2}$/;
  if (!bare.test(input.from) || !bare.test(input.to)) {
    return { success: false, error: "Dates must look like 2026-11-18" };
  }
  if (input.from > input.to) {
    return { success: false, error: "The start date is after the end date" };
  }

  // Inclusive IST day bounds, as UTC instants. IST midnight is 18:30 UTC
  // the previous day — the single most common way to lose a day's
  // takings off the end of a report.
  const fromUtc = new Date(Date.parse(`${input.from}T00:00:00.000Z`) - 330 * 60000);
  const toUtc = new Date(Date.parse(`${input.to}T23:59:59.999Z`) - 330 * 60000);

  // The last collection visit per booking: the date the venue-side money
  // actually arrived.
  const lastCollection = Prisma.sql`
    SELECT "bookingId", MAX("createdAt") AS collected_at
    FROM "BookingEditHistory"
    WHERE "editType" = 'REMAINDER_COLLECTED'
    GROUP BY "bookingId"
  `;

  const rows = await db.$queryRaw<Row[]>(Prisma.sql`
    WITH last_collection AS (${lastCollection}),
    parts AS (
      -- Bookings: the advance, on the day it was confirmed.
      SELECT to_char(p."confirmedAt" + ${IST_SHIFT}, 'YYYY-MM-DD') AS day,
             ${channelCase(Prisma.sql`p.method::text`)} AS channel,
             'Bookings' AS source,
             (p.amount
               - COALESCE(p."remainderCashAmount", 0)
               - COALESCE(p."remainderUpiAmount", 0))::bigint AS amount
      FROM "Payment" p
      WHERE p.status IN ('COMPLETED','PARTIAL')
        AND p."confirmedAt" IS NOT NULL
        AND (p.amount
              - COALESCE(p."remainderCashAmount", 0)
              - COALESCE(p."remainderUpiAmount", 0)) > 0

      UNION ALL
      -- Bookings: the venue-side remainder, on the day it was handed over.
      SELECT to_char(COALESCE(lc.collected_at, p."confirmedAt") + ${IST_SHIFT}, 'YYYY-MM-DD'),
             'CASH', 'Bookings', p."remainderCashAmount"::bigint
      FROM "Payment" p
      LEFT JOIN last_collection lc ON lc."bookingId" = p."bookingId"
      WHERE COALESCE(p."remainderCashAmount", 0) > 0
        AND COALESCE(lc.collected_at, p."confirmedAt") IS NOT NULL

      UNION ALL
      SELECT to_char(COALESCE(lc.collected_at, p."confirmedAt") + ${IST_SHIFT}, 'YYYY-MM-DD'),
             'ONLINE', 'Bookings', p."remainderUpiAmount"::bigint
      FROM "Payment" p
      LEFT JOIN last_collection lc ON lc."bookingId" = p."bookingId"
      WHERE COALESCE(p."remainderUpiAmount", 0) > 0
        AND COALESCE(lc.collected_at, p."confirmedAt") IS NOT NULL

      UNION ALL
      -- Passes. A null method with a gateway id is a self-serve online
      -- purchase; a null method with no id is genuinely unknown and is
      -- reported as such rather than guessed into a column.
      SELECT to_char(up."purchasedAt" + ${IST_SHIFT}, 'YYYY-MM-DD'),
             CASE
               WHEN up."paymentMethod"::text = 'CASH' THEN 'CASH'
               WHEN up."paymentMethod"::text IN ('RAZORPAY','PHONEPE','UPI_QR') THEN 'ONLINE'
               WHEN up."paymentMethod" IS NULL AND up."razorpayPaymentId" IS NOT NULL THEN 'ONLINE'
               ELSE 'UNATTRIBUTED'
             END,
             'Passes', up.price::bigint
      FROM "UserPass" up
      WHERE up.price > 0
        AND up."paymentMethod"::text IS DISTINCT FROM 'FREE'

      UNION ALL
      SELECT to_char(tt."paidAt" + ${IST_SHIFT}, 'YYYY-MM-DD'),
             ${channelCase(Prisma.sql`tt."paymentMethod"`)},
             'Tournaments', tt."paidAmount"::bigint
      FROM "TournamentTeam" tt
      WHERE tt."paidAmount" > 0 AND tt."archivedAt" IS NULL
        AND tt.status = 'CONFIRMED' AND tt."paidAt" IS NOT NULL

      UNION ALL
      SELECT to_char(op."receivedAt" + ${IST_SHIFT}, 'YYYY-MM-DD'),
             ${channelCase(Prisma.sql`op.method::text`)},
             'Tournaments', op.amount::bigint
      FROM "TournamentOrganizerPayment" op
      WHERE op.amount > 0

      UNION ALL
      SELECT to_char(cr."paidAt" + ${IST_SHIFT}, 'YYYY-MM-DD'),
             ${channelCase(Prisma.sql`cr."paymentMethod"`)},
             'Camps', cr."paidAmount"::bigint
      FROM "CampRegistration" cr
      WHERE cr."paidAmount" > 0 AND cr."archivedAt" IS NULL
        AND cr.status = 'CONFIRMED' AND cr."paidAt" IS NOT NULL

      UNION ALL
      -- Cafe at the counter. A mixed tender stores its slices, so the
      -- cash half and the UPI half land in their own columns rather than
      -- the whole bill following whichever slice happened to be larger.
      SELECT to_char(cp."confirmedAt" + ${IST_SHIFT}, 'YYYY-MM-DD'),
             'CASH', 'Cafe', ROUND(cp."splitCashAmount")::bigint
      FROM "CafePayment" cp
      WHERE cp.status IN ('COMPLETED','PARTIAL') AND cp."confirmedAt" IS NOT NULL
        AND COALESCE(cp."splitCashAmount", 0) > 0

      UNION ALL
      SELECT to_char(cp."confirmedAt" + ${IST_SHIFT}, 'YYYY-MM-DD'),
             'ONLINE', 'Cafe', ROUND(cp."splitUpiAmount")::bigint
      FROM "CafePayment" cp
      WHERE cp.status IN ('COMPLETED','PARTIAL') AND cp."confirmedAt" IS NOT NULL
        AND COALESCE(cp."splitUpiAmount", 0) > 0

      UNION ALL
      -- Single-method cafe payments: the ones with no split recorded.
      SELECT to_char(cp."confirmedAt" + ${IST_SHIFT}, 'YYYY-MM-DD'),
             ${channelCase(Prisma.sql`cp.method::text`)},
             'Cafe', ROUND(cp.amount)::bigint
      FROM "CafePayment" cp
      WHERE cp.status IN ('COMPLETED','PARTIAL') AND cp."confirmedAt" IS NOT NULL
        AND cp."splitCashAmount" IS NULL AND cp."splitUpiAmount" IS NULL
        AND cp.amount > 0

      UNION ALL
      -- The shop (ProductOrder). Nearly dormant — one completed sale,
      -- ₹150 cash in May 2026 — but a real till source, and leaving it
      -- out would under-report silently the day it starts being used.
      --
      -- ProductOrderPayment.amount is the ONE money column in this
      -- codebase stored in PAISE ("Total captured in PAISE" on the
      -- model). Everything else here is rupees, so it is divided at the
      -- boundary rather than anywhere a later reader could miss it.
      SELECT to_char(pop."confirmedAt" + ${IST_SHIFT}, 'YYYY-MM-DD'),
             ${channelCase(Prisma.sql`pop.method::text`)},
             'Shop', ROUND(pop.amount / 100.0)::bigint
      FROM "ProductOrderPayment" pop
      WHERE pop.status IN ('COMPLETED','PARTIAL')
        AND pop."confirmedAt" IS NOT NULL
        AND pop.amount > 0

      UNION ALL
      -- Cafe balances settled after the fact, on the day they arrived.
      SELECT to_char(cs."receivedAt" + ${IST_SHIFT}, 'YYYY-MM-DD'),
             'CASH', 'Cafe', ROUND(cs."cashAmount")::bigint
      FROM "CafeOrderSettlement" cs
      WHERE cs."cashAmount" > 0

      UNION ALL
      SELECT to_char(cs."receivedAt" + ${IST_SHIFT}, 'YYYY-MM-DD'),
             'ONLINE', 'Cafe', ROUND(cs."upiAmount")::bigint
      FROM "CafeOrderSettlement" cs
      WHERE cs."upiAmount" > 0
    )
    SELECT day, channel, source, SUM(amount)::bigint AS amount
    FROM parts
    WHERE day >= to_char(${fromUtc}::timestamptz + ${IST_SHIFT}, 'YYYY-MM-DD')
      AND day <= to_char(${toUtc}::timestamptz + ${IST_SHIFT}, 'YYYY-MM-DD')
    GROUP BY day, channel, source
    ORDER BY day DESC
  `);

  const splitRemainders = await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`
    SELECT COUNT(*)::bigint AS n FROM (
      SELECT "bookingId" FROM "BookingEditHistory"
      WHERE "editType" = 'REMAINDER_COLLECTED'
      GROUP BY "bookingId" HAVING COUNT(*) > 1
    ) t
  `);

  const dayMap = new Map<string, CollectionsDay>();
  const srcMap = new Map<string, CollectionsSplit & { source: string }>();
  const totals = { cash: 0, online: 0, unattributed: 0, total: 0 };

  for (const r of rows) {
    const amount = Number(r.amount);
    const key =
      r.channel === "CASH"
        ? "cash"
        : r.channel === "ONLINE"
          ? "online"
          : "unattributed";

    const d =
      dayMap.get(r.day) ??
      {
        date: r.day,
        cash: 0,
        online: 0,
        unattributed: 0,
        total: 0,
        sources: [],
      };
    d[key] += amount;
    d.total += amount;
    let ds = d.sources.find((x) => x.source === r.source);
    if (!ds) {
      ds = { source: r.source, cash: 0, online: 0, unattributed: 0, total: 0 };
      d.sources.push(ds);
    }
    ds[key] += amount;
    ds.total += amount;
    dayMap.set(r.day, d);

    const s =
      srcMap.get(r.source) ??
      { source: r.source, cash: 0, online: 0, unattributed: 0, total: 0 };
    s[key] += amount;
    s.total += amount;
    srcMap.set(r.source, s);

    totals[key] += amount;
    totals.total += amount;
  }

  return {
    success: true,
    data: {
      days: Array.from(dayMap.values())
        .map((d) => ({
          ...d,
          sources: d.sources.sort((a, b) => b.total - a.total),
        }))
        .sort((a, b) => b.date.localeCompare(a.date)),
      totals,
      bySource: Array.from(srcMap.values())
        .map(({ source, cash, online, unattributed, total }) => ({
          source,
          cash,
          online,
          unattributed,
          total,
        }))
        .sort((a, b) => b.total - a.total),
      splitRemainders: Number(splitRemainders[0]?.n ?? 0),
      from: input.from,
      to: input.to,
    },
  };
}
