import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileUser, getMobilePlatform } from "@/lib/mobile-auth";
import {
  listOpenChallenges,
  listMyChallenges,
  getChallenge,
  postChallenge,
  acceptChallengeWindow,
  counterChallenge,
  withdrawChallenge,
  challengeSettings,
  expireStaleChallenges,
  logChallengeEvent,
  challengeLimits,
} from "@/lib/challenges";
import { counterRefusal } from "@/lib/challenge-rules";
import { getOperatingHours } from "@/lib/court-config";
import {
  createChallengePaymentOrder,
  confirmChallengePayment,
  challengeQuote,
} from "@/lib/challenge-payments";
import {
  spinFor,
  offerQuote,
  offerSlots,
  liveOfferFor,
  createOfferOrder,
  confirmOfferPayment,
  spinConfig,
} from "@/lib/challenge-spin";

/**
 * The challenge board, for the app.
 *
 * App-only by decision — there is no customer web surface — so this is the
 * single door to the feature and every screen goes through it. One route
 * with an `op`, matching the admin routes, because the board is a handful
 * of small actions on one object rather than a REST resource.
 */

const windowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startHour: z.number().int().min(0).max(25),
  endHour: z.number().int().min(1).max(25),
  courtConfigId: z.string().nullish(),
});

export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Close out anything past its deadline before answering. A challenge
  // that still looks live because a job has not run is one somebody taps
  // and cannot take.
  await expireStaleChallenges().catch(() => 0);

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) {
    const one = await getChallenge(id);
    if (!one) return NextResponse.json({ error: "Not found" }, { status: 404 });
    void logChallengeEvent({ type: "DETAIL_VIEWED", userId: user.id, challengeId: id });
    // Answer "can this viewer still counter?" here, with the same rule the
    // write path enforces, so the screen can hide an affordance that would
    // only be refused. Computing it again in the client would be a second
    // copy of the rule, free to drift; letting the screen offer the button
    // and find out on tap walks the user into a dead end.
    const counterBlock = counterRefusal(one, user.id, await challengeLimits(), new Date());
    // The quote is priced live on every read rather than snapshotted at
    // agreement: the number the captain sees has to be the number they are
    // about to be charged, and the court that backs it can be taken by a
    // walk-in right up until the first half is paid.
    // Price the FIRST takeable window for a prospective acceptor, so the
    // take button can show the number before the payment sheet does.
    // Without the window argument every stranger got shares of zero and the
    // Razorpay sheet was the first place they saw a price.
    const isParticipant =
      one.createdByUserId === user.id || one.acceptedByUserId === user.id;
    const offered = one.windows.filter(
      (w) => w.status === "OFFERED" && w.proposedBy === "CHALLENGER",
    );
    // EVERY window, priced on its own. One quote from the first window was
    // stamped on every button, so a 1-hour slot's ₹500 appeared on a 3-hour
    // slot costing ₹1,300 and the payment sheet was the first place anyone
    // saw the real number.
    const windowQuotes = isParticipant
      ? []
      : (
          await Promise.all(
            offered.map(async (w) => {
              const q = await challengeQuote(id, user.id, w.id).catch(() => null);
              return q ? { windowId: w.id, share: q.yourShare, refusal: q.refusal } : null;
            }),
          )
        ).filter((x): x is { windowId: string; share: number | null; refusal: string | null } => !!x);
    const quote = await challengeQuote(
      id,
      user.id,
      isParticipant ? undefined : offered[0]?.id,
    ).catch(() => null);
    const offer = await liveOfferFor(id, user.id).catch(() => null);
    const liveSettings = await challengeSettings();
    return NextResponse.json({
      challenge: one,
      viewerId: user.id,
      counterBlock,
      quote,
      // So the screen can hide an affordance the server would only refuse.
      spinEnabled: liveSettings.spinEnabled,
      boardEnabled: liveSettings.enabled,
      offer,
      windowQuotes,
      // The counter picker needs the same real hours the post form does.
      hours: await getOperatingHours(),
      // The REAL segments, so the wheel on screen is the wheel that spun.
      // Drawing a decorative one and landing it on a number from elsewhere
      // is the kind of thing a player eventually notices.
      wheel: (await spinConfig()).segments,
    });
  }

  const [settings, hours] = await Promise.all([challengeSettings(), getOperatingHours()]);
  // The Home card reads this endpoint for its copy on every render. Logging
  // that as a board view would make board views a count of Home renders, and
  // the impression-to-open step of the funnel would always read 100%.
  if (url.searchParams.get("for") !== "home") {
    void logChallengeEvent({
      type: "BOARD_VIEWED",
      userId: user.id,
      detail: url.searchParams.get("sport") || "all sports",
    });
  }
  const [board, mine] = await Promise.all([
    listOpenChallenges({ sport: url.searchParams.get("sport") || undefined, viewerId: user.id }),
    listMyChallenges(user.id),
  ]);
  return NextResponse.json({
    enabled: settings.enabled,
    spinEnabled: settings.spinEnabled,
    viewerId: user.id,
    board,
    mine,
    limits: {
      sports: settings.sports,
      minPlayers: settings.minPlayers,
      maxPlayers: settings.maxPlayers,
      maxWindows: settings.maxWindows,
      maxCountersPerSide: settings.maxCountersPerSide,
      // The arena's real trading hours. The app's hour chips hard-coded
      // 5–25, so when the venue moved its closing time the board refused a
      // slot the arena was selling — while the prize picker, which reads
      // the real setting, happily offered it.
      openHour: hours.start,
      closeHour: hours.end,
      // The notice the venue needs. Without it the post picker offered the
      // next seven days from tomorrow regardless, so any setting above
      // roughly a day produced slots the server refused on submit.
      minLeadMins: settings.minLeadMins,
    },
    copy: {
      title: settings.boardTitle,
      subtitle: settings.boardSubtitle,
      empty: settings.emptyText,
    },
    homeCard: {
      enabled: settings.homeCardEnabled,
      title: settings.homeCardTitle,
      subtitle: settings.homeCardSubtitle,
      badge: settings.homeCardBadge,
    },
  });
}

const postSchema = z.object({
  op: z.literal("post"),
  sport: z.string().min(1),
  teamName: z.string().max(60).nullish(),
  playerCount: z.number().int(),
  notes: z.string().max(300).nullish(),
  windows: z.array(windowSchema).min(1).max(6),
});
const acceptSchema = z.object({
  op: z.literal("accept"),
  challengeId: z.string().min(1),
  windowId: z.string().min(1),
});
const counterSchema = z.object({
  op: z.literal("counter"),
  challengeId: z.string().min(1),
  window: windowSchema,
});
/** Taps that change nothing but are worth seeing: the home card, opening
 *  the post form, opening the counter picker. Without these the trail says
 *  who posted and nothing about who looked and walked away. */
const trackSchema = z.object({
  op: z.literal("track"),
  type: z.enum([
    "HOME_CARD_SHOWN",
    "HOME_CARD_TAPPED",
    "POST_OPENED",
    "ACCEPT_TAPPED",
    "COUNTER_OPENED",
  ]),
  challengeId: z.string().nullish(),
  detail: z.string().max(200).nullish(),
});
/* Paying is two ops rather than one because a gateway sits in the middle:
 * `pay-order` opens a Razorpay order for this side's half, the sheet runs
 * on the device, and `pay-verify` brings the signature back. Splitting them
 * is what makes the verify idempotent — a captain who double-taps returns
 * the same order, and confirmChallengePayment refuses to bank it twice. */
const payOrderSchema = z.object({
  op: z.literal("pay-order"),
  challengeId: z.string().min(1),
  /** Present when this payment IS the acceptance. */
  windowId: z.string().min(1).nullish(),
});
const spinSchema = z.object({
  op: z.literal("spin"),
  challengeId: z.string().min(1),
});
const offerQuoteSchema = z.object({
  op: z.literal("offer-quote"),
  offerId: z.string().min(1),
  pick: z
    .object({
      courtConfigId: z.string().min(1),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      startHour: z.number().int().min(0).max(25),
    })
    .nullish(),
});
const offerSlotsSchema = z.object({
  op: z.literal("offer-slots"),
  offerId: z.string().min(1),
});
const offerOrderSchema = z.object({
  op: z.literal("offer-order"),
  offerId: z.string().min(1),
  pick: offerQuoteSchema.shape.pick,
});
const offerVerifySchema = z.object({
  op: z.literal("offer-verify"),
  offerId: z.string().min(1),
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
  pick: offerQuoteSchema.shape.pick,
});
const payVerifySchema = z.object({
  op: z.literal("pay-verify"),
  challengeId: z.string().min(1),
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});
const withdrawSchema = z.object({
  op: z.literal("withdraw"),
  challengeId: z.string().min(1),
  reason: z.string().max(200).nullish(),
});

export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = z
    .discriminatedUnion("op", [
      postSchema,
      acceptSchema,
      counterSchema,
      withdrawSchema,
      trackSchema,
      payOrderSchema,
      payVerifySchema,
      spinSchema,
      offerQuoteSchema,
      offerSlotsSchema,
      offerOrderSchema,
      offerVerifySchema,
    ])
    .safeParse(json);
  if (!parsed.success) {
    // Zod's own wording ("Too big: expected number to be <=25") is shown
    // verbatim in an Alert on the phone. Name the field instead.
    const issue = parsed.error.issues[0];
    const field = issue?.path?.filter((p) => typeof p === "string").join(" ") || "request";
    return NextResponse.json(
      { error: `That ${field} isn't something the arena accepts.` },
      { status: 400 },
    );
  }
  const body = parsed.data;

  if (body.op === "track") {
    await logChallengeEvent({
      type: body.type,
      userId: user.id,
      challengeId: body.challengeId ?? null,
      detail: body.detail ?? null,
    });
    return NextResponse.json({ ok: true });
  }

  if (body.op === "spin") {
    const r = await spinFor(body.challengeId, user.id);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json(r);
  }

  if (body.op === "offer-quote") {
    const r = await offerQuote(body.offerId, user.id, body.pick ?? undefined);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json(r);
  }

  if (body.op === "offer-slots") {
    const r = await offerSlots(body.offerId, user.id);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json(r);
  }

  if (body.op === "offer-order") {
    const r = await createOfferOrder(body.offerId, user.id, body.pick ?? undefined);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json(r);
  }

  if (body.op === "offer-verify") {
    const r = await confirmOfferPayment({
      offerId: body.offerId,
      userId: user.id,
      razorpayOrderId: body.razorpayOrderId,
      razorpayPaymentId: body.razorpayPaymentId,
      razorpaySignature: body.razorpaySignature,
      pick: body.pick ?? undefined,
      platform: getMobilePlatform(request),
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json(r);
  }

  if (body.op === "pay-order") {
    const r = await createChallengePaymentOrder(
      body.challengeId,
      user.id,
      body.windowId ?? undefined,
    );
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json(r);
  }

  if (body.op === "pay-verify") {
    const r = await confirmChallengePayment({
      challengeId: body.challengeId,
      userId: user.id,
      razorpayOrderId: body.razorpayOrderId,
      razorpayPaymentId: body.razorpayPaymentId,
      razorpaySignature: body.razorpaySignature,
      platform: getMobilePlatform(request),
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json(r);
  }

  let result: { ok: boolean; error?: string; id?: string };
  if (body.op === "post") {
    result = await postChallenge({
      userId: user.id,
      sport: body.sport,
      teamName: body.teamName ?? null,
      playerCount: body.playerCount,
      notes: body.notes ?? null,
      windows: body.windows,
    });
  } else if (body.op === "accept") {
    result = await acceptChallengeWindow(body.challengeId, body.windowId, user.id);
  } else if (body.op === "counter") {
    result = await counterChallenge(body.challengeId, user.id, body.window);
  } else {
    result = await withdrawChallenge(body.challengeId, user.id, body.reason ?? undefined);
  }

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
