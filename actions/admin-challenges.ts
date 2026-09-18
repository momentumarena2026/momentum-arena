"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { wheelRefusal } from "@/lib/challenge-rules";
import { pushScheduleRefusal } from "@/lib/challenge-push";
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
  const [settings, challenges, counts, events, eventCounts, refusals] = await Promise.all([
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
          select: { side: true, amount: true, paidAt: true, refundedAt: true },
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
  ]);

  // Funnel: what proportion of the people who saw the card ever posted.
  const n = (t: string) => eventCounts.find((e) => e.type === t)?._count ?? 0;
  return {
    settings,
    challenges,
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
        expiresAt: true,
        booking: { select: { totalAmount: true, originalAmount: true, discountAmount: true } },
      },
    }),
  ]);

  const taken = offers.filter((o) => o.takenAt);
  const discounted = taken.reduce((sum, o) => sum + (o.booking?.discountAmount ?? 0), 0);
  const collected = taken.reduce((sum, o) => sum + (o.booking?.totalAmount ?? 0), 0);
  const realisedAvg =
    spins.length > 0 ? spins.reduce((s, x) => s + x.wonPct, 0) / spins.length : 0;

  return {
    spins: spins.length,
    offersMade: offers.length,
    offersTaken: taken.length,
    offersLapsed: offers.filter((o) => !o.takenAt && o.expiresAt <= new Date()).length,
    adjacentMade: offers.filter((o) => o.kind === "ADJACENT").length,
    adjacentTaken: taken.filter((o) => o.kind === "ADJACENT").length,
    fallbackMade: offers.filter((o) => o.kind === "FALLBACK").length,
    fallbackTaken: taken.filter((o) => o.kind === "FALLBACK").length,
    /// Rupees given away, and rupees taken on hours that would otherwise
    /// have sat empty. The second is the number that justifies the first.
    discounted,
    collected,
    realisedAvgPct: Math.round(realisedAvg * 10) / 10,
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
  pushAudience?: string;
  pushDailyCap?: number;
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
      ...(input.sports ? { sports: input.sports as never } : {}),
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
      ...(input.pushAudience ? { pushAudience: input.pushAudience } : {}),
      ...(num(input.pushDailyCap, 0, 50, "Push cap") !== undefined
        ? { pushDailyCap: input.pushDailyCap }
        : {}),
      ...(input.boardTitle !== undefined ? { boardTitle: input.boardTitle || null } : {}),
      ...(input.boardSubtitle !== undefined
        ? { boardSubtitle: input.boardSubtitle || null }
        : {}),
      ...(input.emptyText !== undefined ? { emptyText: input.emptyText || null } : {}),
      ...(input.homeCardEnabled !== undefined
        ? { homeCardEnabled: input.homeCardEnabled }
        : {}),
      ...(input.homeCardTitle !== undefined
        ? { homeCardTitle: input.homeCardTitle || null }
        : {}),
      ...(input.homeCardSubtitle !== undefined
        ? { homeCardSubtitle: input.homeCardSubtitle || null }
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
      ...(num(input.spinsPerPosterCap, 0, 100, "Spins per poster") !== undefined
        ? { spinsPerPosterCap: input.spinsPerPosterCap }
        : {}),
      ...(num(input.spinsPerPosterPerDays, 0, 365, "Spin cap window") !== undefined
        ? { spinsPerPosterPerDays: input.spinsPerPosterPerDays }
        : {}),
      ...(input.spinWonPush ? { spinWonPush: input.spinWonPush as never } : {}),
    };

    // The wheel is checked against the band BEFORE it is stored. A venue
    // hand-tuning weights will drift, and a wheel paying 40% on average
    // looks exactly like one paying 18% until the month's numbers arrive.
    if (input.spinSegments) {
      const current = await db.challengeSettings.findFirst({
        select: { spinAvgMinPct: true, spinAvgMaxPct: true },
      });
      const lo = input.spinAvgMinPct ?? current?.spinAvgMinPct ?? 15;
      const hi = input.spinAvgMaxPct ?? current?.spinAvgMaxPct ?? 25;
      const bad = wheelRefusal(input.spinSegments, lo, hi);
      if (bad) return { ok: false, error: bad };
      Object.assign(data, { spinSegments: input.spinSegments as never });
    }

    // A nudge configured outside its own window never fires, and nothing
    // else in the system would ever say so.
    for (const [key, list, winKey, fallbackWin] of [
      ["spinAdjacentPushes", input.spinAdjacentPushes, input.spinAdjacentWindowMins, 30],
      ["spinFallbackPushes", input.spinFallbackPushes, input.spinFallbackWindowMins, 120],
    ] as const) {
      if (!list) continue;
      const current = await db.challengeSettings.findFirst({
        select: { spinAdjacentWindowMins: true, spinFallbackWindowMins: true },
      });
      const win =
        winKey ??
        (key === "spinAdjacentPushes"
          ? current?.spinAdjacentWindowMins
          : current?.spinFallbackWindowMins) ??
        fallbackWin;
      const bad = pushScheduleRefusal(list, win);
      if (bad) return { ok: false, error: bad };
      Object.assign(data, { [key]: list as never });
    }

    if (
      data.minPlayers !== undefined &&
      data.maxPlayers !== undefined &&
      data.minPlayers > data.maxPlayers
    ) {
      return { ok: false, error: "Minimum players can't exceed the maximum." };
    }

    await db.challengeSettings.upsert({
      where: { id: "singleton" },
      update: data,
      create: { id: "singleton", ...data },
    });
    revalidatePath("/admin/challenges");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save." };
  }
}

/**
 * Take a challenge down.
 *
 * Anyone signed in may post, which is the right call for a board that
 * needs volume — but it means the venue has to be able to remove one. The
 * reason is stored, and shown to whoever posted it.
 */
export async function adminWithdrawChallenge(
  id: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await gate();
  if (!reason.trim()) return { ok: false, error: "Give a reason — the poster sees it." };
  const c = await db.challenge.findUnique({ where: { id }, select: { status: true } });
  if (!c) return { ok: false, error: "That challenge is gone." };
  if (c.status === "CONFIRMED") {
    return { ok: false, error: "That match is booked — cancel the booking instead." };
  }
  await db.challenge.update({
    where: { id },
    data: {
      status: "WITHDRAWN",
      withdrawnAt: new Date(),
      withdrawnBy: admin.id,
      withdrawReason: reason.trim().slice(0, 200),
    },
  });
  const { logChallengeEvent } = await import("@/lib/challenges");
  await logChallengeEvent({
    type: "ADMIN_TOOK_DOWN",
    challengeId: id,
    detail: reason.trim().slice(0, 200),
  });
  revalidatePath("/admin/challenges");
  return { ok: true };
}
