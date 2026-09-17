import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  DEFAULT_LIMITS,
  postRefusal,
  acceptRefusal,
  counterRefusal,
  withdrawRefusal,
  expiryFor,
  windowRefusal,
  sideOf,
  type ChallengeLimits,
  type ProposedWindow,
} from "@/lib/challenge-rules";

/**
 * The challenge board's data layer.
 *
 * Every decision is made by lib/challenge-rules, which is pure and tested;
 * this file only reads, writes and translates. Keeping the two apart is
 * what lets the phone and the server agree, and is the lesson from the two
 * cricket engines that did not.
 */

const SINGLETON = "singleton";

/** The venue's settings, creating the row on first read. */
export async function challengeSettings() {
  const row = await db.challengeSettings.upsert({
    where: { id: SINGLETON },
    update: {},
    create: { id: SINGLETON },
  });
  return row;
}

export async function challengeLimits(): Promise<ChallengeLimits> {
  const s = await challengeSettings();
  return {
    enabled: s.enabled,
    minPlayers: s.minPlayers,
    maxPlayers: s.maxPlayers,
    maxWindows: s.maxWindows,
    maxCountersPerSide: s.maxCountersPerSide,
    ttlDays: s.ttlDays,
    sports: s.sports as string[],
  };
}

/** Everything a board card or a detail screen needs, in one shape. */
const listSelect = {
  id: true,
  sport: true,
  teamName: true,
  playerCount: true,
  notes: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  createdByUserId: true,
  acceptedByUserId: true,
  agreedWindowId: true,
  counterCountChallenger: true,
  counterCountAcceptor: true,
  bookingId: true,
  createdBy: { select: { id: true, name: true } },
  acceptedBy: { select: { id: true, name: true } },
  windows: {
    where: { status: { not: "SUPERSEDED" } },
    select: {
      id: true,
      date: true,
      startHour: true,
      endHour: true,
      proposedBy: true,
      status: true,
      courtConfig: { select: { id: true, label: true } },
    },
    orderBy: [{ createdAt: "asc" }],
  },
} satisfies Prisma.ChallengeSelect;

export type ChallengeRow = Awaited<ReturnType<typeof listOpenChallenges>>[number];

/** The board: live challenges anyone may still take up. */
export async function listOpenChallenges(args?: { sport?: string; viewerId?: string }) {
  const now = new Date();
  return db.challenge.findMany({
    where: {
      status: { in: ["OPEN", "COUNTERED"] },
      expiresAt: { gt: now },
      ...(args?.sport ? { sport: args.sport as never } : {}),
    },
    select: listSelect,
    orderBy: { createdAt: "desc" },
    take: 60,
  });
}

/** Challenges this user posted or took up, live or finished. */
export async function listMyChallenges(userId: string) {
  return db.challenge.findMany({
    where: { OR: [{ createdByUserId: userId }, { acceptedByUserId: userId }] },
    select: listSelect,
    orderBy: { createdAt: "desc" },
    take: 60,
  });
}

export async function getChallenge(id: string) {
  return db.challenge.findUnique({ where: { id }, select: listSelect });
}

// ── Writes ─────────────────────────────────────────────────────────

export async function postChallenge(input: {
  userId: string;
  sport: string;
  teamName?: string | null;
  playerCount: number;
  notes?: string | null;
  windows: ProposedWindow[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const limits = await challengeLimits();
  const now = new Date();
  const refusal = postRefusal(
    { sport: input.sport, playerCount: input.playerCount, windows: input.windows },
    limits,
    now,
  );
  if (refusal) return { ok: false, error: refusal };

  // One live challenge at a time per person. Without it the board fills
  // with one captain's five posts and nobody else is visible.
  const existing = await db.challenge.count({
    where: {
      createdByUserId: input.userId,
      status: { in: ["OPEN", "COUNTERED", "AGREED", "PART_PAID"] },
    },
  });
  if (existing > 0) {
    return { ok: false, error: "You already have a challenge up. Withdraw it first." };
  }

  const created = await db.challenge.create({
    data: {
      createdByUserId: input.userId,
      sport: input.sport as never,
      teamName: input.teamName?.trim()?.slice(0, 60) || null,
      playerCount: input.playerCount,
      notes: input.notes?.trim()?.slice(0, 300) || null,
      expiresAt: expiryFor(input.windows, limits, now),
      windows: {
        create: input.windows.map((w) => ({
          date: new Date(`${w.date}T00:00:00.000Z`),
          startHour: w.startHour,
          endHour: w.endHour,
          courtConfigId: w.courtConfigId || null,
          proposedBy: "CHALLENGER" as const,
          proposedByUserId: input.userId,
        })),
      },
    },
    select: { id: true },
  });
  return { ok: true, id: created.id };
}

/** Take up one of the windows on the table. */
export async function acceptChallengeWindow(
  challengeId: string,
  windowId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = new Date();
  const c = await db.challenge.findUnique({
    where: { id: challengeId },
    select: {
      status: true,
      createdByUserId: true,
      acceptedByUserId: true,
      expiresAt: true,
      counterCountChallenger: true,
      counterCountAcceptor: true,
      windows: { select: { id: true, status: true, proposedBy: true } },
    },
  });
  if (!c) return { ok: false, error: "That challenge is gone." };
  const refusal = acceptRefusal(c, userId, now);
  if (refusal) return { ok: false, error: refusal };

  const w = c.windows.find((x) => x.id === windowId);
  if (!w || w.status === "SUPERSEDED" || w.status === "DECLINED") {
    return { ok: false, error: "That time is no longer on the table." };
  }
  // You may only accept a time the OTHER side put up.
  const mySide = sideOf(c, userId) ?? "ACCEPTOR";
  if (w.proposedBy === mySide) {
    return { ok: false, error: "That's your own suggestion — wait for their answer." };
  }

  await db.$transaction([
    db.challengeWindow.update({ where: { id: windowId }, data: { status: "ACCEPTED" } }),
    db.challengeWindow.updateMany({
      where: { challengeId, id: { not: windowId }, status: "OFFERED" },
      data: { status: "DECLINED" },
    }),
    db.challenge.update({
      where: { id: challengeId },
      data: {
        status: "AGREED",
        agreedWindowId: windowId,
        agreedAt: now,
        // A stranger accepting becomes the acceptor by doing so.
        ...(c.acceptedByUserId ? {} : { acceptedByUserId: userId, acceptedAt: now }),
      },
    }),
  ]);
  return { ok: true };
}

/** Offer a different time. Becomes the acceptor if nobody was yet. */
export async function counterChallenge(
  challengeId: string,
  userId: string,
  window: ProposedWindow,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const limits = await challengeLimits();
  const now = new Date();
  const c = await db.challenge.findUnique({
    where: { id: challengeId },
    select: {
      status: true,
      createdByUserId: true,
      acceptedByUserId: true,
      expiresAt: true,
      counterCountChallenger: true,
      counterCountAcceptor: true,
    },
  });
  if (!c) return { ok: false, error: "That challenge is gone." };
  const refusal = counterRefusal(c, userId, limits, now);
  if (refusal) return { ok: false, error: refusal };
  const bad = windowRefusal(window, now);
  if (bad) return { ok: false, error: bad };

  const side = sideOf(c, userId) ?? "ACCEPTOR";
  await db.$transaction([
    // A side's previous suggestion is superseded, never left on the table
    // — otherwise the other captain can accept a time already replaced.
    db.challengeWindow.updateMany({
      where: { challengeId, proposedBy: side, status: "OFFERED" },
      data: { status: "SUPERSEDED" },
    }),
    db.challengeWindow.create({
      data: {
        challengeId,
        date: new Date(`${window.date}T00:00:00.000Z`),
        startHour: window.startHour,
        endHour: window.endHour,
        courtConfigId: window.courtConfigId || null,
        proposedBy: side,
        proposedByUserId: userId,
      },
    }),
    db.challenge.update({
      where: { id: challengeId },
      data: {
        status: "COUNTERED",
        ...(side === "CHALLENGER"
          ? { counterCountChallenger: { increment: 1 } }
          : { counterCountAcceptor: { increment: 1 } }),
        ...(c.acceptedByUserId ? {} : { acceptedByUserId: userId, acceptedAt: now }),
      },
    }),
  ]);
  return { ok: true };
}

export async function withdrawChallenge(
  challengeId: string,
  userId: string,
  reason?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await db.challenge.findUnique({
    where: { id: challengeId },
    select: {
      status: true,
      createdByUserId: true,
      acceptedByUserId: true,
      expiresAt: true,
      counterCountChallenger: true,
      counterCountAcceptor: true,
    },
  });
  if (!c) return { ok: false, error: "That challenge is gone." };
  const refusal = withdrawRefusal(c, userId);
  if (refusal) return { ok: false, error: refusal };
  await db.challenge.update({
    where: { id: challengeId },
    data: {
      status: "WITHDRAWN",
      withdrawnAt: new Date(),
      withdrawnBy: userId,
      withdrawReason: reason?.slice(0, 200) || null,
    },
  });
  return { ok: true };
}

/**
 * Close out anything past its deadline.
 *
 * Called on read rather than by a cron: the board is the only place
 * expiry matters, and a challenge that looks live for ten more minutes
 * because a job has not run yet is a challenge somebody taps and cannot
 * take.
 */
export async function expireStaleChallenges(): Promise<number> {
  const res = await db.challenge.updateMany({
    where: {
      status: { in: ["OPEN", "COUNTERED"] },
      expiresAt: { lte: new Date() },
    },
    data: { status: "EXPIRED" },
  });
  return res.count;
}

export { DEFAULT_LIMITS };
