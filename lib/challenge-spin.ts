/**
 * The wheel: spinning it, and what the poster does with what they win.
 *
 * ── Why the poster, and why once ───────────────────────────────────
 *
 * The wheel exists to make posting a challenge a habit, so it rewards the
 * poster and nobody else, once per confirmed challenge. A spin is earned by
 * two captains actually paying for a court — which is the cheapest possible
 * way to be sure the reward is attached to real revenue rather than to
 * activity on a board.
 *
 * ── Why the result is written before it is shown ───────────────────
 *
 * `spinFor` persists the outcome in the same breath as drawing it. The
 * device is told afterwards. A wheel whose result is decided on the client,
 * or decided on the server but only recorded once the client says the
 * animation finished, can be re-rolled by killing the app mid-spin. This
 * one cannot: the row exists before the animation starts.
 *
 * The draw is honestly weighted. 50% rarely stops because it rarely WINS —
 * the animation lands where the draw already put it. A wheel that visibly
 * approaches 50% and then slides off it is a different mechanism, and one
 * that a player watching closely will eventually catch.
 *
 * ── Two offers, two clocks ─────────────────────────────────────────
 *
 * ADJACENT is the hour straight after the match. The captain needs long
 * enough to turn round and ask his side — minutes, not hours — and the
 * venue is holding that hour unsold while he decides, so the window is
 * short and the nudges are close together.
 *
 * FALLBACK is what he gets when that hour is already taken: any hour inside
 * the next few days at the same percentage. Nothing is being held for him,
 * so he can have longer.
 *
 * Every window, every nudge time and every word of every nudge is set in
 * the admin. Nothing about the timing or the copy of this promo lives here.
 */

import { db } from "@/lib/db";
import { getSlotAvailability } from "@/lib/availability";
import { getSlotPricesForDate } from "@/lib/pricing";
import { notifyUser } from "@/lib/user-notifications";
import {
  createRazorpayOrder,
  verifyRazorpaySignature,
  RAZORPAY_KEY_ID,
} from "@/lib/razorpay";
import { logChallengeEvent } from "@/lib/challenges";
import {
  resolveWheel,
  spinWheel,
  leadTimeRefusal,
  type WheelSegment,
} from "@/lib/challenge-rules";
import {
  resolvePushes,
  renderPush,
  DEFAULT_WON_PUSH,
  DEFAULT_ADJACENT_PUSHES,
  DEFAULT_FALLBACK_PUSHES,
  type PushTemplate,
  type PushVars,
} from "@/lib/challenge-push";

export type SpinConfig = {
  enabled: boolean;
  segments: WheelSegment[];
  adjacentWindowMins: number;
  fallbackWindowMins: number;
  fallbackDays: number;
  adjacentOnly: boolean;
  sameSizeOnly: boolean;
  wonPush: PushTemplate;
  adjacentPushes: PushTemplate[];
  fallbackPushes: PushTemplate[];
  perPosterCap: number;
  perPosterDays: number;
};

/**
 * An EMPTY list means the venue turned nudges off; only an absent one falls
 * back to the shipped copy. Treating `[]` as "unset" made "no nudges" an
 * unreachable configuration and handed the wording back to constants in the
 * code — which is the one thing this module was asked not to do.
 */


/**
 * A push template that will not throw.
 *
 * `renderPush` is called AFTER the spin row is written, so a malformed
 * stored template took the poster's one spin and returned a 500 they could
 * never retry — the prize became permanently unreachable. Validation at
 * save time is the real fix; this is the belt to that pair of braces.
 */
function safeTemplate(v: unknown, fallback: PushTemplate): PushTemplate {
  const t = v as PushTemplate | null;
  if (t && typeof t === "object" && typeof t.title === "string" && typeof t.body === "string") {
    return t;
  }
  return fallback;
}

/** The venue's wheel, with the shipped defaults standing in for anything unset. */
export async function spinConfig(): Promise<SpinConfig> {
  const s = await db.challengeSettings.findFirst();
  const segs = resolveWheel(s?.spinSegments);
  return {
    enabled: !!s?.spinEnabled,
    segments: segs,
    adjacentWindowMins: s?.spinAdjacentWindowMins ?? 30,
    fallbackWindowMins: s?.spinFallbackWindowMins ?? 120,
    fallbackDays: s?.spinFallbackDays ?? 1,
    adjacentOnly: !!s?.spinAdjacentOnly,
    sameSizeOnly: s?.spinSameSizeOnly ?? true,
    wonPush: safeTemplate(s?.spinWonPush, DEFAULT_WON_PUSH),
    adjacentPushes: resolvePushes(s?.spinAdjacentPushes, DEFAULT_ADJACENT_PUSHES),
    fallbackPushes: resolvePushes(s?.spinFallbackPushes, DEFAULT_FALLBACK_PUSHES),
    perPosterCap: s?.spinsPerPosterCap ?? 0,
    perPosterDays: s?.spinsPerPosterPerDays ?? 0,
  };
}

/** "9pm–10pm" — the venue runs to 1am, so hours can exceed 24. */
export function hourRangeLabel(startHour: number): string {
  const fmt = (h: number) => {
    const x = h % 24;
    const ampm = x >= 12 ? "pm" : "am";
    const disp = x % 12 === 0 ? 12 : x % 12;
    return `${disp}${ampm}`;
  };
  return `${fmt(startHour)}–${fmt(startHour + 1)}`;
}

/**
 * Is the hour straight after the match free, and what does it cost?
 *
 * Asked at spin time and again at payment time. Between those two moments a
 * walk-in can take it, which is exactly why the second ask exists.
 */
export async function adjacentHour(
  courtConfigId: string,
  date: Date,
  afterHour: number,
): Promise<{ startHour: number; price: number } | null> {
  const startHour = afterHour;
  const avail = await getSlotAvailability(courtConfigId, date);
  const slot = avail.find((s) => s.hour === startHour);
  if (!slot || slot.status !== "available") return null;
  const prices = await getSlotPricesForDate(courtConfigId, date);
  const price = prices.find((p) => p.hour === startHour)?.price ?? 0;
  return price > 0 ? { startHour, price } : null;
}

/** "Sun, 20 Sep" — the day a push should name, never a bare ISO string. */
export function istDayLabel(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Midnight of today, IST, as the UTC instant the @db.Date columns store. */
function istToday(): Date {
  const ist = new Date(Date.now() + 5.5 * 3600000);
  ist.setUTCHours(0, 0, 0, 0);
  return ist;
}

function discounted(price: number, pct: number): { price: number; saving: number } {
  const saving = Math.round((price * pct) / 100);
  return { price: price - saving, saving };
}

/**
 * Spin, once, for a confirmed challenge.
 *
 * Refuses rather than throws for every reachable reason, because each of
 * these is a sentence the poster is going to read.
 */
export async function spinFor(
  challengeId: string,
  userId: string,
): Promise<
  | {
      ok: true;
      pct: number;
      kind: "ADJACENT" | "FALLBACK";
      offerId: string;
      expiresAt: Date;
      hour: string | null;
      price: number | null;
      saving: number | null;
    }
  | { ok: false; error: string }
> {
  const cfg = await spinConfig();
  if (!cfg.enabled) return { ok: false, error: "The prize wheel isn't running right now." };

  const c = await db.challenge.findUnique({
    where: { id: challengeId },
    select: {
      id: true,
      status: true,
      createdByUserId: true,
      bookingId: true,
      agreedWindowId: true,
      spin: { select: { id: true } },
      windows: { select: { id: true, date: true, startHour: true, endHour: true } },
    },
  });
  if (!c) return { ok: false, error: "That challenge is gone." };
  if (c.createdByUserId !== userId) {
    return { ok: false, error: "Only the captain who posted the challenge spins." };
  }
  if (c.status !== "CONFIRMED") {
    return { ok: false, error: "The wheel unlocks once both halves are paid." };
  }
  if (c.spin) return { ok: false, error: "You've already spun for this match." };

  // A cap of zero is uncapped, which is what the venue asked for — but the
  // knob exists because a colluding pair posting at each other is the one
  // way this promo can be farmed.
  if (cfg.perPosterCap > 0 && cfg.perPosterDays > 0) {
    const since = new Date(Date.now() - cfg.perPosterDays * 86400000);
    const used = await db.challengeSpin.count({ where: { userId, createdAt: { gte: since } } });
    if (used >= cfg.perPosterCap) {
      return {
        ok: false,
        error:
          `You've had ${cfg.perPosterCap} spin${cfg.perPosterCap === 1 ? "" : "s"} in the last ` +
          `${cfg.perPosterDays} day${cfg.perPosterDays === 1 ? "" : "s"}. Another one soon.`,
      };
    }
  }

  const win = c.windows.find((w) => w.id === c.agreedWindowId);
  const booking = c.bookingId
    ? await db.booking.findUnique({
        where: { id: c.bookingId },
        select: { courtConfigId: true, date: true, courtConfig: { select: { label: true } } },
      })
    : null;
  if (!win || !booking) return { ok: false, error: "That match has no booked hour to extend." };

  // Drawn and written before the device hears anything, so killing the app
  // mid-animation cannot buy a second roll.
  const pct = spinWheel(cfg.segments, Math.random());

  const free = await adjacentHour(booking.courtConfigId, booking.date, win.endHour);
  const useAdjacent = !!free;
  if (!useAdjacent && cfg.adjacentOnly) {
    // The venue chose not to let the discount leave the session. Record the
    // spin anyway — it was earned, and a poster told "no prize because the
    // next hour was busy" deserves to see that in the admin trail too.
    await db.challengeSpin.create({
      data: { challengeId, userId, wonPct: pct, segmentsUsed: cfg.segments as never },
    });
    await logChallengeEvent({
      type: "SPUN",
      userId,
      challengeId,
      detail: `${pct}% · next hour already booked, no fallback`,
    });
    return { ok: false, error: "The hour after your match is already taken." };
  }

  const kind = useAdjacent ? "ADJACENT" : "FALLBACK";
  const windowMins = useAdjacent ? cfg.adjacentWindowMins : cfg.fallbackWindowMins;
  // Never sell past the hour itself. A challenge confirmed days early gave
  // the captain a 30-minute clock on an hour two days away — and the push
  // said "in the next 30 minutes" about a match that had not happened yet.
  const hourStarts = free
    ? new Date(booking.date.getTime() + (free.startHour - 5.5) * 3600000)
    : null;
  const expiresAt = new Date(
    Math.min(
      Date.now() + windowMins * 60000,
      hourStarts ? hourStarts.getTime() : Number.MAX_SAFE_INTEGER,
    ),
  );
  if (expiresAt.getTime() <= Date.now()) {
    return { ok: false, error: "That hour has already started." };
  }
  const money = free ? discounted(free.price, pct) : null;

  let spin: { offer: { id: string } | null };
  try {
    spin = await db.challengeSpin.create({
      data: {
        challengeId,
        userId,
        wonPct: pct,
        segmentsUsed: cfg.segments as never,
        offer: {
          create: {
            kind,
            userId,
            discountPct: pct,
            expiresAt,
            // The CLAMPED length, not the configured window. A spin ten
            // minutes before the hour gets a ten-minute offer however long
            // the setting says, and the nudge filter needs the real number.
            windowMins: Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60000)),
            ...(free
              ? {
                  courtConfigId: booking.courtConfigId,
                  date: booking.date,
                  startHour: free.startHour,
                }
              : {}),
          },
        },
      },
      select: { offer: { select: { id: true } } },
    });
  } catch {
    // ChallengeSpin.challengeId is unique, so a double tap is correctly
    // PREVENTED — it just used to surface as a 500 rather than a sentence.
    return { ok: false, error: "You've already spun for this match." };
  }

  const vars: PushVars = {
    minsLeft: windowMins,
    pct,
    price: money?.price ?? 0,
    saving: money?.saving ?? 0,
    hour: free ? hourRangeLabel(free.startHour) : "",
    date: free ? istDayLabel(booking.date) : "",
    court: booking.courtConfig?.label ?? "",
  };
  await notifyUser(userId, {
    type: "CHALLENGE_SPIN_WON",
    title: renderPush(cfg.wonPush.title, vars),
    body: renderPush(cfg.wonPush.body, vars),
    link: `/challenges/${challengeId}`,
  });
  await logChallengeEvent({
    type: "SPUN",
    userId,
    challengeId,
    detail: `${pct}% · ${kind.toLowerCase()} · ${windowMins}m to use it`,
  });

  return {
    ok: true,
    pct,
    kind,
    offerId: spin.offer!.id,
    expiresAt,
    hour: free ? hourRangeLabel(free.startHour) : null,
    price: money?.price ?? null,
    saving: money?.saving ?? null,
  };
}

/**
 * The nudges that are due, across every live offer.
 *
 * Driven by the per-minute cron. Each marker is recorded on the offer as it
 * fires, so a run that overlaps the previous one cannot double-send, and a
 * run that skipped minutes still sends the last call — which is the nudge
 * that converts.
 */
export async function sendOfferReminders(now = new Date()): Promise<number> {
  const cfg = await spinConfig();

  const live = await db.challengeOffer.findMany({
    where: { takenAt: null, expiresAt: { gt: now } },
    select: {
      id: true,
      kind: true,
      userId: true,
      discountPct: true,
      expiresAt: true,
      remindedAt: true,
      windowMins: true,
      courtConfigId: true,
      date: true,
      startHour: true,
      spin: { select: { challengeId: true } },
    },
  });

  const { pushesDue } = await import("@/lib/challenge-push");
  let sent = 0;

  for (const offer of live) {
    const minsLeft = Math.ceil((offer.expiresAt.getTime() - now.getTime()) / 60000);
    const configured = offer.kind === "ADJACENT" ? cfg.adjacentPushes : cfg.fallbackPushes;
    // Drop markers that could never fire inside THIS offer's real window.
    // A spin ten minutes before the hour gets a ten-minute offer however
    // long the setting says, and an unfiltered 30-minute ladder would fire
    // its whole length in the first tick and consume the useful ones.
    const room = offer.windowMins ?? Number.MAX_SAFE_INTEGER;
    const templates = configured.filter((t) => (t.minsLeft ?? 0) < room);
    const due = pushesDue({ templates, minsLeft, alreadySent: offer.remindedAt });
    if (due.length === 0) continue;

    let price = 0;
    let saving = 0;
    let court = "";
    if (offer.courtConfigId && offer.date && offer.startHour !== null) {
      const prices = await getSlotPricesForDate(offer.courtConfigId, offer.date);
      const full = prices.find((p) => p.hour === offer.startHour)?.price ?? 0;
      ({ price, saving } = discounted(full, offer.discountPct));
      court =
        (
          await db.courtConfig.findUnique({
            where: { id: offer.courtConfigId },
            select: { label: true },
          })
        )?.label ?? "";
    }

    // Only the most urgent due nudge is sent. A catch-up run that fired
    // every overdue marker at once would arrive as a burst of three
    // notifications saying different numbers of minutes.
    const t = due[0];
    if (typeof t.title !== "string" || typeof t.body !== "string") continue;
    const vars: PushVars = {
      minsLeft,
      pct: offer.discountPct,
      price,
      saving,
      hour: offer.startHour !== null ? hourRangeLabel(offer.startHour) : "",
      date: offer.date ? istDayLabel(offer.date) : "",
      court,
    };
    await notifyUser(offer.userId, {
      type: "CHALLENGE_OFFER_REMINDER",
      title: renderPush(t.title, vars),
      body: renderPush(t.body, vars),
      link: `/challenges/${offer.spin.challengeId}`,
    });
    await db.challengeOffer.update({
      where: { id: offer.id },
      data: { remindedAt: { push: due.map((d) => d.minsLeft as number) } },
    });
    sent++;
  }
  return sent;
}

/**
 * Close out offers nobody used.
 *
 * Logged rather than deleted: "won 50% and let it lapse" is the single most
 * useful row in this promo's trail — it says the wheel is landing but the
 * follow-through is not, which is a copy or a timing problem, not a
 * generosity one.
 */
export async function expireOffers(now = new Date()): Promise<number> {
  // DELIBERATELY UNGATED, and so are the reminders above.
  //
  // `spinEnabled` stops ISSUING prizes. It cannot un-issue one: `expiresAt`
  // is a stored timestamp, so gating this sweep does not stop the holder's
  // clock — it only loses the OFFER_LAPSED row the venue is meant to see,
  // and then stamps the lapse at whatever later moment the wheel is
  // switched back on. A prize already won is honoured, nudged and closed
  // out on its own schedule regardless of the switch.
  // Includes offers CLAIMED but never booked: a process that died between
  // the claim and the booking left the prize unusable for ever, invisible to
  // this sweep and to the wheel's economics. A claim older than the grace is
  // a dead claim.
  const CLAIM_GRACE_MINS = 15;
  const staleClaim = new Date(now.getTime() - CLAIM_GRACE_MINS * 60000);
  const dead = await db.challengeOffer.findMany({
    where: {
      lapsedAt: null,
      bookingId: null,
      OR: [
        { takenAt: null, expiresAt: { lte: now } },
        { takenAt: { lte: staleClaim } },
      ],
    },
    select: {
      id: true,
      userId: true,
      discountPct: true,
      kind: true,
      spin: { select: { challengeId: true } },
    },
  });
  for (const o of dead) {
    await logChallengeEvent({
      type: "OFFER_LAPSED",
      userId: o.userId,
      challengeId: o.spin.challengeId,
      detail: `${o.discountPct}% ${o.kind.toLowerCase()} went unused`,
    });
  }
  if (dead.length > 0) {
    await db.challengeOffer.updateMany({
      where: { id: { in: dead.map((d) => d.id) } },
      // `takenAt` is cleared alongside the lapse. Leaving it set stranded a
      // capture for ever: the retry could neither find a booking nor
      // re-claim the offer, so the money was gone with no refund trail.
      data: { lapsedAt: now, takenAt: null },
    });
  }
  return dead.length;
}

// ── Spending the prize ─────────────────────────────────────────────

/**
 * What an offer is worth right now, and whether it can still be taken.
 *
 * For ADJACENT the hour is fixed and re-checked for availability every
 * time: the venue is holding nothing, and a walk-in taking it between the
 * spin and the payment is the whole reason this is re-asked rather than
 * trusted from the offer row.
 *
 * For FALLBACK the caller names the hour they want, and it is priced and
 * checked the same way.
 */
export async function offerQuote(
  offerId: string,
  userId: string,
  pick?: { courtConfigId: string; date: string; startHour: number },
  allowExpired = false,
  /**
   * Set by the caller that has ALREADY claimed this offer and is now
   * pricing it to book. Without it the claim and the quote fight each
   * other: the claim stamps takenAt, the quote refuses anything with
   * takenAt, and every prize redemption fails on its first and only try.
   */
  claimedByCaller = false,
): Promise<
  | {
      ok: true;
      pct: number;
      courtConfigId: string;
      courtLabel: string;
      date: Date;
      startHour: number;
      fullPrice: number;
      price: number;
      saving: number;
      minsLeft: number;
    }
  | { ok: false; error: string }
> {
  const o = await db.challengeOffer.findUnique({
    where: { id: offerId },
    select: {
      id: true,
      userId: true,
      kind: true,
      discountPct: true,
      expiresAt: true,
      takenAt: true,
      lapsedAt: true,
      courtConfigId: true,
      date: true,
      startHour: true,
      spin: {
        select: {
          challenge: {
            select: {
              sport: true,
              // The court the match was actually played on. Its SIZE is what
              // bounds the prize.
              booking: { select: { courtConfig: { select: { size: true } } } },
            },
          },
        },
      },
    },
  });
  if (!o) return { ok: false, error: "That offer is gone." };
  if (o.userId !== userId) return { ok: false, error: "That offer isn't yours." };
  if (o.lapsedAt) return { ok: false, error: "That offer has expired." };
  if (o.takenAt && !claimedByCaller) {
    return { ok: false, error: "You've already used this one." };
  }
  const minsLeft = Math.ceil((o.expiresAt.getTime() - Date.now()) / 60000);
  // `allowExpired` honours a sheet that was already open when the clock ran
  // out. It is NOT a licence to redeem something that died days ago, so the
  // grace is bounded to a few minutes.
  const EXPIRY_GRACE_MINS = 10;
  if (minsLeft <= 0 && !(allowExpired && minsLeft > -EXPIRY_GRACE_MINS)) {
    return { ok: false, error: "That offer has expired." };
  }

  let courtConfigId: string;
  let date: Date;
  let startHour: number;
  if (o.kind === "ADJACENT") {
    if (!o.courtConfigId || !o.date || o.startHour === null) {
      return { ok: false, error: "That offer has no hour attached." };
    }
    courtConfigId = o.courtConfigId;
    date = o.date;
    startHour = o.startHour;
  } else {
    // A pinned pick wins over anything the client sends: once an order has
    // been minted against an hour, that is the hour being bought.
    // A pin only binds while the hour it names is still free. Otherwise an
    // abandoned payment sheet left the prize pointing at a gone hour for
    // the rest of its life, refusing every new pick — and every nudge
    // deep-linked to that dead end.
    const pinnedStill =
      o.courtConfigId && o.date && o.startHour !== null
        ? (await getSlotAvailability(o.courtConfigId, o.date)).find(
            (x) => x.hour === o.startHour,
          )?.status === "available"
        : false;
    const pinned =
      pinnedStill && o.courtConfigId && o.date && o.startHour !== null
        ? { courtConfigId: o.courtConfigId, date: o.date, startHour: o.startHour }
        : null;
    if (!pinned && !pick) return { ok: false, error: "Pick an hour first." };
    const cfg = await spinConfig();

    if (pinned) {
      courtConfigId = pinned.courtConfigId;
      date = pinned.date;
      startHour = pinned.startHour;
    } else {
      // IST, not UTC. Between midnight and 05:30 IST — exactly when a match
      // ending at midnight produces a spin — UTC "today" is yesterday here,
      // and the winner silently got half the advertised window.
      const chosen = new Date(`${pick!.date}T00:00:00.000Z`);
      const todayIst = istToday();
      const maxDay = new Date(todayIst.getTime() + cfg.fallbackDays * 86400000);
      if (chosen.getTime() > maxDay.getTime() || chosen.getTime() < todayIst.getTime()) {
        return {
          ok: false,
          error: `This one's good for the next ${cfg.fallbackDays} day${cfg.fallbackDays === 1 ? "" : "s"} only.`,
        };
      }
      courtConfigId = pick!.courtConfigId;
      date = chosen;
      startHour = pick!.startHour;
    }
  }

  // The court must belong to this challenge's sport and be live. Without
  // this, a 50% won on a ₹200 pitch could be spent on the ₹2,000 ground —
  // the picker restricted it, the write path did not.
  const court = await db.courtConfig.findUnique({
    where: { id: courtConfigId },
    select: { id: true, label: true, sport: true, isActive: true, size: true },
  });
  if (!court || !court.isActive || court.sport !== o.spin.challenge.sport) {
    return { ok: false, error: "That court isn't available for this match." };
  }
  // Same size as the court the match was played on. This is what ties the
  // prize's value to the match that earned it — without it, a spin won on
  // the cheapest pitch in the arena is spendable on the most expensive one.
  const cfgSize = await spinConfig();
  const earnedOn = o.spin.challenge.booking?.courtConfig?.size ?? null;
  if (cfgSize.sameSizeOnly && earnedOn && court.size !== earnedOn) {
    return {
      ok: false,
      error: "That discount is good on the same size of court you played on.",
    };
  }
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 25) {
    return { ok: false, error: "That isn't an hour the arena runs." };
  }

  const avail = await getSlotAvailability(courtConfigId, date);
  if (avail.find((s) => s.hour === startHour)?.status !== "available") {
    return {
      ok: false,
      error:
        o.kind === "ADJACENT"
          ? "That hour has just gone. Nothing has been charged."
          : "That hour isn't free — pick another.",
    };
  }
  const prices = await getSlotPricesForDate(courtConfigId, date);
  const fullPrice = prices.find((p) => p.hour === startHour)?.price ?? 0;
  if (fullPrice <= 0) return { ok: false, error: "That hour has no price set." };
  // The lead-time rule applies to a FALLBACK hour. The spec exempts only
  // the ADJACENT one — same session, staff already there — and a prize
  // holder was able to buy an unstaffable hour 35 minutes out that the
  // venue refuses to sell anyone else at full price.
  if (o.kind === "FALLBACK") {
    const lead = (await db.challengeSettings.findFirst({ select: { minLeadMins: true } }))
      ?.minLeadMins;
    const late = leadTimeRefusal(
      new Date(date.getTime() + (startHour - 5.5) * 3600000),
      new Date(),
      lead ?? 240,
    );
    if (late) return { ok: false, error: late };
  }

  const money = discounted(fullPrice, o.discountPct);
  const label = court.label;

  return {
    ok: true,
    pct: o.discountPct,
    courtConfigId,
    courtLabel: label,
    date,
    startHour,
    fullPrice,
    price: money.price,
    saving: money.saving,
    minsLeft,
  };
}

/**
 * Book the discounted hour, once the money is in.
 *
 * Unlike the match itself there is no advance split here — the poster pays
 * the whole discounted hour and settles with his side afterwards, which is
 * what already happens informally with the first payment. So the booking is
 * created CONFIRMED with a COMPLETED payment: nothing is owed at the gate.
 *
 * The availability re-check inside this function is the one that matters.
 * Everything before it is a quote.
 */
export async function bookOfferHour(args: {
  offerId: string;
  userId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  platform?: string;
  /** Honour an offer that lapsed while the payment sheet was open. */
  allowExpired?: boolean;
}): Promise<{ ok: true; bookingId: string } | { ok: false; error: string }> {
  // No client `pick` here by design — the hour was pinned onto the offer
  // when the order was minted, and that is what is being paid for.
  const q = await offerQuote(args.offerId, args.userId, undefined, args.allowExpired, true);
  if (!q.ok) return q;
  const pinnedPrice = (
    await db.challengeOffer.findUnique({
      where: { id: args.offerId },
      select: { quotedPrice: true },
    })
  )?.quotedPrice;
  // Bank what the order was minted for. Re-deriving it here would let a
  // rate-card change between the sheet opening and the capture rewrite what
  // the ledger says was collected.
  const charged = pinnedPrice && pinnedPrice > 0 ? pinnedPrice : q.price;

  const booking = await db.booking.create({
    data: {
      userId: args.userId,
      courtConfigId: q.courtConfigId,
      date: q.date,
      status: "CONFIRMED",
      totalAmount: charged,
      originalAmount: q.fullPrice,
      discountAmount: Math.max(0, q.fullPrice - charged),
      platform: args.platform ?? "ios",
      slots: { create: [{ startHour: q.startHour, price: q.price }] },
      payment: {
        create: {
          method: "RAZORPAY",
          status: "COMPLETED",
          amount: charged,
          razorpayOrderId: args.razorpayOrderId,
          razorpayPaymentId: args.razorpayPaymentId,
          confirmedAt: new Date(),
        },
      },
    },
    select: { id: true },
  });

  const offer = await db.challengeOffer.update({
    where: { id: args.offerId },
    data: { takenAt: new Date(), bookingId: booking.id },
    select: { discountPct: true, kind: true, spin: { select: { challengeId: true } } },
  });

  await logChallengeEvent({
    type: "OFFER_TAKEN",
    userId: args.userId,
    challengeId: offer.spin.challengeId,
    detail: `${offer.discountPct}% ${offer.kind.toLowerCase()} · ₹${q.price} for ${hourRangeLabel(q.startHour)} (saved ₹${q.saving})`,
  });

  return { ok: true, bookingId: booking.id };
}

/**
 * The offer this poster currently holds for a challenge, if any.
 *
 * Without this the prize lived only in React state: spin, background the
 * app, come back, and the offer was gone — the screen offered a spin the
 * server then refused as already used, so the prize was unreachable for the
 * rest of its life. Every nudge deep-links to that same screen, which made
 * the whole reminder ladder point at a dead end.
 */
export async function liveOfferFor(
  challengeId: string,
  userId: string,
): Promise<{
  offerId: string;
  pct: number;
  kind: "ADJACENT" | "FALLBACK";
  expiresAt: Date;
  minsLeft: number;
  hour: string | null;
  price: number | null;
  saving: number | null;
  date: string | null;
} | null> {
  const o = await db.challengeOffer.findFirst({
    where: { userId, takenAt: null, spin: { challengeId } },
    select: {
      id: true,
      kind: true,
      discountPct: true,
      expiresAt: true,
      courtConfigId: true,
      date: true,
      startHour: true,
    },
  });
  if (!o) return null;
  const minsLeft = Math.ceil((o.expiresAt.getTime() - Date.now()) / 60000);
  if (minsLeft <= 0) return null;

  let price: number | null = null;
  let saving: number | null = null;
  if (o.courtConfigId && o.date && o.startHour !== null) {
    const prices = await getSlotPricesForDate(o.courtConfigId, o.date);
    const full = prices.find((p) => p.hour === o.startHour)?.price ?? 0;
    if (full > 0) ({ price, saving } = discounted(full, o.discountPct));
  }
  return {
    offerId: o.id,
    pct: o.discountPct,
    kind: o.kind as "ADJACENT" | "FALLBACK",
    expiresAt: o.expiresAt,
    minsLeft,
    hour: o.startHour !== null ? hourRangeLabel(o.startHour) : null,
    price,
    saving,
    date: o.date ? o.date.toISOString().slice(0, 10) : null,
  };
}

// ── Paying for the discounted hour ─────────────────────────────────

/**
 * Open a Razorpay order for the whole discounted hour.
 *
 * No advance split here. The captain fronts the hour and settles with his
 * side afterwards — which is what already happens with the match itself,
 * informally, and pretending otherwise would just add a second person to
 * chase inside a thirty-minute window.
 */
export async function createOfferOrder(
  offerId: string,
  userId: string,
  pick?: { courtConfigId: string; date: string; startHour: number },
): Promise<
  | { ok: true; orderId: string; keyId: string; amount: number; saving: number; minsLeft: number }
  | { ok: false; error: string }
> {
  const q = await offerQuote(offerId, userId, pick);
  if (!q.ok) return q;
  if (!RAZORPAY_KEY_ID) {
    return { ok: false, error: "Card payments aren't configured. Please tell the arena." };
  }
  let order: { id: string };
  try {
    order = await createRazorpayOrder(q.price, offerId);
  } catch {
    return { ok: false, error: "Couldn't reach the payment gateway. Try again in a moment." };
  }

  // Pin the hour AND the price onto the offer. The verify then works from
  // these rather than from whatever the client sends back: `pick` used to
  // be passed independently to the order and the verify, so a captain could
  // be quoted a ₹100 hour and book a ₹1,000 one on the same payment.
  await db.challengeOffer.update({
    where: { id: offerId },
    data: {
      razorpayOrderId: order.id,
      quotedPrice: q.price,
      courtConfigId: q.courtConfigId,
      date: q.date,
      startHour: q.startHour,
    },
  });

  return {
    ok: true,
    orderId: order.id,
    keyId: RAZORPAY_KEY_ID,
    amount: q.price,
    saving: q.saving,
    minsLeft: q.minsLeft,
  };
}

/**
 * Verify and book.
 *
 * The expiry is checked again inside here, after the money has moved. An
 * offer that lapsed during the payment sheet is the one case where the
 * venue has taken money for an hour it did not promise — so it books the
 * hour anyway rather than keeping the cash and refusing, and logs that it
 * did. Honouring a deadline by seconds is not worth a refund conversation.
 */
export async function confirmOfferPayment(args: {
  offerId: string;
  userId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  platform?: string;
  pick?: { courtConfigId: string; date: string; startHour: number };
}): Promise<{ ok: true; bookingId: string } | { ok: false; error: string }> {
  if (
    !verifyRazorpaySignature(args.razorpayOrderId, args.razorpayPaymentId, args.razorpaySignature)
  ) {
    return { ok: false, error: "That payment could not be verified." };
  }
  // Look the offer up BY THE ORDER, never by a client-supplied offer id.
  // The signature is HMAC(order|payment) and carries no amount and no
  // receipt, so without this binding any triple the user had ever received
  // would satisfy the check, for any offer and any price.
  const existing = await db.challengeOffer.findUnique({
    where: { razorpayOrderId: args.razorpayOrderId },
    select: { id: true, userId: true, takenAt: true, bookingId: true, expiresAt: true },
  });
  if (!existing) return { ok: false, error: "That payment doesn't match an offer." };
  if (existing.id !== args.offerId) {
    return { ok: false, error: "That payment doesn't match this offer." };
  }
  if (existing.userId !== args.userId) {
    return { ok: false, error: "That payment belongs to somebody else." };
  }
  // Idempotent: a retried verify must not book the hour twice.
  if (existing.takenAt && existing.bookingId) {
    return { ok: true, bookingId: existing.bookingId };
  }

  // CLAIM the offer before doing any work. Two concurrent verifies used to
  // pass the takenAt check together and produce two bookings from one spin
  // — and with a per-call `pick`, N calls produced N discounted hours. This
  // conditional update is the serialisation point: exactly one caller can
  // move takenAt from null.
  const claimed = await db.challengeOffer.updateMany({
    where: { id: existing.id, takenAt: null },
    data: { takenAt: new Date() },
  });
  if (claimed.count === 0) {
    const now = await db.challengeOffer.findUnique({
      where: { id: existing.id },
      select: { bookingId: true },
    });
    if (now?.bookingId) return { ok: true, bookingId: now.bookingId };
    // The winner may not have committed its booking yet. Give it a moment
    // rather than telling somebody their payment failed for an hour that is
    // about to be booked in their name.
    await new Promise((r) => setTimeout(r, 1200));
    const settled = await db.challengeOffer.findUnique({
      where: { id: existing.id },
      select: { bookingId: true },
    });
    if (settled?.bookingId) return { ok: true, bookingId: settled.bookingId };
    return { ok: false, error: "That offer is already being used." };
  }

  const lapsedDuringPayment = existing.expiresAt.getTime() <= Date.now();
  const r = await bookOfferHour({
    offerId: existing.id,
    userId: args.userId,
    razorpayOrderId: args.razorpayOrderId,
    razorpayPaymentId: args.razorpayPaymentId,
    platform: args.platform,
    allowExpired: true,
  });
  if (!r.ok) {
    // Release the claim so a genuine retry can still succeed. The money is
    // captured either way, so a stuck claim would strand it.
    await db.challengeOffer.updateMany({
      where: { id: existing.id, bookingId: null },
      data: { takenAt: null },
    });
    return r;
  }
  if (lapsedDuringPayment) {
    await logChallengeEvent({
      type: "OFFER_TAKEN",
      userId: args.userId,
      challengeId: null,
      detail: "honoured after expiry — payment was already in flight",
    });
  }
  return r;
}

/**
 * The hours a FALLBACK offer could be spent on.
 *
 * Returned as whole days rather than a flat list, because "any hour in the
 * next day" is a choice the captain makes by looking at an evening, not by
 * scrolling a hundred rows. Prices are the DISCOUNTED ones — showing the
 * rack rate next to an offer the player has already won reads as a bait.
 */
export async function offerSlots(
  offerId: string,
  userId: string,
): Promise<
  | {
      ok: true;
      pct: number;
      minsLeft: number;
      days: {
        date: string;
        courtConfigId: string;
        courtLabel: string;
        hours: { startHour: number; label: string; fullPrice: number; price: number }[];
      }[];
    }
  | { ok: false; error: string }
> {
  const o = await db.challengeOffer.findUnique({
    where: { id: offerId },
    select: {
      userId: true,
      kind: true,
      discountPct: true,
      expiresAt: true,
      takenAt: true,
      spin: {
        select: {
          challenge: {
            select: {
              sport: true,
              bookingId: true,
              booking: { select: { courtConfig: { select: { size: true } } } },
            },
          },
        },
      },
    },
  });
  if (!o) return { ok: false, error: "That offer is gone." };
  if (o.userId !== userId) return { ok: false, error: "That offer isn't yours." };
  if (o.takenAt) return { ok: false, error: "You've already used this one." };
  const minsLeft = Math.ceil((o.expiresAt.getTime() - Date.now()) / 60000);
  if (minsLeft <= 0) return { ok: false, error: "That offer has expired." };

  const cfg = await spinConfig();
  // Filtered to what offerQuote will actually accept, so the picker cannot
  // offer an hour the payment step then refuses.
  const earnedOn = o.spin.challenge.booking?.courtConfig?.size ?? null;
  const courts = await db.courtConfig.findMany({
    where: {
      sport: o.spin.challenge.sport,
      isActive: true,
      ...(cfg.sameSizeOnly && earnedOn ? { size: earnedOn } : {}),
    },
    select: { id: true, label: true, size: true },
    orderBy: { label: "asc" },
  });
  if (courts.length === 0) return { ok: false, error: "No courts are set up for that sport." };

  const days: {
    date: string;
    courtConfigId: string;
    courtLabel: string;
    hours: { startHour: number; label: string; fullPrice: number; price: number }[];
  }[] = [];

  // IST days, matching offerQuote's own bound. Enumerating UTC days between
  // midnight and 05:30 IST offered yesterday (every hour of it blocked as
  // past) and hid tomorrow — the winner saw half the days the venue sells,
  // during exactly the hours the arena is still open.
  const today = istToday();
  for (let d = 0; d <= cfg.fallbackDays; d++) {
    const day = new Date(today.getTime() + d * 86400000);
    for (const court of courts) {
      const [avail, prices] = await Promise.all([
        getSlotAvailability(court.id, day),
        getSlotPricesForDate(court.id, day),
      ]);
      const hours = avail
        .filter((slot) => slot.status === "available")
        .map((slot) => {
          const full = prices.find((p) => p.hour === slot.hour)?.price ?? 0;
          const { price } = discounted(full, o.discountPct);
          return {
            startHour: slot.hour,
            label: hourRangeLabel(slot.hour),
            fullPrice: full,
            price,
          };
        })
        .filter((h) => h.fullPrice > 0);
      if (hours.length > 0) {
        days.push({
          date: day.toISOString().slice(0, 10),
          courtConfigId: court.id,
          courtLabel: court.label,
          hours,
        });
      }
    }
  }

  return { ok: true, pct: o.discountPct, minsLeft, days };
}
