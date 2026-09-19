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
} from "@/lib/challenge-push";
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
      ...(input.pushAudience ? { pushAudience: input.pushAudience } : {}),
      ...(num(input.pushDailyCap, 0, 50, "Push cap") !== undefined
        ? { pushDailyCap: input.pushDailyCap }
        : {}),
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

    if (n("minPlayers", 1) > n("maxPlayers", 30)) {
      return { ok: false, error: "Minimum players can't exceed the maximum." };
    }
    if (n("spinAvgMinPct", 15) > n("spinAvgMaxPct", 25)) {
      return {
        ok: false,
        error: "The average floor can't be above the ceiling — no wheel could satisfy both.",
      };
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
    const touchesWheel =
      input.spinSegments !== undefined ||
      input.spinAvgMinPct !== undefined ||
      input.spinAvgMaxPct !== undefined;
    const touchesAdjacent =
      input.spinAdjacentPushes !== undefined || input.spinAdjacentWindowMins !== undefined;
    const touchesFallback =
      input.spinFallbackPushes !== undefined || input.spinFallbackWindowMins !== undefined;

    // The SAME resolver the runtime uses. Two copies of this rule have now
    // disagreed twice; there is one.
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

    if (input.pushAudience && !["ALL", "SPORT", "RECENT"].includes(input.pushAudience)) {
      return { ok: false, error: "Audience must be ALL, SPORT or RECENT." };
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
      payments: { where: { paidAt: { not: null }, refundedAt: null }, select: { amount: true } },
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
  const held = c.payments.reduce((sum, p) => sum + p.amount, 0);
  if (held > 0) {
    return {
      ok: false,
      error: `₹${held} has been paid on this one and the court may be held. Cancel the booking and refund first — that releases the hour.`,
    };
  }
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
