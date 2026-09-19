import { db } from "@/lib/db";
import { notifyUser } from "@/lib/user-notifications";
import { getOperatingHours } from "@/lib/court-config";
import { Prisma, type ChallengeEventType } from "@prisma/client";
import {
  DEFAULT_LIMITS,
  postRefusal,
  acceptRefusal,
  counterRefusal,
  withdrawRefusal,
  expiryFor,
  windowStart,
  leadTimeRefusal,
  KNOWN_SPORTS,
  windowRefusal,
  sideOf,
  hourWord,
  type ChallengeLimits,
  type ProposedWindow,
} from "@/lib/challenge-rules";
import { renderPush, resolveTemplate, DEFAULT_LIFECYCLE_PUSHES } from "@/lib/challenge-push";
import { istDayLabel } from "@/lib/challenge-spin";

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
  const [s, hours] = await Promise.all([challengeSettings(), getOperatingHours()]);
  return {
    openHour: hours.start,
    closeHour: hours.end,
    enabled: s.enabled,
    minPlayers: s.minPlayers,
    maxPlayers: s.maxPlayers,
    maxWindows: s.maxWindows,
    maxCountersPerSide: s.maxCountersPerSide,
    ttlDays: s.ttlDays,
    minLeadMins: s.minLeadMins,
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
  // Whether the poster has already spun, so the board card can stop
  // advertising "prize inside" on a prize that has been spent.
  spin: { select: { id: true } },
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
  // Past the lead time nobody can take it, so it must not be advertised.
  // `expiryFor` pins expiry to the match start, so every challenge aged
  // into a four-hour window where it sat on the board with a live priced
  // button and refused on tap. Posted ≥4h out, this happened on its own.
  const lead = (await db.challengeSettings.findFirst({ select: { minLeadMins: true } }))
    ?.minLeadMins;
  const takeableUntil = new Date(now.getTime() + (lead ?? 240) * 60000);
  return db.challenge.findMany({
    where: {
      status: { in: ["OPEN", "COUNTERED"] },
      expiresAt: { gt: takeableUntil },
      ...(args?.viewerId
        ? { createdByUserId: { not: args.viewerId }, acceptedByUserId: null }
        : {}),
      // Validated, not cast. An unknown string used to reach the Prisma
      // enum and 500 the whole board for that caller — a lowercase "cricket"
      // was enough.
      ...(args?.sport && KNOWN_SPORTS.includes(args.sport)
        ? { sport: args.sport as never }
        : {}),
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

  // One challenge ON THE BOARD at a time per person. Without it the board
  // fills with one captain's five posts and nobody else is visible.
  //
  // PART_PAID is deliberately NOT on this list. It is a matched challenge
  // with money in it — off the board, unwithdrawable by rule, and never
  // swept — so counting it as "up" locked the captain who paid FIRST out of
  // the board for ever if their opponent never paid, while telling them to
  // withdraw something the app gives them no way to withdraw and the server
  // refuses. The one person who did everything right was the one punished.
  const existing = await db.challenge.count({
    where: {
      createdByUserId: input.userId,
      status: { in: ["OPEN", "COUNTERED", "AGREED"] },
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
  const limits = await challengeLimits();
  const c = await db.challenge.findUnique({
    where: { id: challengeId },
    select: {
      status: true,
      createdByUserId: true,
      acceptedByUserId: true,
      expiresAt: true,
      counterCountChallenger: true,
      counterCountAcceptor: true,
      teamName: true,
      windows: {
        select: {
          id: true,
          status: true,
          proposedBy: true,
          date: true,
          startHour: true,
          endHour: true,
        },
      },
    },
  });
  if (!c) return { ok: false, error: "That challenge is gone." };
  const win = c.windows.find((w) => w.id === windowId);
  const refusal = acceptRefusal(c, userId, now, limits, win ?? null);
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

  // Both captains are told, because at this instant BOTH owe a half and
  // whoever moves first takes the hour off the board. Telling only the
  // poster would make the race silently unfair to the person who just
  // accepted, and telling nobody is how an agreed match quietly expires.
  const [poster, taker] = await Promise.all([
    db.user.findUnique({ where: { id: c.createdByUserId }, select: { id: true, name: true } }),
    db.user.findUnique({ where: { id: c.acceptedByUserId ?? userId }, select: { id: true, name: true } }),
  ]);
  // The venue's words, not the code's. These are the messages a captain
  // actually reads, so leaving them in a TypeScript literal put the
  // most-read copy in the module beyond the reach of the person who knows
  // what to say.
  const tpl = resolveTemplate(
    (await db.challengeSettings.findFirst({ select: { agreedPush: true } }))?.agreedPush,
    DEFAULT_LIFECYCLE_PUSHES.agreed,
  );
  // The MONEY, not zeros.
  //
  // `court`, `amount`, `total` and `balance` were hard-coded empty and 0 here,
  // while the admin screen previewed them as "Full Field / 500 / 2000 / 1000".
  // The default copy for this very message is about paying halves, so "your
  // half is ₹{amount}" is the first edit a venue makes — and it sent "your
  // half is ₹0". Zeros are worse than blanks: they look like answers.
  // Imported lazily: `challenge-payments` imports `logChallengeEvent` from
  // this file, so a top-level import here closes a cycle, and a cycle whose
  // members are read at module-init time hands one of them `undefined`.
  const { challengeQuote } = await import("@/lib/challenge-payments");
  const money = await challengeQuote(challengeId, c.createdByUserId).catch(() => null);
  for (const [who, other] of [
    [poster, taker],
    [taker, poster],
  ] as const) {
    if (!who) continue;
    const vars = {
      name: other?.name ?? "The other captain",
      team: c.teamName ?? poster?.name ?? "the other side",
      hour: `${hourWord(w.startHour)}–${hourWord(w.endHour)}`,
      date: istDayLabel(w.date),
      court: money?.courtLabel ?? "",
      // Each captain's own half, which is what {amount} means everywhere else.
      amount: money?.shares?.[who.id === c.createdByUserId ? "CHALLENGER" : "ACCEPTOR"] ?? 0,
      total: money?.total ?? 0,
      balance: money?.venueBalance ?? 0,
    };
    await notifyUser(who.id, {
      type: "CHALLENGE_AGREED",
      title: renderPush(tpl.title, vars),
      body: renderPush(tpl.body, vars),
      link: `/challenges/${challengeId}`,
    });
  }
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
  const bad =
    windowRefusal(window, now, limits) ??
    // The lead-time rule belongs here too. Without it a captain could
    // counter with a slot two hours out, which stored fine, showed the other
    // side an "Accept this time" button, and then refused the acceptance —
    // having spent the counterer's ONE counter on a time nobody was ever
    // allowed to take.
    (limits.minLeadMins && limits.minLeadMins > 0
      ? leadTimeRefusal(
          windowStart(window.date, window.startHour),
          now,
          limits.minLeadMins,
        )
      : null);
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
        // A counter can propose a LATER date than anything on the original
        // challenge. Leaving expiresAt alone meant the agreed match could be
        // swept days before it was due to be played — and now that the sweep
        // covers AGREED-but-unpaid, that sweep would delete it.
        ...(windowStart(window.date, window.startHour).getTime() > c.expiresAt.getTime()
          ? { expiresAt: windowStart(window.date, window.startHour) }
          : {}),
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
      payments: { where: { paidAt: { not: null } }, select: { id: true } },
    },
  });
  if (!c) return { ok: false, error: "That challenge is gone." };
  const refusal = withdrawRefusal(c, userId, c.payments.length > 0);
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
      // AGREED is included — but only when nobody has paid. An arrangement
      // nobody funded must not outlive its own deadline: it blocked the
      // poster from withdrawing, from posting again, and from ever being
      // swept, which is a permanent lockout from one unpaid handshake.
      // AGREED WITH money in it is the venue's to unwind, never a sweep's.
      // The "nobody has paid" guard applies to EVERY status, not just
      // AGREED. A COUNTERED challenge can hold a captured payment — a
      // stranger who paid while it was OPEN, before somebody else countered
      // — and sweeping it to EXPIRED made that money vanish from every
      // surface at once.
      status: { in: ["OPEN", "COUNTERED", "AGREED"] },
      // Money that has been written off as a refund does not protect a
      // challenge from expiry — otherwise one stranded capture pins a dead
      // card to the board for ever.
      payments: { none: { paidAt: { not: null }, refundOwedAt: null } },
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
