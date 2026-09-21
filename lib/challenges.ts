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
import {
  renderPush,
  resolveTemplate,
  DEFAULT_LIFECYCLE_PUSHES,
  DEFAULT_POSTED_PUSH,
  type PostedVars,
} from "@/lib/challenge-push";
import { sendToTokens } from "@/lib/push";
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

/**
 * Why a named court cannot be pinned to a window — or null.
 *
 * `postRefusal` checks the sport against the arena's real list precisely
 * because an unknown string once reached Prisma and 500'd the board for
 * everyone. The court id one field over was never checked at all: it goes
 * straight into a foreign key, so an id naming nothing threw a raw
 * `PrismaClientKnownRequestError` out of the create, and the route has no
 * catch around its dispatch, so the caller got a 500. The realistic route to
 * it is not an attacker — it is the venue retiring a court while an app still
 * holds its id.
 *
 * A court is only pinnable if it is one the arena would actually have chosen:
 * active, and for this sport. `freeCourtFor` already ignores a preference that
 * fails that test, so accepting one here would silently book a different court
 * than the captain named, which is worse than saying so.
 *
 * Pure rules cannot do this — it needs the court table — so it lives here
 * rather than in `challenge-rules.ts`.
 */
async function pinnedCourtRefusal(
  sport: string,
  windows: { courtConfigId?: string | null }[],
): Promise<string | null> {
  const ids = [...new Set(windows.map((w) => w.courtConfigId).filter(Boolean))] as string[];
  if (ids.length === 0) return null;
  const found = await db.courtConfig.findMany({
    where: { id: { in: ids }, isActive: true, sport: sport as never },
    select: { id: true },
  });
  const ok = new Set(found.map((c) => c.id));
  return ids.every((id) => ok.has(id))
    ? null
    : "That court isn't one the arena is running for this sport right now.";
}

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

  const badCourt = await pinnedCourtRefusal(input.sport, input.windows);
  if (badCourt) {
    await logChallengeEvent({ type: "REFUSED", userId: input.userId, detail: badCourt });
    return { ok: false, error: badCourt };
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
      // Needed to judge a court the counter names: a court is only pinnable
      // if it is active AND for this challenge's sport.
      sport: true,
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
  // The counter writes a window too, into the same foreign key.
  const badCourt = await pinnedCourtRefusal(c.sport, [window]);
  if (badCourt) {
    await logChallengeEvent({ type: "REFUSED", userId, challengeId, detail: badCourt });
    return { ok: false, error: badCourt };
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

/* ── The board broadcast ─────────────────────────────────────────── */

/** Start of today in IST, as an instant. The cap is a per-day cap. */
function istDayStart(now: Date): Date {
  const IST = 5.5 * 3600_000;
  const ist = new Date(now.getTime() + IST);
  return new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST,
  );
}

/**
 * Who hears about a new post.
 *
 * Returns user ids, never devices — the caller resolves devices once, so
 * a person with a phone and a tablet is one recipient with two tokens
 * rather than two notifications.
 *
 * Each value is implemented. That matters more than it sounds: these
 * settings shipped once already as columns nothing read, and the fix was
 * to delete the admin panel rather than leave a control that lied. The
 * panel is back only because every branch below does what it says.
 */
async function postedAudience(
  audience: string,
  sport: string,
  recentDays: number,
  excludeUserId: string,
): Promise<string[]> {
  // Everyone starts from "has a device at all" — a user with no device is
  // not an audience member, they are a row.
  const withDevices = await db.pushDevice.findMany({
    select: { userId: true },
    distinct: ["userId"],
  });
  const reachable = new Set(withDevices.map((d) => d.userId));
  reachable.delete(excludeUserId);
  if (reachable.size === 0 || audience === "ALL") return [...reachable];

  const since =
    audience === "RECENT"
      ? new Date(Date.now() - Math.max(1, recentDays) * 86400_000)
      : undefined;

  const players = await db.booking.findMany({
    where: {
      userId: { in: [...reachable] },
      status: { notIn: ["CANCELLED"] },
      ...(audience === "SPORT" ? { courtConfig: { sport: sport as never } } : {}),
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    select: { userId: true },
    distinct: ["userId"],
  });
  return players.map((p) => p.userId);
}

/**
 * Announce challenges nobody has been told about. Returns how many went.
 *
 * NOT called from `postChallenge`, deliberately. A fan-out to the whole
 * install base inside the request that creates the row would put a
 * multi-second FCM call on the critical path of a customer tapping
 * "Post" — and worse, a failure there is a failure to post. Here, a
 * broken send costs an announcement and nothing else, and the per-minute
 * cron picks it up again on the next tick if it throws before claiming.
 *
 * Idempotent by claim: `announcedAt` is stamped by a conditional update
 * that only matches a row still holding null, so two overlapping runs
 * cannot both announce one match. The claim happens BEFORE the send, so
 * the failure mode is a missed announcement rather than a duplicate one —
 * the right way round when the audience is everybody.
 */
export async function announceNewChallenges(now = new Date()): Promise<number> {
  const s = await db.challengeSettings.findFirst({
    select: {
      enabled: true,
      postedPushEnabled: true,
      postedPush: true,
      pushAudience: true,
      pushDailyCap: true,
      pushRecentDays: true,
    },
  });
  if (!s?.enabled || !s.postedPushEnabled) return 0;

  const cap = s.pushDailyCap ?? 0;
  if (cap <= 0) return 0;
  const usedToday = await db.challenge.count({
    where: { announcedAt: { gte: istDayStart(now) } },
  });
  const room = cap - usedToday;
  if (room <= 0) return 0;

  // A grace period before a post is broadcast. Someone who posts, sees a
  // typo in their team name and withdraws ten seconds later should not
  // have had it pushed to every phone in Mathura first.
  const settled = new Date(now.getTime() - 3 * 60_000);

  const fresh = await db.challenge.findMany({
    where: {
      status: "OPEN",
      announcedAt: null,
      createdAt: { lte: settled },
      expiresAt: { gt: now },
    },
    select: {
      id: true,
      sport: true,
      teamName: true,
      playerCount: true,
      createdByUserId: true,
      windows: {
        where: { status: "OFFERED" },
        select: { date: true, startHour: true, endHour: true },
        orderBy: [{ date: "asc" }, { startHour: "asc" }],
      },
    },
    // Oldest first, so a backlog drains in the order it arrived rather
    // than the newest post starving everything behind it.
    orderBy: { createdAt: "asc" },
    take: room,
  });
  if (fresh.length === 0) return 0;

  const tpl = resolveTemplate(s.postedPush, DEFAULT_POSTED_PUSH);

  let sent = 0;
  for (const c of fresh) {
    // CLAIM FIRST. Everything after this point may fail without risking a
    // second copy of the same announcement.
    const claimed = await db.challenge.updateMany({
      where: { id: c.id, announcedAt: null },
      data: { announcedAt: now },
    });
    if (claimed.count === 0) continue;

    const first = c.windows[0];
    if (!first) continue;
    const vars: PostedVars = {
      team: c.teamName?.trim() || "A team",
      sport: c.sport.charAt(0) + c.sport.slice(1).toLowerCase(),
      players: c.playerCount,
      hour: `${hourWord(first.startHour)}–${hourWord(first.endHour)}`,
      date: istDayLabel(first.date),
      options: c.windows.length > 1 ? `${c.windows.length} times` : "",
    };
    const title = renderPush(tpl.title, vars);
    const body = renderPush(tpl.body, vars);

    const userIds = await postedAudience(
      s.pushAudience,
      c.sport,
      s.pushRecentDays,
      c.createdByUserId,
    );
    if (userIds.length === 0) continue;

    // The inbox rows in ONE statement and the push in ONE multicast.
    // notifyUser() per person would be a round trip and an FCM call each,
    // which at fifty recipients is fifty dispatch rows for one event and
    // a sweep that no longer finishes inside its minute.
    const link = `/challenges/${c.id}`;
    await db.userNotification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type: "CHALLENGE_POSTED",
        title,
        body,
        link,
      })),
    });

    const devices = await db.pushDevice.findMany({
      where: { userId: { in: userIds } },
      select: { token: true },
    });
    if (devices.length > 0) {
      // `in_app` rather than `open_screen`: the in_app handler's
      // /challenges/<id> branch has been in every shipped build since the
      // module launched, while open_screen routes through resolveDeepLink,
      // which only learned about challenges in the 2026-09-21 OTA. Using
      // the older path means the tap lands on the match on every phone in
      // the field, not only the ones that have taken the update.
      await sendToTokens(
        devices.map((d) => d.token),
        { title, body, data: { kind: "in_app", link } },
        { scope: "customer", source: "broadcast", audience: `challenge:${s.pushAudience}` },
      );
    }

    await logChallengeEvent({
      type: "ANNOUNCED",
      challengeId: c.id,
      detail: `${userIds.length} recipient(s) · ${devices.length} device(s) · ${s.pushAudience}`,
    });
    sent++;
  }
  return sent;
}
