"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
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
      cardTapped: n("HOME_CARD_TAPPED"),
      boardViewed: n("BOARD_VIEWED"),
      postOpened: n("POST_OPENED"),
      posted: n("POSTED"),
      detailViewed: n("DETAIL_VIEWED"),
      accepted: n("ACCEPTED"),
      countered: n("COUNTERED"),
      refused: n("REFUSED"),
    },
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
  holdMinsAfterFirstPayment?: number;
  pushAudience?: string;
  pushDailyCap?: number;
  boardTitle?: string | null;
  boardSubtitle?: string | null;
  emptyText?: string | null;
  homeCardEnabled?: boolean;
  homeCardTitle?: string | null;
  homeCardSubtitle?: string | null;
  homeCardBadge?: string;
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
      ...(num(input.holdMinsAfterFirstPayment, 0, 120, "Hold after first payment") !== undefined
        ? { holdMinsAfterFirstPayment: input.holdMinsAfterFirstPayment }
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
    };

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
