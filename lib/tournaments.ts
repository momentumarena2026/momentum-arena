import { db } from "@/lib/db";
import { RAZORPAY_KEY_ID } from "@/lib/razorpay";
import { validateCoupon } from "@/actions/coupon-validation";
import { redeemForTournament, refundRedemption } from "@/lib/rewards/redeem";
import { awardTournamentPoints } from "@/lib/rewards/earn";
import { onlinePayable } from "@/lib/tournament-config";
import { notifyUser } from "@/lib/user-notifications";

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

// ── Scheduled auto-transitions ──────────────────────────────────────
/** The registration window runs ITSELF: when regOpenAt passes, a PUBLISHED
 *  tournament flips to REG_OPEN (firing its campaign milestone) and when
 *  regCloseAt passes, REG_OPEN flips to REG_CLOSED — lazily, on the first
 *  public read after the moment, so no cron is needed and the "Registrations
 *  open <time>" copy can never sit in the past. Guarded updateMany makes the
 *  flip race-safe under concurrent page loads (only one caller wins and
 *  fires the push). Admin manual transitions still work and simply pre-empt
 *  the schedule. Returns the effective status. */
export async function applyScheduledTransitions(t: {
  id: string;
  status: string;
  regOpenAt: Date | null;
  regCloseAt: Date | null;
}): Promise<string> {
  const now = new Date();
  let status = t.status;

  if (status === "PUBLISHED" && t.regOpenAt && now >= t.regOpenAt) {
    const res = await db.tournament.updateMany({
      where: { id: t.id, status: "PUBLISHED" },
      data: { status: "REG_OPEN" },
    });
    status = "REG_OPEN";
    if (res.count > 0) {
      // This caller won the race — fire the registrations-open campaign.
      const { fireMilestone } = await import("@/lib/tournament-campaign");
      await fireMilestone(t.id, "REG_OPEN").catch(() => {});
    }
  }

  if (status === "REG_OPEN" && t.regCloseAt && now > t.regCloseAt) {
    await db.tournament.updateMany({
      where: { id: t.id, status: "REG_OPEN" },
      data: { status: "REG_CLOSED" },
    });
    status = "REG_CLOSED";
  }

  return status;
}

// ── Public reads ────────────────────────────────────────────────────
export async function listPublicTournaments() {
  const rows = await db.tournament.findMany({
    where: { status: { notIn: ["DRAFT", "CANCELLED"] }, archivedAt: null },
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
      regOpenAt: true,
      regCloseAt: true,
      liveScoringEnabled: true,
      _count: {
        select: { teams: { where: { status: "CONFIRMED", archivedAt: null } } },
      },
    },
  });
  // Lazily run any due window transitions (usually a no-op for every row).
  for (const row of rows) {
    if (
      (row.status === "PUBLISHED" && row.regOpenAt && row.regOpenAt <= new Date()) ||
      (row.status === "REG_OPEN" && row.regCloseAt && row.regCloseAt < new Date())
    ) {
      row.status = (await applyScheduledTransitions(row)) as typeof row.status;
    }
  }
  return rows;
}

export async function getPublicTournamentBySlug(slug: string) {
  const t = await db.tournament.findUnique({
    where: { slug },
    include: {
      // Pre-decided pool/league windows — shown on the public page so a
      // team knows when it would have to turn up before it enters.
      slots: {
        orderBy: [{ date: "asc" }, { startHour: "asc" }],
        include: { courtConfig: { select: { label: true } } },
      },
      teams: {
        where: {
          status: { in: ["CONFIRMED", "WAITLISTED", "PENDING_PAYMENT"] },
          archivedAt: null,
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          logoUrl: true,
          color: true,
          status: true,
          poolId: true,
          captainUserId: true,
          // Drives the captain's slot-preference checkboxes.
          preferredSlotIds: true,
        },
      },
      pools: {
        orderBy: { order: "asc" },
        select: { id: true, name: true, order: true },
      },
    },
  });
  if (!t || t.status === "DRAFT" || t.status === "CANCELLED") return null;
  t.status = (await applyScheduledTransitions(t)) as typeof t.status;
  return t;
}

// ── Abandoned-checkout sweep ────────────────────────────────────────
/**
 * How long a withdrawn, never-paid registration is kept before deletion.
 *
 * Matched to the booking side's PAYMENT_GRACE_HOURS for the same reason: a
 * PhonePe DQR can settle well after our own window closes, and
 * confirmDqrTournament resolves that late payment by finding the team —
 * first by paymentRef, then by the team id embedded in the txn string
 * (DQRT_<last12 of teamId>_<ms>). Delete the row inside that window and BOTH
 * lookups miss, so the payment lands in recordOrphanPayment: money captured,
 * nothing to attach it to. That is the orphaned-payment leak already fixed
 * once on bookings, and it is why this is 24 hours rather than immediate.
 */
const ABANDONED_TEAM_RETENTION_HOURS = 24;

/**
 * Delete abandoned registrations once no late payment can arrive for them.
 *
 * An abandoned checkout leaves a WITHDRAWN row behind (sweepStalePendingTeams
 * withdraws rather than deletes, deliberately). Those rows are already hidden
 * from every customer-facing read, but they accumulate in the admin list
 * where a ₹0 team with slot preferences reads like a registration that
 * skipped payment — which is exactly the confusion this removes.
 *
 * The safety rules mirror deleteTournamentTeam's, because the same things
 * make a row undeletable however the delete is triggered:
 * - anything paid, in money or points, is a receipt and is kept forever
 * - anything with fixtures or recorded stats is history and is kept
 *
 * Lazy, like the sweep above: no cron, runs on registration and on admin
 * reads. Returns the number deleted so callers can log it.
 */
export async function purgeAbandonedTeams(tournamentId: string): Promise<number> {
  const cutoff = new Date(
    Date.now() - ABANDONED_TEAM_RETENTION_HOURS * 60 * 60 * 1000,
  );
  const { count } = await db.tournamentTeam.deleteMany({
    where: {
      tournamentId,
      status: "WITHDRAWN",
      // Never touch money. paidAt is checked as well as paidAmount because a
      // ₹0 entry (free tournament, full coupon) that was genuinely confirmed
      // still has a settlement timestamp worth keeping.
      paidAmount: 0,
      pointsUsed: 0,
      paidAt: null,
      // Past the window in which a late gateway confirmation could arrive.
      updatedAt: { lt: cutoff },
      // Never delete anything that actually played or was scored.
      homeMatches: { none: {} },
      awayMatches: { none: {} },
      playerStats: { none: {} },
    },
  });
  return count;
}

/** How long a PENDING_PAYMENT team keeps its slot before it's released. */
// 10, not 30: this only exists to stop an abandoned checkout holding a
// slot forever, and 30 minutes locked a captain out of their own
// tournament long after they had given up and wanted to retry.
//
// The row is WITHDRAWN, never deleted. Deleting would free the name and
// the slot just the same, but it also destroys the row a late gateway
// confirmation attaches to — PhonePe DQR can settle after the window —
// and that is the orphaned-payment leak we already fixed on bookings.
const PENDING_PAYMENT_TTL_MINUTES = 10;

/** Release registrations whose payment was never completed.
 *
 *  A PENDING_PAYMENT team consumes two scarce things: the captain's
 *  one-live-team-per-tournament slot and a capacity slot. Without a sweep,
 *  a customer who simply dismissed the payment sheet is locked out of the
 *  tournament forever and the venue's last spot is held by nobody — so this
 *  runs lazily (no cron) on registration and on public reads.
 *
 *  Any reward points redeemed at registration are returned; the refund is
 *  idempotent per team, and a team whose payment lands later is protected
 *  by confirmTournamentEntry's status guard. */
export async function sweepStalePendingTeams(tournamentId: string): Promise<void> {
  const cutoff = new Date(Date.now() - PENDING_PAYMENT_TTL_MINUTES * 60 * 1000);
  const stale = await db.tournamentTeam.findMany({
    where: { tournamentId, status: "PENDING_PAYMENT", createdAt: { lt: cutoff } },
    select: { id: true, pointsUsed: true, captainUserId: true },
  });
  if (stale.length === 0) return;

  for (const team of stale) {
    // Guarded so a payment confirming right now always wins the race.
    const released = await db.tournamentTeam.updateMany({
      where: { id: team.id, status: "PENDING_PAYMENT" },
      data: { status: "WITHDRAWN", pointsUsed: 0 },
    });
    if (released.count === 0) continue;
    if (team.pointsUsed > 0 && team.captainUserId) {
      await refundRedemption({
        userId: team.captainUserId,
        points: team.pointsUsed,
        tournamentTeamId: team.id,
        reason: "tournament registration abandoned",
      }).catch(() => {});
    }
  }
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
      host: true,
      totalTeams: true,
      membersPerTeamMin: true,
      membersPerTeamMax: true,
      entryFee: true,
      feeMode: true,
      advancePct: true,
      allowCoupons: true,
      allowRewardPoints: true,
      waitlistEnabled: true,
      regOpenAt: true,
      regCloseAt: true,
    },
  });
  if (!t) return { ok: false, error: "Tournament not found" };
  // A third-party organiser runs their own registrations off our platform,
  // so there is nothing here to sign up for. Checked server-side rather
  // than by hiding the button: a hidden control is not a closed door, and
  // this route also backs the mobile app and any stale open tab.
  if (t.host === "THIRD_PARTY") {
    return { ok: false, error: "This tournament is run by an external organiser — register with them directly" };
  }
  const effectiveStatus = await applyScheduledTransitions(t);
  if (effectiveStatus !== "REG_OPEN") return { ok: false, error: "Registrations are not open" };
  if (t.regCloseAt && new Date() > t.regCloseAt) {
    return { ok: false, error: "Registrations have closed" };
  }

  const teamName = input.teamName.trim().slice(0, 60);
  if (teamName.length < 2) return { ok: false, error: "Enter a team name" };
  // Squad is OPTIONAL at registration — the captain registers (and pays)
  // solo; players can be added later by the captain or an admin.
  const members = input.members.map((m) => m.trim()).filter(Boolean);
  if (members.length > t.membersPerTeamMax) {
    return { ok: false, error: `Squad can have at most ${t.membersPerTeamMax} players` };
  }
  const captainName = input.captainName.trim();
  const captainPhone = input.captainPhone.replace(/[^\d+]/g, "");
  if (!captainName || captainPhone.replace(/\D/g, "").length < 10) {
    return { ok: false, error: "Captain name and a valid phone are required" };
  }
  const squad = members.length > 0 ? members : [captainName];

  // Release any abandoned checkouts first — they hold both the captain's
  // one-team-per-tournament slot and a capacity slot. Then clear out ones
  // old enough that no late payment can still arrive for them.
  await sweepStalePendingTeams(t.id);
  await purgeAbandonedTeams(t.id).catch(() => 0);

  // One live team per user per tournament.
  const existing = await db.tournamentTeam.findFirst({
    where: {
      tournamentId: t.id,
      captainUserId: input.userId,
      status: { in: ["CONFIRMED", "PENDING_PAYMENT", "WAITLISTED"] },
    },
    select: { id: true, status: true, pointsUsed: true },
  });
  if (existing) {
    // The captain's OWN abandoned checkout is not a collision — it is them
    // trying again. Cancelling at the payment sheet used to lock them out
    // of their own tournament for the whole TTL, behind an error that read
    // as though someone else had taken their place.
    //
    // Release it here and let registration proceed normally: exactly what
    // the sweep would do minutes later, just without the wait. The row is
    // WITHDRAWN rather than deleted so a late gateway confirmation still
    // has something to attach to, and any reward points go back.
    if (existing.status === "PENDING_PAYMENT") {
      const released = await db.tournamentTeam.updateMany({
        where: { id: existing.id, status: "PENDING_PAYMENT" },
        data: { status: "WITHDRAWN", pointsUsed: 0 },
      });
      // count === 0 means a payment confirmed in the gap between our read
      // and this write. That team is real now, so do NOT let a second one
      // through — tell them it is done.
      if (released.count === 0) {
        return {
          ok: false,
          error: "Your team is already registered for this tournament",
        };
      }
      if (existing.pointsUsed > 0 && input.userId) {
        await refundRedemption({
          userId: input.userId,
          points: existing.pointsUsed,
          tournamentTeamId: existing.id,
          reason: "tournament registration retried",
        }).catch(() => {});
      }
    } else {
      return {
        ok: false,
        error:
          existing.status === "WAITLISTED"
            ? "Your team is already on the waitlist for this tournament"
            : "Your team is already registered for this tournament",
      };
    }
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
    where: {
      tournamentId: t.id,
      status: { in: ["CONFIRMED", "PENDING_PAYMENT"] },
      archivedAt: null,
    },
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
        create: squad.map((name, i) => ({
          name: name.slice(0, 60),
          order: i,
          isCaptain: i === 0,
        })),
      },
    },
  });

  // Capacity is checked before the insert, so N simultaneous registrations
  // can all pass that check and oversubscribe the tournament. Re-count after
  // the write and stand down if this row is the one that broke the cap —
  // an optimistic guard, which suits a race this rare.
  if (!isFull) {
    const nowTaken = await db.tournamentTeam.count({
      where: { tournamentId: t.id, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] } },
    });
    if (nowTaken > t.totalTeams) {
      await db.tournamentTeam.delete({ where: { id: team.id } }).catch(() => {});
      return t.waitlistEnabled
        ? { ok: false, error: "The last spot just went — please try again to join the waitlist" }
        : { ok: false, error: "The tournament is full" };
    }
  }

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

/** Claim one use of a coupon, enforcing both caps atomically.
 *
 *  validateCoupon at registration only *reads* the counters, so without a
 *  guarded claim here the same code can be spent repeatedly — concurrently
 *  for the global cap, or across tournaments for the per-user cap. The
 *  guarded updateMany (same shape as the booking path) makes the increment
 *  and the limit test a single atomic step, and it also serialises the
 *  per-user count onto the coupon row.
 *
 *  A refused claim must NOT fail an already-captured payment: the entry is
 *  confirmed either way and the discount stands; we simply don't record a
 *  use beyond the cap. */
async function recordCouponUse(code: string, userId: string, discountAmount: number) {
  const coupon = await db.coupon.findFirst({
    where: { code },
    select: { id: true, maxUses: true, maxUsesPerUser: true },
  });
  if (!coupon) return;
  try {
    await db.$transaction(async (tx) => {
      const claimed = await tx.coupon.updateMany({
        where: {
          id: coupon.id,
          ...(coupon.maxUses !== null ? { usedCount: { lt: coupon.maxUses } } : {}),
        },
        data: { usedCount: { increment: 1 } },
      });
      if (claimed.count === 0) throw new Error("COUPON_LIMIT_EXCEEDED");

      const priorUserUsage = await tx.couponUsage.count({
        where: { couponId: coupon.id, userId },
      });
      if (coupon.maxUsesPerUser !== null && priorUserUsage >= coupon.maxUsesPerUser) {
        throw new Error("COUPON_LIMIT_EXCEEDED");
      }
      await tx.couponUsage.create({ data: { couponId: coupon.id, userId, discountAmount } });
    });
  } catch {
    // Over cap or transient failure — never fail a paid registration on
    // bookkeeping.
  }
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
      name: true,
      tournament: {
        select: {
          id: true,
          name: true,
          slug: true,
          entryFee: true,
          feeMode: true,
          advancePct: true,
        },
      },
    },
  });
  if (!team) return { ok: false, error: "Team not found" };
  if (team.status === "CONFIRMED") return { ok: true, already: true }; // idempotent
  // A team the admin already rejected/withdrew must not be resurrected by a
  // late webhook — its points were refunded, so confirming it now would
  // hand back both the points and the discount they bought.
  if (!["PENDING_PAYMENT", "WAITLISTED"].includes(team.status)) {
    return { ok: false, error: `Team is ${team.status.toLowerCase()} — payment can't be applied` };
  }

  const netFee = Math.max(0, team.tournament.entryFee - team.discount);
  const expected = onlinePayable(netFee, team.tournament.feeMode, team.tournament.advancePct);
  if (args.paidRupees !== expected) {
    return { ok: false, error: `Amount mismatch: paid ₹${args.paidRupees}, expected ₹${expected}` };
  }

  // Guarded write: exactly one of a racing verify-call and webhook wins, so
  // the coupon-use and points-earn side effects below run once.
  const claimed = await db.tournamentTeam.updateMany({
    where: { id: team.id, status: { in: ["PENDING_PAYMENT", "WAITLISTED"] } },
    data: {
      status: "CONFIRMED",
      // Cash-basis stamp for analytics / CA — set once, on first confirm.
      paidAt: new Date(),
      paidAmount: expected,
      dueAmount: netFee - expected,
      paymentMethod: args.method || "RAZORPAY",
      paymentRef: args.razorpayPaymentId,
    },
  });
  if (claimed.count === 0) return { ok: true, already: true }; // the other path won
  if (team.couponCode && team.captainUserId) {
    await recordCouponUse(team.couponCode, team.captainUserId, team.discount);
  }
  // Earn on the amount actually paid — idempotent per team, and its
  // failure must never fail a captured payment's confirmation.
  await awardTournamentPoints(team.id).catch(() => {});

  // Tell both sides the money landed. This runs inside the claimed-once
  // branch above, so a racing webhook + status-poll pair can't double-send.
  // Everything here is best-effort: a push outage must never fail a
  // confirmation whose payment is already captured.
  if (team.captainUserId) {
    void notifyUser(team.captainUserId, {
      type: "TOURNAMENT_CONFIRMED",
      title: "You're in! 🏆",
      body: `${team.name} is confirmed for ${team.tournament.name}. Payment of ₹${args.paidRupees.toLocaleString("en-IN")} received.`,
      link: `/tournaments/${team.tournament.slug}`,
    });
  }
  void import("./push")
    .then(({ sendToAdmins }) =>
      sendToAdmins(
        {
          title: "Tournament entry paid",
          body: `${team.name} paid ₹${args.paidRupees.toLocaleString("en-IN")} for ${team.tournament.name} — confirm the team.`,
          data: {
            kind: "admin_tournament_paid",
            link: `/admin/tournaments/${team.tournament.id}?tab=teams`,
          },
        },
        { source: "event" },
      ),
    )
    .catch((err) =>
      console.error("[tournaments] admin paid-push failed:", err),
    );

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
  if (!team) {
    // A DQRT_ transaction with no team behind it means its paymentRef was
    // superseded (or the team was deleted). The team id is recoverable from
    // the txn itself: DQRT_<last12 of teamId>_<ms>.
    //
    // Re-initiating the QR (expiry, a second scan attempt) overwrites
    // team.paymentRef, so the poll for the FIRST txn stops matching even
    // though that payment confirmed the team perfectly well. Reporting
    // "we couldn't auto-confirm your team" there alarms a customer whose
    // spot is in fact booked, and files a bogus orphan on top. Resolve the
    // team from the txn and treat an already-CONFIRMED team as the success
    // it is — only genuinely unaccounted money reaches the orphan path.
    const seg = transactionId.split("_")[1];
    const superseded = seg
      ? await db.tournamentTeam.findFirst({
          where: { id: { endsWith: seg } },
          select: { id: true, status: true },
        })
      : null;
    if (superseded?.status === "CONFIRMED") {
      return { teamId: superseded.id };
    }
    const { recordOrphanPayment } = await import("@/lib/payment-orphan");
    recordOrphanPayment({
      gateway: "PHONEPE_DQR",
      reason: "tournament-team-not-found",
      userId: "unknown",
      amountRupees: Math.round((amountPaise ?? 0) / 100),
      phonePeMerchantTxnId: transactionId,
      path: "/api/phonepe/dqr/tournament",
    });
    return { mismatch: true };
  }
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

// ── Squad management (post-registration) ────────────────────────────
// Registration only needs the captain; the squad is built afterwards —
// by the captain (web page / app "Your Team" card) or by an admin.

/** The signed-in user's live team in a tournament, with its squad.
 *  Powers the web Your-Team card and /api/tournaments/my-team (app). */
export async function getMyTournamentTeam(tournamentId: string, userId: string) {
  const team = await db.tournamentTeam.findFirst({
    where: {
      tournamentId,
      captainUserId: userId,
      status: { in: ["CONFIRMED", "PENDING_PAYMENT", "WAITLISTED"] },
    },
    select: {
      id: true,
      name: true,
      status: true,
      color: true,
      logoUrl: true,
      dueAmount: true,
      preferredSlotIds: true,
      tournament: {
        select: {
          status: true,
          membersPerTeamMax: true,
          scheduleApprovedAt: true,
          slots: {
            orderBy: [{ date: "asc" }, { startHour: "asc" }],
            select: { id: true, date: true, startHour: true, endHour: true, label: true },
          },
        },
      },
      members: {
        orderBy: [{ isCaptain: "desc" }, { order: "asc" }],
        select: {
          id: true,
          name: true,
          phone: true,
          isCaptain: true,
          _count: { select: { playerStats: true, matchEvents: true, potmMatches: true } },
        },
      },
    },
  });
  if (!team) return null;
  return {
    id: team.id,
    name: team.name,
    status: team.status,
    color: team.color,
    logoUrl: team.logoUrl,
    dueAmount: team.dueAmount,
    maxMembers: team.tournament.membersPerTeamMax,
    canEditSquad: !["COMPLETED", "CANCELLED"].includes(team.tournament.status),
    // Slot picks + the windows to pick from. Locked once the schedule
    // is approved — the fixtures are built on these answers.
    preferredSlotIds: team.preferredSlotIds,
    slotsLocked: !!team.tournament.scheduleApprovedAt,
    matchSlots: team.tournament.slots.map((x) => ({
      id: x.id,
      date: x.date.toISOString(),
      startHour: x.startHour,
      endHour: x.endHour,
      label: x.label,
    })),
    members: team.members.map((m) => ({
      id: m.id,
      name: m.name,
      phone: m.phone,
      isCaptain: m.isCaptain,
      // Locked = has recorded stats/events — renaming is fine, removal isn't.
      locked: m._count.playerStats + m._count.matchEvents + m._count.potmMatches > 0,
    })),
  };
}

/** Replace a team's squad with `names`, PRESERVING members whose names are
 *  kept (case-insensitive) so their recorded stats/events survive. Members
 *  with recorded stats can't be dropped. Shared by the captain editor
 *  (web + app) and both admin roster editors. */
/** One squad row as submitted by a captain or an admin. */
export interface SquadMemberInput {
  name: string;
  /** Optional — squads get built before every number is known. */
  phone?: string | null;
}

/**
 * Replace a team's squad with `membersInput`, preserving identity (and
 * therefore recorded stats) for players whose NAME is unchanged.
 *
 * Accepts either bare names (legacy callers) or {name, phone} rows.
 */
export async function reconcileTeamSquad(
  teamId: string,
  namesInput: (string | SquadMemberInput)[],
  maxMembers: number
): Promise<{ ok: boolean; error?: string }> {
  const seen = new Set<string>();
  const names: string[] = [];
  const phoneByKey = new Map<string, string | null>();
  for (const raw of namesInput) {
    const row: SquadMemberInput =
      typeof raw === "string" ? { name: raw } : raw;
    const name = String(row.name ?? "").trim().slice(0, 60);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    // A bare-string row (or an omitted `phone`) means "this caller doesn't
    // manage phones" — the app's older squad editor, say. Leave whatever is
    // stored alone rather than blanking a number someone else entered.
    // Passing an explicit empty string still clears it.
    if (typeof raw !== "string" && row.phone !== undefined) {
      // Keep only digits/+ so a pasted "+91 98765 43210" stores cleanly.
      const phone = String(row.phone ?? "").replace(/[^\d+]/g, "").slice(0, 15);
      phoneByKey.set(key, phone || null);
    }
  }
  if (names.length === 0) return { ok: false, error: "Squad needs at least one player" };
  if (names.length > maxMembers) {
    return { ok: false, error: `Squad can have at most ${maxMembers} players` };
  }

  const existing = await db.tournamentTeamMember.findMany({
    where: { teamId },
    select: {
      id: true,
      name: true,
      isCaptain: true,
      _count: { select: { playerStats: true, matchEvents: true, potmMatches: true } },
    },
  });
  const byKey = new Map(existing.map((m) => [m.name.toLowerCase(), m]));
  const keepKeys = new Set(names.map((n) => n.toLowerCase()));

  const removed = existing.filter((m) => !keepKeys.has(m.name.toLowerCase()));
  const blocked = removed.find(
    (m) => m._count.playerStats + m._count.matchEvents + m._count.potmMatches > 0
  );
  if (blocked) {
    return { ok: false, error: `"${blocked.name}" has recorded stats and can't be removed` };
  }

  await db.$transaction(async (tx) => {
    if (removed.length > 0) {
      await tx.tournamentTeamMember.deleteMany({
        where: { id: { in: removed.map((m) => m.id) } },
      });
    }
    // The captain badge stays with whoever holds it; if they were dropped
    // (stat-free) it falls to player 1.
    const captainStays = existing.some((m) => m.isCaptain && keepKeys.has(m.name.toLowerCase()));
    for (let i = 0; i < names.length; i++) {
      const match = byKey.get(names[i].toLowerCase());
      if (match) {
        await tx.tournamentTeamMember.update({
          where: { id: match.id },
          data: {
            name: names[i],
            ...(phoneByKey.has(names[i].toLowerCase())
              ? { phone: phoneByKey.get(names[i].toLowerCase()) ?? null }
              : {}),
            order: i,
            isCaptain: captainStays ? match.isCaptain : i === 0,
          },
        });
      } else {
        await tx.tournamentTeamMember.create({
          data: {
            teamId,
            name: names[i],
            phone: phoneByKey.get(names[i].toLowerCase()) ?? null,
            order: i,
            isCaptain: captainStays ? false : i === 0,
          },
        });
      }
    }
  });
  return { ok: true };
}

/** Captain-side squad update (unified web + app route). */
export async function updateMyTeamSquad(
  teamId: string,
  userId: string,
  names: (string | SquadMemberInput)[]
): Promise<{ ok: boolean; error?: string }> {
  const team = await db.tournamentTeam.findUnique({
    where: { id: teamId },
    select: {
      captainUserId: true,
      status: true,
      tournament: { select: { status: true, membersPerTeamMax: true } },
    },
  });
  if (!team || team.captainUserId !== userId) return { ok: false, error: "Team not found" };
  if (!["CONFIRMED", "PENDING_PAYMENT", "WAITLISTED"].includes(team.status)) {
    return { ok: false, error: "This team is no longer active" };
  }
  if (["COMPLETED", "CANCELLED"].includes(team.tournament.status)) {
    return { ok: false, error: "The tournament has ended — the squad is locked" };
  }
  return reconcileTeamSquad(teamId, names, team.tournament.membersPerTeamMax);
}

/**
 * Captain sets which pre-decided windows their team can play.
 *
 * Callable during registration and afterwards — a captain whose
 * availability changes before the draw is generated should be able to
 * say so. Locked once the admin has approved a schedule, because the
 * fixtures are already built on these answers.
 */
export async function setTeamSlotPreferences(args: {
  teamId: string;
  userId: string;
  slotIds: string[];
}): Promise<{ ok: boolean; error?: string }> {
  const team = await db.tournamentTeam.findUnique({
    where: { id: args.teamId },
    select: {
      id: true,
      captainUserId: true,
      tournamentId: true,
      tournament: { select: { scheduleApprovedAt: true } },
    },
  });
  if (!team) return { ok: false, error: "Team not found" };
  if (team.captainUserId !== args.userId) {
    return { ok: false, error: "Only the team captain can set preferences" };
  }
  if (team.tournament.scheduleApprovedAt) {
    return {
      ok: false,
      error: "The schedule is already published — contact the venue to change slots",
    };
  }
  const valid = await filterValidSlotKeys(team.tournamentId, args.slotIds);
  await db.tournamentTeam.update({
    where: { id: team.id },
    data: { preferredSlotIds: valid },
  });
  return { ok: true };
}

/**
 * Keep only the hour keys (`<slotId>#<startHour>`) whose window belongs to
 * THIS tournament and whose hour actually falls inside that window.
 * Anything else is dropped, not trusted.
 *
 * Shared by the captain's own save and the admin's — an admin entering a
 * team's availability over the phone must land the same keys the draw
 * generator reads, or the team quietly becomes unschedulable.
 */
export async function filterValidSlotKeys(
  tournamentId: string,
  keys: string[],
): Promise<string[]> {
  const windows = await db.tournamentSlot.findMany({
    where: { tournamentId },
    select: { id: true, startHour: true, endHour: true },
  });
  const byId = new Map(windows.map((w) => [w.id, w]));
  return Array.from(
    new Set(
      keys.filter((key) => {
        const [slotId, rawHour] = key.split("#");
        const w = byId.get(slotId);
        if (!w) return false;
        const hour = Number(rawHour);
        return Number.isInteger(hour) && hour >= w.startHour && hour < w.endHour;
      }),
    ),
  );
}
