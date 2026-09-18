import { db } from "@/lib/db";
import { Prisma, type ChallengeEventType } from "@prisma/client";
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


/**
 * Record what happened.
 *
 * Best-effort and never awaited into a failure: a board that stops working
 * because its telemetry did would be a worse feature than one nobody can
 * measure. Every write path logs, and so does every REFUSAL — the refusal
 * sentences are the most useful rows in the table, because a board with no
 * posts looks the same whether nobody found it or everybody was turned
 * away, and only the reasons tell those apart.
 */
export async function logChallengeEvent(args: {
  // Taken from the schema rather than restated here: a hand-copied union of
  // the same names drifts the first time someone adds an event type and only
  // edits one of the two lists.
  type: ChallengeEventType;
  userId?: string | null;
  challengeId?: string | null;
  detail?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await db.challengeEvent.create({
      data: {
        type: args.type,
        userId: args.userId ?? null,
        challengeId: args.challengeId ?? null,
        detail: args.detail?.slice(0, 300) ?? null,
        meta: (args.meta as never) ?? undefined,
      },
    });
  } catch {
    /* telemetry must never break the thing it is measuring */
  }
}

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
/**
 * The challenges a viewer could actually take.
 *
 * Two exclusions, both of which are about not showing somebody a dead end:
 *
 * - Their own posts. Those belong under "Yours", with a Withdraw on them.
 * - Anything that already has an acceptor. Countering claims the acceptor
 *   slot, so a challenge with one is a live negotiation between two named
 *   captains — `counterRefusal` turns a stranger away from it with "Someone
 *   else is already negotiating this one", and the acceptor themselves has it
 *   under "Yours". Leaving those on the open board listed the viewer's own
 *   negotiation back to them a second time.
 *
 * `viewerId` is optional only because the admin board reads this with no
 * viewer; every app caller passes it.
 */
export async function listOpenChallenges(args?: { sport?: string; viewerId?: string }) {
  const now = new Date();
  return db.challenge.findMany({
    where: {
      status: { in: ["OPEN", "COUNTERED"] },
      expiresAt: { gt: now },
      ...(args?.viewerId
        ? { createdByUserId: { not: args.viewerId }, acceptedByUserId: null }
        : {}),
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
  if (refusal) {
    await logChallengeEvent({ type: "REFUSED", userId: input.userId, detail: refusal });
    return { ok: false, error: refusal };
  }

  // One live challenge at a time per person. Without it the board fills
  // with one captain's five posts and nobody else is visible.
  const existing = await db.challenge.count({
    where: {
      createdByUserId: input.userId,
      status: { in: ["OPEN", "COUNTERED", "AGREED", "PART_PAID"] },
    },
  });
  if (existing > 0) {
    const why = "You already have a challenge up. Withdraw it first.";
    await logChallengeEvent({ type: "REFUSED", userId: input.userId, detail: why });
    return { ok: false, error: why };
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
  await logChallengeEvent({
    type: "POSTED",
    userId: input.userId,
    challengeId: created.id,
    detail: `${input.sport} · ${input.playerCount} players · ${input.windows.length} time(s)`,
    meta: { sport: input.sport, playerCount: input.playerCount, windows: input.windows },
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
  if (refusal) {
    await logChallengeEvent({ type: "REFUSED", userId, challengeId, detail: refusal });
    return { ok: false, error: refusal };
  }

  const w = c.windows.find((x) => x.id === windowId);
  if (!w || w.status === "SUPERSEDED" || w.status === "DECLINED") {
    const why = "That time is no longer on the table.";
    await logChallengeEvent({ type: "REFUSED", userId, challengeId, detail: why });
    return { ok: false, error: why };
  }
  // You may only accept a time the OTHER side put up.
  const mySide = sideOf(c, userId) ?? "ACCEPTOR";
  if (w.proposedBy === mySide) {
    const why = "That's your own suggestion — wait for their answer.";
    await logChallengeEvent({ type: "REFUSED", userId, challengeId, detail: why });
    return { ok: false, error: why };
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
  await logChallengeEvent({
    type: "ACCEPTED",
    userId,
    challengeId,
    detail: "match agreed",
    meta: { windowId },
  });
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
  if (refusal) {
    await logChallengeEvent({ type: "REFUSED", userId, challengeId, detail: refusal });
    return { ok: false, error: refusal };
  }
  const bad = windowRefusal(window, now);
  if (bad) {
    await logChallengeEvent({ type: "REFUSED", userId, challengeId, detail: bad });
    return { ok: false, error: bad };
  }

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
  await logChallengeEvent({
    type: "COUNTERED",
    userId,
    challengeId,
    detail: `${window.date} ${window.startHour}:00–${window.endHour}:00`,
    meta: { window, side },
  });
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
  if (refusal) {
    await logChallengeEvent({ type: "REFUSED", userId, challengeId, detail: refusal });
    return { ok: false, error: refusal };
  }
  await db.challenge.update({
    where: { id: challengeId },
    data: {
      status: "WITHDRAWN",
      withdrawnAt: new Date(),
      withdrawnBy: userId,
      withdrawReason: reason?.slice(0, 200) || null,
    },
  });
  await logChallengeEvent({
    type: "WITHDRAWN",
    userId,
    challengeId,
    detail: reason || "no reason given",
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
  // Read the doomed rows before updating them, so each one can be logged
  // individually. An expiry is the outcome half of the funnel: without it the
  // feed shows POSTED and then silence forever, and nothing distinguishes a
  // challenge still waiting for an answer from one that died unanswered —
  // which is this feature's whole failure mode.
  const stale = await db.challenge.findMany({
    where: {
      status: { in: ["OPEN", "COUNTERED"] },
      expiresAt: { lte: new Date() },
    },
    select: { id: true, createdByUserId: true, sport: true, status: true },
  });
  if (stale.length === 0) return 0;

  const res = await db.challenge.updateMany({
    where: { id: { in: stale.map((c) => c.id) } },
    data: { status: "EXPIRED" },
  });
  for (const c of stale) {
    void logChallengeEvent({
      type: "EXPIRED",
      challengeId: c.id,
      userId: c.createdByUserId,
      detail: `${c.sport} · nobody took it${c.status === "COUNTERED" ? " (a counter was on the table)" : ""}`,
    });
  }
  return res.count;
}

export { DEFAULT_LIMITS };
