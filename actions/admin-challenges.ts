"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { wheelRefusal, resolveWheel, KNOWN_SPORTS } from "@/lib/challenge-rules";
import {
  pushScheduleRefusal,
  resolvePushes,
  DEFAULT_ADJACENT_PUSHES,
  DEFAULT_FALLBACK_PUSHES,
  templateRefusal,
} from "@/lib/challenge-push";

/** The five match-lifecycle messages, as settings keys. */
const LIFECYCLE_KEYS = [
  // The arena's own message is validated and stored exactly like the five
  // customer ones; only its variable list differs, and that lives in the UI.
  "ownerRefundPush",
  "agreedPush",
  "payHalfPush",
  "confirmedPush",
  "slotLostPush",
  "refundOwedPush",
] as const;
import { challengeSettings } from "@/lib/challenges";

/**
 * The venue's control over the challenge board.
 *
 * Everything about the board is meant to be changeable from here without a
 * deploy — which sports it runs for, how hard two captains may haggle, how
 * long a challenge lives, how much is taken up front, who hears about it.
 * The board is new and the right numbers are not known yet; a setting that
 * needs a release to change is a setting nobody tunes.
 */

const PERMISSION = "MANAGE_BOOKINGS";
async function gate() {
  return requireAdmin(PERMISSION);
}

export async function getChallengeAdmin() {
  await gate();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [
    settings,
    challenges,
    counts,
    events,
    eventCounts,
    refusals,
    moneyIn,
    owedOnPayments,
    owedOnOrders,
  ] = await Promise.all([
    challengeSettings(),
    db.challenge.findMany({
      select: {
        id: true,
        bookingId: true,
        sport: true,
        teamName: true,
        playerCount: true,
        status: true,
        notes: true,
        expiresAt: true,
        createdAt: true,
        withdrawReason: true,
        booking: { select: { status: true } },
        createdBy: { select: { name: true, phone: true } },
        acceptedBy: { select: { name: true, phone: true } },
        windows: {
          select: {
            id: true,
            date: true,
            startHour: true,
            endHour: true,
            proposedBy: true,
            status: true,
          },
          orderBy: { createdAt: "asc" },
        },
        payments: {
          select: {
            side: true,
            amount: true,
            paidAt: true,
            placedAt: true,
            refundedAt: true,
            refundOwedAt: true,
            refundOwedReason: true,
            user: { select: { name: true, phone: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.challenge.groupBy({ by: ["status"], _count: true }),
    // The trail. 300 is enough to see a day's worth at launch volume and
    // small enough that the page stays a page rather than a report.
    db.challengeEvent.findMany({
      select: {
        id: true,
        type: true,
        detail: true,
        createdAt: true,
        challengeId: true,
        user: { select: { name: true, phone: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    db.challengeEvent.groupBy({
      by: ["type"],
      where: { createdAt: { gte: since } },
      _count: true,
    }),
    // Why people were turned away, most common first. This is the answer
    // to "the board is empty and I do not know why" — it separates nobody
    // looked from everybody was refused, which nothing else can.
    db.challengeEvent.groupBy({
      by: ["detail"],
      where: { type: "REFUSED", createdAt: { gte: since } },
      _count: true,
      orderBy: { _count: { detail: "desc" } },
      take: 12,
    }),
    // ── The two money worklists, asked for directly ──
    //
    // These were computed in the browser from the 200 most recent challenges.
    // Both are lists of things the venue OWES — half-paid courts to chase,
    // captures to refund — so the one guarantee they need is that nothing
    // falls off the end. The 201st-oldest unrefunded capture dropping out of
    // view, with no "showing 200 of N" anywhere, is the worst possible
    // failure for a panel whose whole job is "do not forget this".
    db.challenge.findMany({
      where: {
        payments: { some: { paidAt: { not: null }, refundedAt: null, refundOwedAt: null } },
      },
      select: {
        id: true,
        status: true,
        teamName: true,
        bookingId: true,
        createdBy: { select: { name: true, phone: true } },
        acceptedBy: { select: { name: true, phone: true } },
        windows: {
          where: { status: "ACCEPTED" },
          select: { date: true, startHour: true, endHour: true },
          take: 1,
        },
        payments: {
          where: { refundedAt: null, refundOwedAt: null },
          select: { side: true, amount: true, paidAt: true, placedAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.challengePayment.findMany({
      where: { refundOwedAt: { not: null }, refundedAt: null },
      select: {
        id: true,
        side: true,
        amount: true,
        refundOwedAt: true,
        refundOwedReason: true,
        user: { select: { name: true, phone: true } },
        challenge: { select: { id: true, teamName: true, status: true } },
      },
      orderBy: { refundOwedAt: "asc" },
    }),
    // Captures the payment rows can no longer account for: a slot taken over
    // while somebody was paying, or a challenge deleted underneath them. The
    // order ledger is the only thing that still knows whose money it is, so
    // it belongs on the same queue — money owed is money owed.
    db.challengeOrder.findMany({
      // `settledAt: null` matters: an order could carry BOTH flags, so the same
      // capture appeared on this queue and on the payment-row queue, and the
      // panel totalled it as two debts with the same name on both rows.
      where: { strandedAt: { not: null }, refundedAt: null, settledAt: null },
      select: {
        id: true,
        userId: true,
        challengeId: true,
        side: true,
        amount: true,
        strandedAt: true,
        strandedReason: true,
      },
      orderBy: { strandedAt: "asc" },
    }),
  ]);

  // A challenge is half-paid when money is in and FEWER THAN TWO SIDES have
  // paid. Counting ROWS was the bug: they are created lazily, one per side,
  // the first time that side opens a payment sheet — so the canonical case
  // (one captain paid, the other has not started) has exactly one row,
  // `every()` over it is vacuously true, and the panel built for that case
  // excluded it. It only ever fired when the second captain had opened a
  // sheet and abandoned it.
  const halfPaid = moneyIn
    .map((c) => {
      // PLACED, not merely claimed — the same definition `paidSides()` and
      // `challengeQuote` use. Counting `paidAt` meant a challenge with one
      // placed half and one claimed-but-unplaced half read as "both paid" and
      // fell off this panel, while its money sat on neither worklist.
      const paid = c.payments.filter((p) => p.paidAt && p.placedAt);
      // A half that was claimed and never placed is money with no court and no
      // queue. It belongs here too, flagged for what it is.
      const stuck = c.payments.filter((p) => p.paidAt && !p.placedAt);
      // WHO OWES is whoever has put in no money at all — not merely whoever is
      // missing from `paid`. Deriving it from `paid` alone named the captain
      // whose capture was stuck as the one to chase, on the same row that said
      // their money was captured.
      // NOBODY owes when both sides have put money in. The previous test asked
      // "does the challenger have money?" and named the acceptor if so — which
      // on a challenge where BOTH have paid named the captain whose capture is
      // stuck as the one to chase, on the very row that says their money was
      // captured. That is the venue ringing a customer to demand money it is
      // already holding.
      const withMoney = new Set([...paid, ...stuck].map((p) => p.side));
      const owingSide =
        withMoney.size >= 2
          ? null
          : withMoney.has("CHALLENGER")
            ? "ACCEPTOR"
            : "CHALLENGER";
      return {
        id: c.id,
        status: c.status,
        teamName: c.teamName,
        bookingId: c.bookingId,
        held: [...paid, ...stuck].reduce((sum, p) => sum + p.amount, 0),
        sidesPaid: new Set(paid.map((p) => p.side)).size,
        /** Captured money that never reached a booking. Needs a person. */
        stuck: stuck.reduce((sum, p) => sum + p.amount, 0),
        // Whoever has NOT paid is who the venue rings. Derived from the side
        // that is missing, not from an unpaid row — there may not be one.
        owes:
          owingSide === null
            ? null
            : owingSide === "CHALLENGER"
              ? c.createdBy
              : c.acceptedBy,
        window: c.windows[0] ?? null,
      };
    })
    // One side placed, or any money stuck without a booking at all.
    .filter((c) => c.sidesPaid === 1 || c.stuck > 0);

  // One queue, two sources. The screen should not care which table a debt
  // came from — the venue's question is "who is owed what".
  const strandedUsers = owedOnOrders.length
    ? await db.user.findMany({
        where: { id: { in: [...new Set(owedOnOrders.map((o) => o.userId))] } },
        select: { id: true, name: true, phone: true },
      })
    : [];
  const strandedChallenges = owedOnOrders.length
    ? await db.challenge.findMany({
        where: { id: { in: [...new Set(owedOnOrders.map((o) => o.challengeId))] } },
        select: { id: true, teamName: true },
      })
    : [];
  const refundsOwed = [
    ...owedOnPayments.map((p) => ({
      id: p.id,
      source: "payment" as const,
      side: p.side as string,
      amount: p.amount,
      owedAt: p.refundOwedAt as Date,
      reason: p.refundOwedReason,
      user: p.user,
      challengeId: p.challenge.id,
      teamName: p.challenge.teamName,
    })),
    ...owedOnOrders.map((o) => {
      const u = strandedUsers.find((x) => x.id === o.userId);
      const ch = strandedChallenges.find((x) => x.id === o.challengeId);
      return {
        id: o.id,
        source: "order" as const,
        side: o.side as string,
        amount: o.amount,
        owedAt: o.strandedAt as Date,
        reason: o.strandedReason,
        user: u ? { name: u.name, phone: u.phone } : null,
        challengeId: o.challengeId,
        // Was hard-coded null, so the venue saw a phone number and "no live
        // slot" but not which match — even when the challenge still existed.
        teamName: ch?.teamName ?? null,
      };
    }),
  ].sort((a, b) => a.owedAt.getTime() - b.owedAt.getTime());

  // Funnel: what proportion of the people who saw the card ever posted.
  const n = (t: string) => eventCounts.find((e) => e.type === t)?._count ?? 0;
  return {
    settings,
    // `bookingStatus` flattened onto the row, because the board needs to tell a
    // live court from a cancelled one to decide whether Take down applies — and
    // the page hands this object through `JSON.parse(JSON.stringify(...))`, so
    // a field the client declares but the server never sets is `undefined` at
    // runtime and typechecks perfectly.
    challenges: challenges.map((c) => ({ ...c, bookingStatus: c.booking?.status ?? null })),
    halfPaid,
    refundsOwed,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    events,
    eventCounts: Object.fromEntries(eventCounts.map((e) => [e.type, e._count])),
    refusals: refusals.map((r) => ({ reason: r.detail ?? "(no reason)", count: r._count })),
    funnel: {
      cardShown: n("HOME_CARD_SHOWN"),
      cardTapped: n("HOME_CARD_TAPPED"),
      boardViewed: n("BOARD_VIEWED"),
      postOpened: n("POST_OPENED"),
      posted: n("POSTED"),
      detailViewed: n("DETAIL_VIEWED"),
      accepted: n("ACCEPTED"),
      countered: n("COUNTERED"),
      refused: n("REFUSED"),
    },
    promo: await promoStats(since),
  };
}

/**
 * What the wheel has actually cost and returned.
 *
 * The three numbers that matter are spins, offers taken, and rupees
 * discounted — in that order, because a wheel that spins a lot and converts
 * nothing is a copy or timing problem, and a wheel that converts everything
 * at 40% is a pricing problem. The realised average is shown next to the
 * configured one: they drift when the admin retunes mid-period, and only
 * the realised number is what the month actually cost.
 */
async function promoStats(since: Date) {
  const [spins, offers] = await Promise.all([
    db.challengeSpin.findMany({
      where: { createdAt: { gte: since } },
      select: { wonPct: true },
    }),
    db.challengeOffer.findMany({
      where: { createdAt: { gte: since } },
      select: {
        discountPct: true,
        kind: true,
        takenAt: true,
        lapsedAt: true,
        bookingId: true,
        expiresAt: true,
        booking: { select: { totalAmount: true, originalAmount: true, discountAmount: true } },
      },
    }),
  ]);

  // TAKEN means a booking exists. An offer can carry `takenAt` and no
  // booking — a claim whose process died — and counting those as prizes
  // taken overstated take-up while contributing nothing, and left them out
  // of lapses too. Both numbers are the point of this panel.
  const taken = offers.filter((o) => o.takenAt && o.bookingId);
  const discounted = taken.reduce((sum, o) => sum + (o.booking?.discountAmount ?? 0), 0);
  const collected = taken.reduce((sum, o) => sum + (o.booking?.totalAmount ?? 0), 0);
  // TWO different averages, because they answer two different questions and
  // conflating them is a promo-killing error. The wheel's mean is what it
  // LANDS on across every spin, including spins nobody redeemed; the
  // realised cost is what the venue actually BORE, which is only ever
  // discount over rack price on offers that were taken. Reporting the first
  // as the second overstated a 15% promo as 36% — enough to cancel
  // something that was working.
  const wheelMeanPct =
    spins.length > 0 ? spins.reduce((s, x) => s + x.wonPct, 0) / spins.length : 0;
  const rackTotal = taken.reduce(
    (sum, o) => sum + (o.booking?.originalAmount ?? o.booking?.totalAmount ?? 0),
    0,
  );
  const realisedCostPct = rackTotal > 0 ? (discounted / rackTotal) * 100 : 0;

  return {
    spins: spins.length,
    offersMade: offers.length,
    offersTaken: taken.length,
    offersLapsed: offers.filter(
      (o) => !o.bookingId && (o.lapsedAt !== null || o.expiresAt <= new Date()),
    ).length,
    adjacentMade: offers.filter((o) => o.kind === "ADJACENT").length,
    adjacentTaken: taken.filter((o) => o.kind === "ADJACENT").length,
    fallbackMade: offers.filter((o) => o.kind === "FALLBACK").length,
    fallbackTaken: taken.filter((o) => o.kind === "FALLBACK").length,
    /// Rupees given away, and rupees taken on hours that would otherwise
    /// have sat empty. The second is the number that justifies the first.
    discounted,
    collected,
    wheelMeanPct: Math.round(wheelMeanPct * 10) / 10,
    realisedCostPct: Math.round(realisedCostPct * 10) / 10,
    byPct: Object.entries(
      spins.reduce<Record<number, number>>((acc, x) => {
        acc[x.wonPct] = (acc[x.wonPct] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .map(([pct, count]) => ({ pct: Number(pct), count }))
      .sort((a, b) => a.pct - b.pct),
  };
}

export type ChallengeSettingsInput = {
  enabled?: boolean;
  sports?: string[];
  minPlayers?: number;
  maxPlayers?: number;
  maxWindows?: number;
  maxCountersPerSide?: number;
  ttlDays?: number;
  advancePct?: number;
  paymentWindowMins?: number;
  ownerRefundPush?: unknown;
  agreedPush?: unknown;
  payHalfPush?: unknown;
  confirmedPush?: unknown;
  slotLostPush?: unknown;
  refundOwedPush?: unknown;
  pushAudience?: string;
  pushDailyCap?: number;
  pushRecentDays?: number;
  postedPush?: unknown;
  postedPushEnabled?: boolean;
  boardTitle?: string | null;
  boardSubtitle?: string | null;
  emptyText?: string | null;
  homeCardEnabled?: boolean;
  homeCardTitle?: string | null;
  homeCardSubtitle?: string | null;
  homeCardBadge?: string;
  minLeadMins?: number;
  // ── The wheel ───────────────────────────────────────────────────
  spinEnabled?: boolean;
  spinSegments?: { pct: number; weight: number }[];
  spinAvgMinPct?: number;
  spinAvgMaxPct?: number;
  spinAdjacentWindowMins?: number;
  spinFallbackWindowMins?: number;
  spinFallbackDays?: number;
  spinAdjacentOnly?: boolean;
  spinSameSizeOnly?: boolean;
  spinsPerPosterCap?: number;
  spinsPerPosterPerDays?: number;
  spinWonPush?: { title: string; body: string };
  spinAdjacentPushes?: { minsLeft: number; title: string; body: string }[];
  spinFallbackPushes?: { minsLeft: number; title: string; body: string }[];
};

export async function saveChallengeSettings(
  input: ChallengeSettingsInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await gate();

  // Bounds are enforced here rather than trusted from the form, because
  // these numbers reach the app and a nonsense value is worse than a
  // rejected save: maxWindows of 0 would make the board unpostable, and
  // nobody would know why.
  const num = (v: number | undefined, lo: number, hi: number, label: string) => {
    if (v === undefined) return undefined;
    if (!Number.isInteger(v) || v < lo || v > hi) {
      throw new Error(`${label} must be a whole number between ${lo} and ${hi}.`);
    }
    return v;
  };

  try {
    const data = {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.sports ? { sports: [...new Set(input.sports)] as never } : {}),
      ...(num(input.minPlayers, 1, 50, "Minimum players") !== undefined
        ? { minPlayers: input.minPlayers }
        : {}),
      ...(num(input.maxPlayers, 1, 50, "Maximum players") !== undefined
        ? { maxPlayers: input.maxPlayers }
        : {}),
      ...(num(input.maxWindows, 1, 6, "Times per challenge") !== undefined
        ? { maxWindows: input.maxWindows }
        : {}),
      ...(num(input.maxCountersPerSide, 0, 5, "Counter-offers per side") !== undefined
        ? { maxCountersPerSide: input.maxCountersPerSide }
        : {}),
      ...(num(input.ttlDays, 1, 60, "Days a challenge lives") !== undefined
        ? { ttlDays: input.ttlDays }
        : {}),
      ...(num(input.advancePct, 0, 100, "Advance percent") !== undefined
        ? { advancePct: input.advancePct }
        : {}),
      ...(num(input.paymentWindowMins, 5, 1440, "Payment window") !== undefined
        ? { paymentWindowMins: input.paymentWindowMins }
        : {}),
      ...Object.fromEntries(
        LIFECYCLE_KEYS.filter((k) => input[k] !== undefined).map((k) => [k, input[k] as never]),
      ),
      ...(input.pushAudience ? { pushAudience: input.pushAudience } : {}),
      ...(num(input.pushDailyCap, 0, 50, "Push cap") !== undefined
        ? { pushDailyCap: input.pushDailyCap }
        : {}),
      ...(num(input.pushRecentDays, 1, 3650, "Recent window") !== undefined
        ? { pushRecentDays: input.pushRecentDays }
        : {}),
      ...(input.postedPushEnabled !== undefined
        ? { postedPushEnabled: input.postedPushEnabled }
        : {}),
      ...(input.postedPush !== undefined ? { postedPush: input.postedPush as never } : {}),
      ...(input.boardTitle !== undefined ? { boardTitle: input.boardTitle?.trim().slice(0, 200) || null } : {}),
      ...(input.boardSubtitle !== undefined
        ? { boardSubtitle: input.boardSubtitle?.trim().slice(0, 200) || null }
        : {}),
      ...(input.emptyText !== undefined ? { emptyText: input.emptyText?.trim().slice(0, 200) || null } : {}),
      ...(input.homeCardEnabled !== undefined
        ? { homeCardEnabled: input.homeCardEnabled }
        : {}),
      ...(input.homeCardTitle !== undefined
        ? { homeCardTitle: input.homeCardTitle?.trim().slice(0, 200) || null }
        : {}),
      ...(input.homeCardSubtitle !== undefined
        ? { homeCardSubtitle: input.homeCardSubtitle?.trim().slice(0, 200) || null }
        : {}),
      ...(input.homeCardBadge ? { homeCardBadge: input.homeCardBadge } : {}),
      ...(num(input.minLeadMins, 0, 2880, "Notice before the slot") !== undefined
        ? { minLeadMins: input.minLeadMins }
        : {}),
      ...(input.spinEnabled !== undefined ? { spinEnabled: input.spinEnabled } : {}),
      ...(num(input.spinAvgMinPct, 0, 100, "Average floor") !== undefined
        ? { spinAvgMinPct: input.spinAvgMinPct }
        : {}),
      ...(num(input.spinAvgMaxPct, 0, 100, "Average ceiling") !== undefined
        ? { spinAvgMaxPct: input.spinAvgMaxPct }
        : {}),
      ...(num(input.spinAdjacentWindowMins, 1, 1440, "Next-hour offer window") !== undefined
        ? { spinAdjacentWindowMins: input.spinAdjacentWindowMins }
        : {}),
      ...(num(input.spinFallbackWindowMins, 1, 10080, "Another-day offer window") !== undefined
        ? { spinFallbackWindowMins: input.spinFallbackWindowMins }
        : {}),
      ...(num(input.spinFallbackDays, 1, 30, "Days ahead for the fallback") !== undefined
        ? { spinFallbackDays: input.spinFallbackDays }
        : {}),
      ...(input.spinAdjacentOnly !== undefined
        ? { spinAdjacentOnly: input.spinAdjacentOnly }
        : {}),
      ...(input.spinSameSizeOnly !== undefined
        ? { spinSameSizeOnly: input.spinSameSizeOnly }
        : {}),
      ...(num(input.spinsPerPosterCap, 0, 100, "Spins per poster") !== undefined
        ? { spinsPerPosterCap: input.spinsPerPosterCap }
        : {}),
      ...(num(input.spinsPerPosterPerDays, 0, 365, "Spin cap window") !== undefined
        ? { spinsPerPosterPerDays: input.spinsPerPosterPerDays }
        : {}),

    };

    // Json columns are typed `unknown` at the edge, so a string or an object
    // reaches Prisma happily, stores, and is then silently ignored at
    // runtime — a "Saved." that changed nothing.
    for (const key of ["spinSegments", "spinAdjacentPushes", "spinFallbackPushes"] as const) {
      const v = input[key];
      if (v === undefined) continue;
      if (!Array.isArray(v)) return { ok: false, error: "That has to be a list." };
      if (v.some((x) => x === null || typeof x !== "object")) {
        return { ok: false, error: "Every entry in that list has to be filled in." };
      }
    }

    if (input.spinSegments) Object.assign(data, { spinSegments: input.spinSegments as never });
    if (input.spinAdjacentPushes) {
      Object.assign(data, {
        spinAdjacentPushes: input.spinAdjacentPushes.map((t) => ({
          ...t,
          title: String(t.title ?? "").trim().slice(0, 120),
          body: String(t.body ?? "").trim().slice(0, 300),
        })) as never,
      });
    }
    if (input.spinFallbackPushes) {
      Object.assign(data, {
        spinFallbackPushes: input.spinFallbackPushes.map((t) => ({
          ...t,
          title: String(t.title ?? "").trim().slice(0, 120),
          body: String(t.body ?? "").trim().slice(0, 300),
        })) as never,
      });
    }

    // ── Validate the RESULT, not the patch ──────────────────────────
    //
    // Every cross-field rule here was previously checked only when both
    // halves of the pair arrived together — and this screen saves one
    // field per blur, so none of them could ever fire from the UI they
    // were written for. Worse, each could be walked out of validity by
    // saving the other half afterwards: set a legal wheel, then move the
    // band, and an out-of-band wheel pays out live with nothing refusing.
    //
    // So: merge the patch over what is stored, and judge the settings the
    // venue would actually end up with.
    const stored = await db.challengeSettings.findFirst();
    const next = { ...(stored ?? {}), ...data } as Record<string, unknown>;
    const n = (k: string, d: number) => (typeof next[k] === "number" ? (next[k] as number) : d);

    // GATE ONLY WHAT THIS SAVE TOUCHES — these two pairs as well.
    //
    // They were exempted from that rule when it was applied to the wheel and
    // nudge guards below, and they bricked the screen in exactly the way it
    // was written to prevent: with an inconsistent band stored, EVERY save
    // was refused — `enabled: false` and `spinEnabled: false` included. The
    // venue could not switch off a 90%-paying wheel because the band that
    // described it was inconsistent, and the error named a field they had
    // not touched.
    if (input.minPlayers !== undefined || input.maxPlayers !== undefined) {
      if (n("minPlayers", 1) > n("maxPlayers", 30)) {
        return { ok: false, error: "Minimum players can't exceed the maximum." };
      }
    }
    if (input.spinAvgMinPct !== undefined || input.spinAvgMaxPct !== undefined) {
      if (n("spinAvgMinPct", 15) > n("spinAvgMaxPct", 25)) {
        return {
          ok: false,
          error: "The average floor can't be above the ceiling — no wheel could satisfy both.",
        };
      }
    }


    // Validate the EFFECTIVE configuration, not the stored column.
    //
    // A null column is not "nothing to check" — the runtime substitutes a
    // code default for it, and that default is what actually pays out. On a
    // fresh install (every column null) the previous version of this check
    // skipped both guards entirely, so a band of 0–1% saved happily against
    // a live wheel averaging 17.8%, and a 3-minute offer window saved
    // against live nudges at 15 and 5 minutes. Resolve exactly as
    // spinConfig() does, then judge that.
    // GATE ONLY WHAT THIS SAVE TOUCHES.
    //
    // Running the wheel and nudge guards on every save meant one
    // out-of-range stored value bricked the whole settings screen — and
    // most perversely, the switch that would STOP a 90% wheel was refused
    // *because* the wheel pays 90%. A kill switch that can be disabled by
    // the thing it kills is not a kill switch.
    // A BAND EDIT IS NOT A WHEEL EDIT.
    //
    // Including the band fields here made the two guards block each other's
    // repair: with floor 40 / ceiling 10 stored, every band edit that would
    // make floor ≤ ceiling was ALSO judged against the live wheel's average
    // versus the other, still-broken half — so all 23 possible single-field
    // saves were refused and the only way out was a psql prompt. Since the
    // form saves one field per blur, "repairable from the screen" has to mean
    // repairable one field at a time.
    //
    // The wheel is still judged whenever the WHEEL changes, and the band is
    // still judged against itself, so no bad state can be introduced — only
    // escaped.
    const touchesWheel = input.spinSegments !== undefined;
    const touchesAdjacent =
      input.spinAdjacentPushes !== undefined || input.spinAdjacentWindowMins !== undefined;
    const touchesFallback =
      input.spinFallbackPushes !== undefined || input.spinFallbackWindowMins !== undefined;

    // The SAME resolver the runtime uses. Two copies of this rule have now
    // disagreed twice; there is one.
    // Judge what the venue TYPED before resolving it, or the resolver hides
    // the mistake: `resolveWheel` falls back to the built-in wheel whenever
    // nothing has a positive weight, so an all-zero or empty wheel saved with
    // `{ok:true}` and was silently discarded — and `wheelRefusal`'s own rule
    // "at least one segment needs a weight above zero" could never fire.
    if (Array.isArray(input.spinSegments)) {
      const typed = input.spinSegments as { weight?: unknown }[];
      if (
        typed.length > 0 &&
        !typed.some((x) => typeof x?.weight === "number" && x.weight > 0)
      ) {
        return {
          ok: false,
          error: "At least one segment needs a weight above zero, or nothing can be won.",
        };
      }
    }
    const effSegs = resolveWheel(next.spinSegments);
    const badWheel = touchesWheel
      ? wheelRefusal(effSegs, n("spinAvgMinPct", 15), n("spinAvgMaxPct", 25))
      : null;
    if (badWheel) {
      return {
        ok: false,
        error: Array.isArray(next.spinSegments)
          ? badWheel
          : `${badWheel} (that's the built-in wheel, which is what runs until you save your own.)`,
      };
    }

    for (const [key, winKey, winDefault, fallbackList, touched] of [
      ["spinAdjacentPushes", "spinAdjacentWindowMins", 30, DEFAULT_ADJACENT_PUSHES, touchesAdjacent],
      ["spinFallbackPushes", "spinFallbackWindowMins", 120, DEFAULT_FALLBACK_PUSHES, touchesFallback],
    ] as const) {
      if (!touched) continue;
      const stored = next[key];
      // An EMPTY list is a real choice ("no nudges") and needs no check. A
      // missing one means the built-in schedule is what fires.
      if (Array.isArray(stored) && stored.length === 0) continue;
      const eff = resolvePushes(stored, fallbackList) as {
        minsLeft: number;
        title: string;
        body: string;
      }[];
      const bad = pushScheduleRefusal(eff, n(winKey, winDefault));
      if (bad) {
        return {
          ok: false,
          error: Array.isArray(stored)
            ? bad
            : `${bad} (that's the built-in schedule, which is what sends until you save your own.)`,
        };
      }
    }


    // The won-it push had no validation at all, and a malformed one throws
    // inside renderPush AFTER the spin row is written — burning the
    // poster's single spin on a 500 they can never retry.
    const capCopy = (t: { title: string; body: string }) => ({
      ...t,
      title: t.title.trim().slice(0, 120),
      body: t.body.trim().slice(0, 300),
    });
    if (input.spinWonPush !== undefined) {
      const w = input.spinWonPush as { title?: unknown; body?: unknown } | null;
      if (
        !w ||
        typeof w !== "object" ||
        typeof w.title !== "string" ||
        typeof w.body !== "string" ||
        !w.title.trim() ||
        !w.body.trim()
      ) {
        return { ok: false, error: "The win message needs a title and a body." };
      }
      Object.assign(data, {
        spinWonPush: capCopy({ title: w.title, body: w.body }) as never,
      });
    }

    // NO cross-field rule here, deliberately. Requiring both halves together
    // made the cap unreachable: this screen blur-saves ONE field per event,
    // so `{cap: 5}` and `{days: 7}` each arrived alone and each was refused,
    // in every order — the only anti-collusion defence there is could not be
    // switched on at all. Worse, an inconsistent stored pair then refused
    // every unrelated save including both kill switches, which is exactly
    // the pattern the other guards had just been narrowed to avoid.
    //
    // Instead `days = 0` now MEANS "ever" at the runtime (see spinFor), so
    // every combination of these two numbers is meaningful on its own and
    // there is nothing left to police.

    // F11: validated here rather than cast into the Prisma enum.
    if (input.sports?.some((x) => !KNOWN_SPORTS.includes(x))) {
      return { ok: false, error: "That isn't a sport the arena runs." };
    }

    // Each lifecycle message is judged on its own, and only when touched.
    for (const k of LIFECYCLE_KEYS) {
      if (input[k] === undefined) continue;
      const bad = templateRefusal(input[k]);
      if (bad) return { ok: false, error: bad };
    }
    if (input.pushAudience && !["ALL", "SPORT", "RECENT"].includes(input.pushAudience)) {
      return { ok: false, error: "Audience must be ALL, SPORT or RECENT." };
    }
    // Judged by the SAME validator as every other message. This one reaches
    // people who are not in the match, so a blank or malformed template here
    // is the one that would go out to the whole install base.
    if (input.postedPush !== undefined) {
      const bad = templateRefusal(input.postedPush);
      if (bad) return { ok: false, error: bad };
    }
    if (input.homeCardBadge && !["NEW", "BETA", "NONE"].includes(input.homeCardBadge)) {
      return { ok: false, error: "Badge must be NEW, BETA or NONE." };
    }


    await db.challengeSettings.upsert({
      where: { id: "singleton" },
      update: data,
      create: { id: "singleton", ...data },
    });
    revalidatePath("/admin/challenges");
    return { ok: true };
  } catch (e) {
    // Only OUR messages reach the venue. A Prisma validation dump carries
    // absolute source paths, a code excerpt and the argument tree straight
    // into the admin UI.
    // ALLOWLIST our own wording rather than denylisting Prisma's. A plain
    // TypeError passed the old filter, so the venue was shown
    // "Cannot read properties of null (reading 'minsLeft')".
    const msg = e instanceof Error ? e.message : "";
    const ours = msg.length > 0 && msg.length < 160 && /must be|can't|cannot be a|needs a/i.test(msg);
    return { ok: false, error: ours ? msg : "That value isn't one this setting accepts." };
  }
}

/**
 * Take a challenge down.
 *
 * Anyone signed in may post, which is the right call for a board that
 * needs volume — but it means the venue has to be able to remove one. The
 * reason is stored, and shown to whoever posted it.
 */
/**
 * Mark a captured challenge payment as refunded.
 *
 * The refunds panel told the venue to "refund in Razorpay, then mark it
 * refunded on the payment" — and nothing anywhere could do the second half.
 * So the panel only grew, its total never fell, and a challenge whose money
 * was flagged could never be taken down, because the take-down guard counted
 * flagged money as held.
 *
 * This records the arena's own act. It does not call Razorpay: refunds here
 * are made by hand in Razorpay's dashboard (and sometimes in cash at the
 * counter), so a button that claimed to move money would be lying about
 * which system is the record.
 */
export async function markChallengePaymentRefunded(
  paymentId: string,
  note: string,
  /** Which queue this debt came from. Orders carry captures no payment row
   *  can account for any more, so they are closed out on the ledger. */
  source: "payment" | "order" = "payment",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await gate();
  if (source === "order") {
    const o = await db.challengeOrder.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        userId: true,
        challengeId: true,
        amount: true,
        side: true,
        refundedAt: true,
        strandedAt: true,
        settledAt: true,
      },
    });
    if (!o) return { ok: false, error: "That payment is gone." };
    if (!o.strandedAt) return { ok: false, error: "That one was never stranded." };
    // A settled order's money reached a live booking. If it is ALSO flagged
    // stranded, something replayed its capture — refunding it would pay for a
    // court that was bought and played.
    if (o.settledAt) {
      return {
        ok: false,
        error: "That payment reached a booking — it is not owed back. Tell whoever flagged it.",
      };
    }
    if (o.refundedAt) return { ok: false, error: "That one is already marked refunded." };
    const done = await db.challengeOrder.updateMany({
      where: { id: o.id, refundedAt: null },
      data: {
        refundedAt: new Date(),
        refundedBy: admin.id,
        refundNote: note.trim().slice(0, 200) || null,
      },
    });
    if (done.count === 0) return { ok: false, error: "That one is already marked refunded." };
    const { logChallengeEvent } = await import("@/lib/challenges");
    await logChallengeEvent({
      type: "REFUNDED",
      userId: o.userId,
      challengeId: o.challengeId,
      detail: `refunded ₹${o.amount} to the ${o.side.toLowerCase()} (capture with no live slot)${
        note.trim() ? ` · ${note.trim().slice(0, 120)}` : ""
      }`,
    });
    const { notifyUser } = await import("@/lib/user-notifications");
    await notifyUser(o.userId, {
      type: "CHALLENGE_REFUND_OWED",
      title: "Your refund is on its way",
      body: `The arena has refunded ₹${o.amount}. It can take a few working days to appear.`,
      link: `/challenges/${o.challengeId}`,
    }).catch(() => undefined);
    revalidatePath("/admin/challenges");
    return { ok: true };
  }

  const row = await db.challengePayment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      amount: true,
      side: true,
      userId: true,
      challengeId: true,
      paidAt: true,
      refundOwedAt: true,
      refundedAt: true,
    },
  });
  if (!row) return { ok: false, error: "That payment is gone." };
  if (!row.paidAt) return { ok: false, error: "Nothing was ever captured on that one." };
  if (row.refundedAt) return { ok: false, error: "That one is already marked refunded." };
  // ONLY money that is actually owed back.
  //
  // This branch checked `paidAt` and `refundedAt` and nothing else, while its
  // sibling ten lines above correctly refuses a settled order. So a healthy
  // half of a CONFIRMED match — money sitting on a real, booked court — could
  // be marked refunded: the challenge ledger and the booking ledger then
  // disagree about that court, and the customer is pushed "your refund is on
  // its way" for money nobody is returning.
  if (!row.refundOwedAt) {
    // Say which situation it is. "Cancel the booking" is useless advice to
    // somebody who has just cancelled it — and that is exactly when they come
    // looking for this control.
    const c = await db.challenge.findUnique({
      where: { id: row.challengeId },
      select: { bookingId: true, booking: { select: { status: true } } },
    });
    const live = c?.bookingId && c.booking?.status !== "CANCELLED";
    return {
      ok: false,
      error: live
        ? "That payment isn't owed back — it's on a live booking. Cancel the booking if you need to refund it."
        : "That payment isn't flagged as owed. Take the challenge down from the challenges board — that is what flags it and tells everyone.",
    };
  }

  // Conditional, because this is a public POST endpoint and two clicks a
  // second apart must not write two audit lines for one refund.
  const done = await db.challengePayment.updateMany({
    where: { id: paymentId, refundedAt: null },
    data: {
      refundedAt: new Date(),
      refundedBy: admin.id,
      refundNote: note.trim().slice(0, 200) || null,
    },
  });
  if (done.count === 0) return { ok: false, error: "That one is already marked refunded." };

  const { logChallengeEvent } = await import("@/lib/challenges");
  await logChallengeEvent({
    type: "REFUNDED",
    userId: row.userId,
    challengeId: row.challengeId,
    detail: `refunded ₹${row.amount} to the ${row.side.toLowerCase()}${
      note.trim() ? ` · ${note.trim().slice(0, 120)}` : ""
    }`,
  });
  const { notifyUser } = await import("@/lib/user-notifications");
  await notifyUser(row.userId, {
    type: "CHALLENGE_REFUND_OWED",
    title: "Your refund is on its way",
    body: `The arena has refunded ₹${row.amount}. It can take a few working days to appear.`,
    link: `/challenges/${row.challengeId}`,
  }).catch(() => undefined);

  revalidatePath("/admin/challenges");
  return { ok: true };
}

export async function adminWithdrawChallenge(
  id: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await gate();
  if (!reason.trim()) return { ok: false, error: "Give a reason — the poster sees it." };
  const c = await db.challenge.findUnique({
    where: { id },
    select: {
      status: true,
      bookingId: true,
      booking: { select: { status: true } },
      // Money that is FLAGGED for refund is already resolved as far as this
      // action is concerned — the refunds panel owns it. Counting it as held
      // made a SLOT_LOST challenge permanently un-takedownable: the refusal
      // told the venue to cancel a booking that does not exist and refund
      // money already flagged, and the button that would have followed that
      // instruction was hidden by the same rule.
      payments: {
        where: { paidAt: { not: null }, refundedAt: null, refundOwedAt: null },
        select: { amount: true },
      },
    },
  });
  if (!c) return { ok: false, error: "That challenge is gone." };

  // Already closed. Every "use server" export is a public POST endpoint, so
  // hiding the button is not the same as refusing the action — this used to
  // overwrite the original takedown reason and log a second event.
  if (["WITHDRAWN", "EXPIRED"].includes(c.status)) {
    return { ok: false, error: "That one is already closed." };
  }
  // PART_PAID is money in the bank against a court this system is holding.
  // Taking it down wrote the Challenge row and NOTHING else: the PENDING
  // booking kept the hour off the board for ever, the captain's payment was
  // neither refunded nor flagged, the second half became permanently
  // unpayable, and the case dropped out of the "half paid — needs a
  // decision" panel, which filters on PART_PAID. One click lost the money,
  // the court and the worklist entry at once — and the panel's own copy
  // says to cancel the booking and refund, which is not what the button
  // next to it did.
  // GUARD THE MONEY, NOT THE STATUS. Keying on PART_PAID missed the case it
  // was written for: a capture is claimed before the challenge's status is
  // written, so a process that dies in between leaves an AGREED challenge
  // holding a real paid half — invisible to the "half paid" panel, which
  // also filters on PART_PAID, and still offering this button. SLOT_LOST is
  // the same shape, and its own event copy says a refund is owed.
  // Booked first: on a confirmed match the booking IS the thing to act on,
  // and being told about the money instead sends the venue to the wrong
  // screen.
  // A CANCELLED booking is not a booking. Refusing on status alone told the
  // venue to cancel a court they had already cancelled, and left the money with
  // no route out at all.
  if (c.status === "CONFIRMED" && c.bookingId && c.booking?.status !== "CANCELLED") {
    return { ok: false, error: "That match is booked — cancel the booking instead." };
  }
  const held = c.payments.reduce((sum, p) => sum + p.amount, 0);
  // A BOOKED court is the booking's business — cancelling it there is what
  // releases the hour and moves the money.
  //
  // A LIVE booking, though. The guard above learned that a CANCELLED booking
  // is not a booking; this one still asked only whether `bookingId` was set,
  // so a challenge whose court had been cancelled or refunded was told to
  // "cancel the booking and refund first" — the thing the venue had just
  // done — while mark-refunded refused in the other direction. A closed loop
  // with no way out of it in the product. Both guards ask the same question
  // now.
  if (held > 0 && c.bookingId && c.booking?.status !== "CANCELLED") {
    return {
      ok: false,
      error: `₹${held} has been paid on this one and the court is booked. Cancel the booking and refund first — that releases the hour.`,
    };
  }
  // No booking, but money in. This used to refuse with "refund it from the
  // refunds panel first" — and the payment was not ON that panel, because
  // nothing had flagged it. Nothing in the product could flag it either, so
  // the challenge was permanently un-takedownable and the venue got a dead row
  // with no button and an instruction it could not follow.
  //
  // Taking it down IS the venue deciding to unwind it, so the action does the
  // unwinding: flag every capture as owed, tell each payer, and tell the arena
  // whose money it is. Nothing is held, so there is no court to release.
  const heldToFlag = held > 0;

  // CLAIM THE CHALLENGE FIRST, AND CONDITIONALLY.
  //
  // This read the challenge once, decided from that snapshot, flagged every
  // capture for refund, and only then wrote WITHDRAWN with no predicate at
  // all. So a take-down landing while the second captain's payment was between
  // its own guard-read and its booking attach produced the worst outcome this
  // module has: a CONFIRMED booking holding the hour, the challenge WITHDRAWN
  // and therefore off every worklist, BOTH halves flagged for refund, and both
  // captains sent "match confirmed" and "we owe you a refund". Four times out
  // of four. The venue reaches for take-down exactly when a challenge is
  // half-paid and stalling — which is when the second captain is paying.
  //
  // `discardForLostHour` was given this predicate; this was not.
  const claimed = await db.challenge.updateMany({
    where: {
      id,
      bookingId: null,
      status: { notIn: ["WITHDRAWN", "EXPIRED", "CONFIRMED"] },
    },
    data: {
      status: "WITHDRAWN",
      withdrawnAt: new Date(),
      withdrawnBy: admin.id,
      withdrawReason: reason.trim().slice(0, 200),
    },
  });
  if (claimed.count === 0) {
    return {
      ok: false,
      error:
        "Somebody paid for this match while you were looking at it — it's booked now. Cancel the booking instead.",
    };
  }
  // Only once the challenge is ours does the money move. Flagging before the
  // claim meant a match that confirmed in the meantime had both its halves
  // marked as refunds owed anyway.
  if (heldToFlag) {
    const { flagChallengeRefunds } = await import("@/lib/challenge-payments");
    await flagChallengeRefunds(id, `the arena took this challenge down: ${reason.trim().slice(0, 120)}`);
  }
  const { logChallengeEvent } = await import("@/lib/challenges");
  await logChallengeEvent({
    type: "ADMIN_TOOK_DOWN",
    challengeId: id,
    detail: reason.trim().slice(0, 200),
  });
  revalidatePath("/admin/challenges");
  return { ok: true };
}
