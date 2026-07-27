import { db } from "@/lib/db";
import { RAZORPAY_KEY_ID } from "@/lib/razorpay";
import { validateCoupon } from "@/actions/coupon-validation";
import { redeemForTournament, refundRedemption } from "@/lib/rewards/redeem";
import { awardTournamentPoints } from "@/lib/rewards/earn";
import { onlinePayable } from "@/lib/tournament-config";

// The key secret isn't exported from lib/razorpay — read it like lib/passes does.
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";

// Customer-side tournament domain: public reads, team registration and
// entry-fee confirmation. Payment mirrors the passes module (money-first
// Razorpay order whose NOTES carry what is being bought; verify + webhook
// both land in confirmTournamentEntry, idempotent on team status).

// ── Module master switch (mirrors arePassesEnabled) ─────────────────
export async function areTournamentsEnabled(): Promise<boolean> {
  try {
    const settings = await db.arenaSettings.findFirst({
      select: { tournamentsEnabled: true },
    });
    return settings?.tournamentsEnabled ?? false;
  } catch {
    return false;
  }
}

// ── Public reads ────────────────────────────────────────────────────
export async function listPublicTournaments() {
  return db.tournament.findMany({
    where: { status: { notIn: ["DRAFT", "CANCELLED"] } },
    orderBy: [{ startDate: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      sport: true,
      status: true,
      format: true,
      bannerImageUrl: true,
      totalTeams: true,
      entryFee: true,
      feeMode: true,
      prizePool: true,
      startDate: true,
      regCloseAt: true,
      liveScoringEnabled: true,
      _count: { select: { teams: { where: { status: "CONFIRMED" } } } },
    },
  });
}

export async function getPublicTournamentBySlug(slug: string) {
  const t = await db.tournament.findUnique({
    where: { slug },
    include: {
      teams: {
        where: { status: { in: ["CONFIRMED", "WAITLISTED", "PENDING_PAYMENT"] } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          logoUrl: true,
          color: true,
          status: true,
          poolId: true,
          captainUserId: true,
        },
      },
      pools: {
        orderBy: { order: "asc" },
        select: { id: true, name: true, order: true },
      },
    },
  });
  if (!t || t.status === "DRAFT" || t.status === "CANCELLED") return null;
  return t;
}

// ── Registration ────────────────────────────────────────────────────
export type RegisterInput = {
  tournamentId: string;
  userId: string;
  teamName: string;
  color?: string | null;
  logoUrl?: string | null;
  members: string[]; // first entry = captain's player name
  captainName: string;
  captainPhone: string;
  captainEmail?: string | null;
  couponCode?: string | null;
  pointsToRedeem?: number | null;
  platform?: "web" | "android" | "ios";
};

export type RegisterResult =
  | { ok: false; error: string }
  | {
      ok: true;
      teamId: string;
      state: "CONFIRMED" | "WAITLISTED" | "PENDING_PAYMENT";
      // present when state === PENDING_PAYMENT
      order?: { orderId: string; amount: number };
      discount: number;
      payable: number;
      dueAtVenue: number;
    };

export async function registerTournamentTeam(input: RegisterInput): Promise<RegisterResult> {
  if (!(await areTournamentsEnabled())) {
    return { ok: false, error: "Tournaments aren't available right now" };
  }
  const t = await db.tournament.findUnique({
    where: { id: input.tournamentId },
    select: {
      id: true,
      name: true,
      sport: true,
      status: true,
      totalTeams: true,
      membersPerTeamMin: true,
      membersPerTeamMax: true,
      entryFee: true,
      feeMode: true,
      advancePct: true,
      allowCoupons: true,
      allowRewardPoints: true,
      waitlistEnabled: true,
      regCloseAt: true,
    },
  });
  if (!t) return { ok: false, error: "Tournament not found" };
  if (t.status !== "REG_OPEN") return { ok: false, error: "Registrations are not open" };
  if (t.regCloseAt && new Date() > t.regCloseAt) {
    return { ok: false, error: "Registrations have closed" };
  }

  const teamName = input.teamName.trim().slice(0, 60);
  if (teamName.length < 2) return { ok: false, error: "Enter a team name" };
  const members = input.members.map((m) => m.trim()).filter(Boolean);
  if (members.length < t.membersPerTeamMin || members.length > t.membersPerTeamMax) {
    return {
      ok: false,
      error: `Squad must have ${t.membersPerTeamMin}–${t.membersPerTeamMax} players`,
    };
  }
  const captainName = input.captainName.trim();
  const captainPhone = input.captainPhone.replace(/[^\d+]/g, "");
  if (!captainName || captainPhone.replace(/\D/g, "").length < 10) {
    return { ok: false, error: "Captain name and a valid phone are required" };
  }

  // One live team per user per tournament.
  const existing = await db.tournamentTeam.findFirst({
    where: {
      tournamentId: t.id,
      captainUserId: input.userId,
      status: { in: ["CONFIRMED", "PENDING_PAYMENT", "WAITLISTED"] },
    },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, error: "You have already registered a team in this tournament" };
  }
  const nameTaken = await db.tournamentTeam.findFirst({
    where: {
      tournamentId: t.id,
      name: { equals: teamName, mode: "insensitive" },
      status: { in: ["CONFIRMED", "PENDING_PAYMENT", "WAITLISTED"] },
    },
    select: { id: true },
  });
  if (nameTaken) return { ok: false, error: "That team name is taken — pick another" };

  // Capacity: CONFIRMED + in-flight PENDING_PAYMENT hold slots.
  const taken = await db.tournamentTeam.count({
    where: { tournamentId: t.id, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] } },
  });
  const isFull = taken >= t.totalTeams;
  if (isFull && !t.waitlistEnabled) return { ok: false, error: "The tournament is full" };

  // Coupon → discount on the entry fee.
  let discount = 0;
  let couponCode: string | null = null;
  if (input.couponCode && t.allowCoupons && t.feeMode !== "FREE" && !isFull) {
    const res = await validateCoupon(input.couponCode, {
      scope: "SPORTS",
      amount: t.entryFee,
      userId: input.userId,
      sport: t.sport,
      platform: input.platform,
    });
    if (!res.valid) return { ok: false, error: res.error || "Invalid coupon" };
    discount = Math.min(res.discountAmount || 0, t.entryFee);
    couponCode = input.couponCode.toUpperCase().trim();
  }

  let netFee = Math.max(0, t.entryFee - discount);
  let payable = isFull ? 0 : onlinePayable(netFee, t.feeMode, t.advancePct);
  let dueAtVenue = isFull ? 0 : netFee - payable;

  let state: "CONFIRMED" | "WAITLISTED" | "PENDING_PAYMENT" = isFull
    ? "WAITLISTED"
    : payable > 0
      ? "PENDING_PAYMENT"
      : "CONFIRMED";

  const team = await db.tournamentTeam.create({
    data: {
      tournamentId: t.id,
      status: state,
      name: teamName,
      color: input.color || null,
      logoUrl: input.logoUrl || null,
      captainUserId: input.userId,
      captainName,
      captainPhone,
      captainEmail: input.captainEmail || null,
      couponCode,
      discount,
      paidAmount: 0,
      dueAmount: state === "CONFIRMED" ? dueAtVenue : 0,
      paymentMethod: state === "CONFIRMED" && netFee === 0 ? "FREE" : null,
      members: {
        create: members.map((name, i) => ({
          name: name.slice(0, 60),
          order: i,
          isCaptain: i === 0,
        })),
      },
    },
  });

  // Reward-points redemption — AFTER the team row exists (the ledger row is
  // keyed to the team for idempotency + refund). The guarded debit inside
  // redeemForTournament enforces balance/caps atomically; on any failure the
  // registration is rolled back so no phantom slot is held.
  const requestedPoints = Math.max(0, Math.floor(input.pointsToRedeem || 0));
  if (
    requestedPoints > 0 &&
    t.allowRewardPoints &&
    t.feeMode !== "FREE" &&
    state === "PENDING_PAYMENT" &&
    netFee > 0
  ) {
    const res = await redeemForTournament({
      userId: input.userId,
      tournamentTeamId: team.id,
      points: requestedPoints,
      billPaise: netFee * 100,
    });
    if (!res.redeemed) {
      await db.tournamentTeam.delete({ where: { id: team.id } }).catch(() => {});
      return { ok: false, error: res.error || "Couldn't redeem points" };
    }
    const pointsDiscount = Math.min(netFee, Math.round((res.discountPaise || 0) / 100));
    // Team.discount carries the TOTAL discount (coupon + points) — the
    // amount-expectation check in confirmTournamentEntry derives the
    // payable from it; pointsUsed keeps the points leg for refunds.
    discount += pointsDiscount;
    netFee = Math.max(0, netFee - pointsDiscount);
    payable = onlinePayable(netFee, t.feeMode, t.advancePct);
    dueAtVenue = netFee - payable;
    if (payable <= 0) state = "CONFIRMED";
    await db.tournamentTeam.update({
      where: { id: team.id },
      data: {
        discount,
        pointsUsed: res.pointsConsumed || requestedPoints,
        status: state,
        dueAmount: state === "CONFIRMED" ? dueAtVenue : 0,
        paymentMethod: state === "CONFIRMED" && netFee === 0 ? "POINTS" : null,
      },
    });
  }

  if (state === "CONFIRMED" && couponCode) {
    await recordCouponUse(couponCode, input.userId, discount);
  }

  if (state !== "PENDING_PAYMENT") {
    return { ok: true, teamId: team.id, state, discount, payable: 0, dueAtVenue };
  }

  // Money-first Razorpay order; notes are the source of truth at verify
  // (mirrors createPassOrder — a raw orders call so notes carry our type).
  try {
    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({
        amount: Math.round(payable * 100),
        currency: "INR",
        receipt: `trn_${team.id.slice(-12)}`,
        notes: {
          type: "TOURNAMENT_ENTRY",
          teamId: team.id,
          tournamentId: t.id,
          userId: input.userId,
        },
      }),
    });
    if (!res.ok) throw new Error(`Razorpay tournament order failed: ${await res.text()}`);
    const order = (await res.json()) as { id: string };
    return {
      ok: true,
      teamId: team.id,
      state,
      order: { orderId: order.id, amount: payable },
      discount,
      payable,
      dueAtVenue,
    };
  } catch (err) {
    // Roll the slot back so a gateway hiccup doesn't strand a pending team
    // — refunding any points redeemed a moment ago first (idempotent).
    if (requestedPoints > 0) {
      await refundRedemption({
        userId: input.userId,
        points: requestedPoints,
        tournamentTeamId: team.id,
        reason: "tournament order-create failed",
      }).catch(() => {});
    }
    await db.tournamentTeam.delete({ where: { id: team.id } }).catch(() => {});
    console.error("[tournaments] order create failed", err);
    return { ok: false, error: "Couldn't start the payment — please try again" };
  }
}

async function recordCouponUse(code: string, userId: string, discountAmount: number) {
  const coupon = await db.coupon.findFirst({ where: { code }, select: { id: true } });
  if (!coupon) return;
  await db.$transaction([
    db.couponUsage.create({ data: { couponId: coupon.id, userId, discountAmount } }),
    db.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } }),
  ]).catch(() => {}); // usage bookkeeping must never fail a paid registration
}

// ── Payment confirmation (verify route + webhook both land here) ────
export async function confirmTournamentEntry(args: {
  teamId: string;
  razorpayPaymentId: string;
  paidRupees: number;
  /** Payment surface for the record — defaults to RAZORPAY; the DQR
   *  status/callback paths pass UPI_DQR. */
  method?: string;
}): Promise<{ ok: boolean; already?: boolean; error?: string }> {
  const team = await db.tournamentTeam.findUnique({
    where: { id: args.teamId },
    select: {
      id: true,
      status: true,
      discount: true,
      couponCode: true,
      captainUserId: true,
      tournament: {
        select: { id: true, entryFee: true, feeMode: true, advancePct: true },
      },
    },
  });
  if (!team) return { ok: false, error: "Team not found" };
  if (team.status === "CONFIRMED") return { ok: true, already: true }; // idempotent

  const netFee = Math.max(0, team.tournament.entryFee - team.discount);
  const expected = onlinePayable(netFee, team.tournament.feeMode, team.tournament.advancePct);
  if (args.paidRupees !== expected) {
    return { ok: false, error: `Amount mismatch: paid ₹${args.paidRupees}, expected ₹${expected}` };
  }

  await db.tournamentTeam.update({
    where: { id: team.id },
    data: {
      status: "CONFIRMED",
      paidAmount: expected,
      dueAmount: netFee - expected,
      paymentMethod: args.method || "RAZORPAY",
      paymentRef: args.razorpayPaymentId,
    },
  });
  if (team.couponCode && team.captainUserId) {
    await recordCouponUse(team.couponCode, team.captainUserId, team.discount);
  }
  // Earn on the amount actually paid — idempotent per team, and its
  // failure must never fail a captured payment's confirmation.
  await awardTournamentPoints(team.id).catch(() => {});
  return { ok: true };
}

// ── UPI DQR entry-fee path ──────────────────────────────────────────
/** Confirm a tournament entry paid via PhonePe DQR. Called by BOTH the
 *  client status poll and the S2S callback — idempotent (a CONFIRMED
 *  team short-circuits). `amountPaise` is PhonePe's captured amount and
 *  must equal the team's expected online payable; a mismatch orphans the
 *  money for admin recovery instead of silently confirming. */
export async function confirmDqrTournament(
  transactionId: string,
  providerReferenceId: string | undefined,
  amountPaise: number | undefined
): Promise<{ teamId?: string; mismatch?: boolean }> {
  if (!transactionId.startsWith("DQRT_")) return {};
  const team = await db.tournamentTeam.findFirst({
    where: { paymentRef: transactionId },
    select: { id: true, status: true, captainUserId: true },
  });
  if (!team) return {};
  if (team.status === "CONFIRMED") return { teamId: team.id }; // idempotent

  const paidRupees = Math.round((amountPaise ?? 0) / 100);
  const res = await confirmTournamentEntry({
    teamId: team.id,
    razorpayPaymentId: providerReferenceId || transactionId,
    paidRupees,
    method: "UPI_DQR",
  });
  if (!res.ok) {
    const { recordOrphanPayment } = await import("@/lib/payment-orphan");
    recordOrphanPayment({
      gateway: "PHONEPE_DQR",
      reason: `tournament-${res.error || "confirm-failed"}`,
      userId: team.captainUserId || "unknown",
      amountRupees: paidRupees,
      phonePeMerchantTxnId: transactionId,
      path: "/api/phonepe/dqr/tournament",
    });
    return { mismatch: true };
  }
  return { teamId: team.id };
}
