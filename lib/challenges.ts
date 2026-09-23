import { db } from "@/lib/db";
import { notifyUser } from "@/lib/user-notifications";
import { getOperatingHours } from "@/lib/court-config";
import { Prisma, type ChallengeEventType } from "@prisma/client";
import {
  DEFAULT_LIMITS,
  postRefusal,
  acceptRefusal,
  suggestRefusal,
  suggestAnswerRefusal,
  windowIsTakeable,
  windowAwaitsPoster,
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
      // Which side of the haggle this time is on. Without it the phone
      // cannot tell a time the poster is offering from one a stranger is
      // asking about, and would put a Pay button on a question.
      approvedAt: true,
      proposedByUserId: true,
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
 *   captains — `suggestRefusal` turns a stranger away from it with "Somebody
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
      // A CHALLENGE LEAVES THE BOARD WHEN SOMEBODY PAYS, AND NOT BEFORE.
      //
      // There used to be an `acceptedByUserId: null` clause here, and it
      // quietly did the opposite of what the status filter beside it
      // intends: COUNTERED is listed on purpose, but countering set an
      // acceptor, so a single free suggestion hid the match from everybody
      // else until it expired. Nobody could see it, nobody could take it,
      // and nothing chased the two people who had not paid.
      //
      // Paying is what moves a challenge to PART_PAID or CONFIRMED, which
      // this status filter already excludes — so "no money, still on the
      // board" needs no clause of its own. Own posts are still hidden from
      // their own poster, which is a display rule, not a claim.
      ...(args?.viewerId ? { createdByUserId: { not: args.viewerId } } : {}),
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

/**
 * Suggest a different time. Claims NOTHING.
 *
 * It used to make the suggester the acceptor, which had two consequences
 * nobody wanted: the match vanished from everybody else's board (the board
 * query hides anything with an acceptor), and it did so for free, because
 * no money is taken at this point. One tap parked somebody else's match
 * until it expired, and nothing chased either party.
 *
 * Now it writes a window and sends the poster a question. The challenge
 * stays on the board with its own times, still takeable by anyone, and the
 * suggested time joins them only if the poster says yes.
 */
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
  // Counted per PERSON, from what they have already proposed. The old
  // per-side columns existed because a counter claimed the acceptor slot,
  // so there could only ever be one counterer; now any number of strangers
  // may each suggest a time, and a shared counter would let the first of
  // them silence the rest.
  const asked = await db.challengeWindow.findMany({
    where: { challengeId, proposedByUserId: userId, status: { not: "SUPERSEDED" } },
    select: { status: true, approvedAt: true },
  });
  const refusal = suggestRefusal(
    c,
    userId,
    {
      total: asked.length,
      // Still waiting = offered and not yet agreed to. A declined one has
      // been answered too, which is why this asks about the answer rather
      // than about approval.
      pending: asked.filter((w) => w.status === "OFFERED" && !w.approvedAt).length,
    },
    limits,
    now,
  );
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

  // ALWAYS the acceptor side. A suggestion comes from somebody who is not
  // the poster — `suggestRefusal` refuses the poster outright — so there is
  // no side to work out any more.
  const side: "ACCEPTOR" = "ACCEPTOR";
  await db.$transaction([
    // THIS PERSON's previous suggestion is superseded, not everybody's.
    // Keyed on the side, it wiped every other stranger's pending suggestion
    // the moment one more arrived — so a poster with three people asking
    // about three different evenings saw only the last one.
    db.challengeWindow.updateMany({
      where: {
        challengeId,
        proposedByUserId: userId,
        status: "OFFERED",
        approvedAt: null,
      },
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
        // COUNTERED, and it STAYS ON THE BOARD — the board query lists
        // OPEN and COUNTERED alike. The status records that a conversation
        // is happening; it does not take the match out of circulation.
        status: "COUNTERED",
        // A suggestion can name a LATER date than anything on the original
        // challenge. Leaving expiresAt alone meant a match could be swept
        // days before it was due to be played.
        ...(windowStart(window.date, window.startHour).getTime() > c.expiresAt.getTime()
          ? { expiresAt: windowStart(window.date, window.startHour) }
          : {}),
        counterCountAcceptor: { increment: 1 },
        // NO acceptedByUserId. That one line is the whole bug this rewrite
        // removes: setting it made a free suggestion behave like a claim,
        // and hid the match from everybody else for as long as it lived.
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

  // ASK THE POSTER. Without this the suggestion sits on a screen nobody has
  // a reason to open: the suggester has done their part and is waiting, and
  // the poster has no idea they were asked anything.
  const [tpl, suggester] = await Promise.all([
    db.challengeSettings
      .findFirst({ select: { suggestedPush: true } })
      .then((r) => resolveTemplate(r?.suggestedPush, DEFAULT_LIFECYCLE_PUSHES.suggested)),
    db.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);
  const vars = {
    name: suggester?.name ?? "Somebody",
    team: suggester?.name ?? "Somebody",
    hour: `${hourWord(window.startHour)}–${hourWord(window.endHour)}`,
    date: istDayLabel(new Date(`${window.date}T00:00:00.000Z`)),
    court: "",
    amount: 0,
    total: 0,
    balance: 0,
  };
  await notifyUser(c.createdByUserId, {
    type: "CHALLENGE_SUGGESTED",
    title: renderPush(tpl.title, vars),
    body: renderPush(tpl.body, vars),
    link: `/challenges/${challengeId}`,
  });
  return { ok: true };
}

/**
 * The poster's answer to a suggested time: yes, and it joins their own
 * times on the board — or no, and it is struck off.
 *
 * Agreeing does NOT match the two of them. It adds a time, and the person
 * who asked for it is told to go and pay for it like anybody else; whoever
 * pays first gets the match. That is the venue's rule everywhere else in
 * this module, and making an exception here is what produced a status
 * ("AGREED") that meant two people had shaken hands while the court sat
 * unsold and unheld and nobody was chasing either of them.
 */
export async function answerSuggestion(
  challengeId: string,
  windowId: string,
  posterUserId: string,
  agree: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = new Date();
  const c = await db.challenge.findUnique({
    where: { id: challengeId },
    select: {
      status: true,
      createdByUserId: true,
      acceptedByUserId: true,
      expiresAt: true,
      teamName: true,
      counterCountChallenger: true,
      counterCountAcceptor: true,
      createdBy: { select: { name: true } },
    },
  });
  if (!c) return { ok: false, error: "That challenge is gone." };

  const w = await db.challengeWindow.findFirst({
    where: { id: windowId, challengeId },
    select: {
      id: true,
      status: true,
      proposedBy: true,
      approvedAt: true,
      proposedByUserId: true,
      date: true,
      startHour: true,
      endHour: true,
    },
  });
  if (!w) return { ok: false, error: "That time is gone." };

  const refusal = suggestAnswerRefusal(c, w, posterUserId, now);
  if (refusal) {
    await logChallengeEvent({ type: "REFUSED", userId: posterUserId, challengeId, detail: refusal });
    return { ok: false, error: refusal };
  }

  // THE ANSWER IS THE CLAIM. A conditional update on the same nullness the
  // refusal checked is what stops a double-tap sending the suggester both
  // "they agreed" and "they can't", in whichever order the taps landed.
  const claimed = agree
    ? await db.challengeWindow.updateMany({
        where: { id: w.id, status: "OFFERED", approvedAt: null },
        data: { approvedAt: now },
      })
    : await db.challengeWindow.updateMany({
        where: { id: w.id, status: "OFFERED", approvedAt: null },
        data: { status: "DECLINED" },
      });
  if (claimed.count === 0) return { ok: false, error: "You've already answered that one." };

  await logChallengeEvent({
    type: agree ? "SUGGEST_AGREED" : "SUGGEST_DECLINED",
    userId: posterUserId,
    challengeId,
    detail: `${w.date.toISOString().slice(0, 10)} ${w.startHour}:00–${w.endHour}:00`,
  });

  // Tell whoever asked. BOTH answers are sent: a "no" that never arrives
  // leaves somebody waiting on a match that is not coming, which is worse
  // for them than the no.
  const stored = await db.challengeSettings.findFirst({
    select: { suggestOkPush: true, suggestNoPush: true },
  });
  const tpl = resolveTemplate(
    agree ? stored?.suggestOkPush : stored?.suggestNoPush,
    agree ? DEFAULT_LIFECYCLE_PUSHES.suggestOk : DEFAULT_LIFECYCLE_PUSHES.suggestNo,
  );
  // The price, so "pay your ₹X" is a number rather than a placeholder. It is
  // quoted for the person being told, against the time they asked for.
  const { challengeQuote } = await import("@/lib/challenge-payments");
  const money = agree
    ? await challengeQuote(challengeId, w.proposedByUserId, w.id).catch(() => null)
    : null;
  const vars = {
    name: c.createdBy?.name ?? "The other captain",
    team: c.teamName?.trim() || c.createdBy?.name || "They",
    hour: `${hourWord(w.startHour)}–${hourWord(w.endHour)}`,
    date: istDayLabel(w.date),
    court: money?.courtLabel ?? "",
    amount: money?.yourShare ?? 0,
    total: money?.total ?? 0,
    balance: money?.venueBalance ?? 0,
  };
  await notifyUser(w.proposedByUserId, {
    type: agree ? "CHALLENGE_SUGGEST_OK" : "CHALLENGE_SUGGEST_NO",
    title: renderPush(tpl.title, vars),
    body: renderPush(tpl.body, vars),
    link: `/challenges/${challengeId}`,
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
