import { db } from "@/lib/db";
import { onlinePayable } from "@/lib/tournament-config";
import { validateCoupon } from "@/actions/coupon-validation";
import { notifyUser } from "@/lib/user-notifications";

/**
 * Coaching camps — a fixed-length programme people register FOR, rather
 * than a slot they book.
 *
 * Money vocabulary is deliberately the tournament module's
 * (feeMode/advancePct, coupons, reward points, waitlist) so the venue's
 * mental model and the reporting stay the same. What a camp does NOT
 * have is pools, fixtures or scoring, so none of that is modelled.
 */

/** Master switch. Off ⇒ every camp route 404s, same as tournaments. */
export async function areCampsEnabled(): Promise<boolean> {
  try {
    const settings = await db.arenaSettings.findFirst({
      select: { campsEnabled: true },
    });
    return settings?.campsEnabled ?? false;
  } catch {
    return false;
  }
}

/** Seats a camp still has. CONFIRMED plus in-flight PENDING_PAYMENT hold
 *  a seat — otherwise two people paying at once oversell the last one. */
export async function campSeatsTaken(campId: string): Promise<number> {
  return db.campRegistration.count({
    where: {
      campId,
      status: { in: ["CONFIRMED", "PENDING_PAYMENT"] },
      archivedAt: null,
    },
  });
}

export interface CampRegistrationInput {
  campId: string;
  userId?: string | null;
  participantName: string;
  participantAge?: number | null;
  guardianName?: string | null;
  phone: string;
  email?: string | null;
  notes?: string | null;
  couponCode?: string | null;
  /** Reward points the registrant wants to burn (rupee value applied). */
  pointsRupees?: number;
  /** Admin-entered walk-ins skip the online payment leg entirely. */
  offline?: { paidAmount: number; method: string } | null;
}

export interface CampRegistrationResult {
  ok: boolean;
  error?: string;
  registrationId?: string;
  /** Rupees to collect online now (0 for FREE or a fully-offline entry). */
  payableNow?: number;
  waitlisted?: boolean;
}

/**
 * Create a registration and price it.
 *
 * Ordering matters: capacity is checked BEFORE any money moves, and the
 * row is written PENDING_PAYMENT so a seat is held while the customer
 * pays. A camp that's full either waitlists (when enabled) or refuses —
 * it never quietly oversells.
 */
export async function registerForCamp(
  input: CampRegistrationInput,
): Promise<CampRegistrationResult> {
  const camp = await db.camp.findUnique({
    where: { id: input.campId },
    select: {
      id: true,
      name: true,
      status: true,
      capacity: true,
      fee: true,
      feeMode: true,
      advancePct: true,
      allowCoupons: true,
      allowRewardPoints: true,
      waitlistEnabled: true,
      regOpenAt: true,
      regCloseAt: true,
      sport: true,
    },
  });
  if (!camp) return { ok: false, error: "Camp not found" };

  const isAdminEntry = !!input.offline;
  if (!isAdminEntry) {
    if (camp.status !== "REGISTRATIONS_OPEN") {
      return { ok: false, error: "Registrations aren't open for this camp" };
    }
    const now = new Date();
    if (camp.regOpenAt && now < camp.regOpenAt) {
      return { ok: false, error: "Registrations haven't opened yet" };
    }
    if (camp.regCloseAt && now > camp.regCloseAt) {
      return { ok: false, error: "Registrations have closed" };
    }
  }

  const name = input.participantName.trim();
  const phone = input.phone.trim();
  if (!name) return { ok: false, error: "Participant name is required" };
  if (!phone) return { ok: false, error: "Phone number is required" };

  // Capacity first — before a rupee is touched.
  const taken = await campSeatsTaken(camp.id);
  const full = taken >= camp.capacity;
  if (full && !camp.waitlistEnabled && !isAdminEntry) {
    return { ok: false, error: "This camp is full" };
  }

  // ── Price it ──
  let discount = 0;
  let couponCode: string | null = null;
  if (input.couponCode && camp.allowCoupons && camp.fee > 0) {
    const verdict = await validateCoupon(input.couponCode, {
      scope: "SPORTS",
      amount: camp.fee,
      sport: camp.sport,
      userId: input.userId ?? undefined,
      platform: "web",
    });
    if (!verdict.valid || !verdict.discountAmount) {
      return { ok: false, error: verdict.error || "Coupon isn't valid here" };
    }
    discount = verdict.discountAmount;
    couponCode = input.couponCode.toUpperCase().trim();
  }

  const pointsRupees =
    camp.allowRewardPoints && camp.fee > 0
      ? Math.max(0, Math.min(input.pointsRupees ?? 0, camp.fee - discount))
      : 0;

  const netFee = Math.max(0, camp.fee - discount - pointsRupees);
  const payableNow = isAdminEntry
    ? 0
    : onlinePayable(netFee, camp.feeMode as "FULL" | "ADVANCE" | "FREE", camp.advancePct);
  const paidNow = isAdminEntry ? Math.max(0, input.offline!.paidAmount) : 0;
  const dueAmount = Math.max(0, netFee - payableNow - paidNow);

  const waitlisted = full;
  const reg = await db.campRegistration.create({
    data: {
      campId: camp.id,
      userId: input.userId ?? null,
      participantName: name,
      participantAge: input.participantAge ?? null,
      guardianName: input.guardianName?.trim() || null,
      phone,
      email: input.email?.trim() || null,
      notes: input.notes?.trim() || null,
      couponCode,
      discount,
      pointsUsed: pointsRupees,
      paidAmount: paidNow,
      dueAmount,
      paymentMethod: isAdminEntry ? input.offline!.method : null,
      // A free camp (or a fully-collected walk-in) is confirmed outright;
      // anything with money still to come online stays PENDING_PAYMENT so
      // the seat is held but not yet earned.
      status: waitlisted
        ? "WAITLISTED"
        : payableNow === 0
          ? "CONFIRMED"
          : "PENDING_PAYMENT",
    },
    select: { id: true, status: true },
  });

  if (reg.status === "CONFIRMED") {
    void notifyCampConfirmed(reg.id);
  }

  return {
    ok: true,
    registrationId: reg.id,
    payableNow: waitlisted ? 0 : payableNow,
    waitlisted,
  };
}

/**
 * Mark a registration paid and confirm it. Idempotent on the
 * registration id: a webhook and a client poll can both land here.
 */
export async function confirmCampPayment(args: {
  registrationId: string;
  paidRupees: number;
  method: string;
  paymentRef?: string | null;
}): Promise<{ ok: boolean; error?: string; already?: boolean }> {
  const reg = await db.campRegistration.findUnique({
    where: { id: args.registrationId },
    select: {
      id: true,
      status: true,
      paidAmount: true,
      dueAmount: true,
      camp: { select: { id: true, name: true, capacity: true } },
    },
  });
  if (!reg) return { ok: false, error: "Registration not found" };
  if (reg.status === "CONFIRMED") return { ok: true, already: true };
  if (!["PENDING_PAYMENT", "WAITLISTED"].includes(reg.status)) {
    return { ok: false, error: `Registration is ${reg.status.toLowerCase()}` };
  }

  // Claim-once: whoever flips the row first wins, the loser no-ops.
  //
  // dueAmount is deliberately NOT touched here. It was computed at
  // registration as (fee − discount − points − onlineLeg), so it already
  // EXCLUDES the amount being confirmed now. Decrementing it again made a
  // ₹5,000 ADVANCE-40% camp show ₹1,000 outstanding instead of ₹3,000 —
  // the venue would have under-collected ₹2,000 per registration.
  // Venue collections go through recordCampPayment, which does decrement.
  const claimed = await db.campRegistration.updateMany({
    where: { id: reg.id, status: { in: ["PENDING_PAYMENT", "WAITLISTED"] } },
    data: {
      status: "CONFIRMED",
      paidAmount: { increment: Math.max(0, args.paidRupees) },
      paymentMethod: args.method,
      paymentRef: args.paymentRef ?? null,
    },
  });
  if (claimed.count === 0) return { ok: true, already: true };

  void notifyCampConfirmed(reg.id);
  return { ok: true };
}

/** Tell the registrant they're in, and the floor team that money landed. */
async function notifyCampConfirmed(registrationId: string): Promise<void> {
  try {
    const reg = await db.campRegistration.findUnique({
      where: { id: registrationId },
      select: {
        userId: true,
        participantName: true,
        paidAmount: true,
        camp: { select: { id: true, name: true } },
      },
    });
    if (!reg) return;

    if (reg.userId) {
      void notifyUser(reg.userId, {
        type: "CAMP_CONFIRMED",
        title: "Camp booked 🏏",
        body: `${reg.participantName} is confirmed for ${reg.camp.name}.`,
        link: `/camps`,
      });
    }
    const { sendToAdmins } = await import("./push");
    void sendToAdmins(
      {
        title: "Camp registration",
        body: `${reg.participantName} joined ${reg.camp.name}${
          reg.paidAmount > 0
            ? ` — ₹${reg.paidAmount.toLocaleString("en-IN")} paid.`
            : "."
        }`,
        data: {
          kind: "admin_camp_registration",
          link: `/admin/camps/${reg.camp.id}`,
        },
      },
      { source: "event" },
    );
  } catch (err) {
    console.error("[camps] confirm notification failed:", err);
  }
}

/** Public camp list for the customer hub — never leaks drafts. */
export async function listPublicCamps() {
  return db.camp.findMany({
    where: {
      status: { in: ["REGISTRATIONS_OPEN", "REGISTRATIONS_CLOSED", "ONGOING"] },
    },
    orderBy: [{ startDate: "asc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      sport: true,
      status: true,
      description: true,
      bannerImageUrl: true,
      startDate: true,
      endDate: true,
      daysOfWeek: true,
      startHour: true,
      endHour: true,
      ageMin: true,
      ageMax: true,
      coachName: true,
      capacity: true,
      fee: true,
      feeMode: true,
      advancePct: true,
      waitlistEnabled: true,
      _count: {
        select: {
          registrations: {
            where: {
              status: { in: ["CONFIRMED", "PENDING_PAYMENT"] },
              archivedAt: null,
            },
          },
        },
      },
    },
  });
}

/** One camp by slug, with live seat count. Null when not publicly visible. */
export async function getPublicCamp(slug: string) {
  const camp = await db.camp.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      sport: true,
      status: true,
      description: true,
      rules: true,
      bannerImageUrl: true,
      startDate: true,
      endDate: true,
      daysOfWeek: true,
      startHour: true,
      endHour: true,
      regOpenAt: true,
      regCloseAt: true,
      ageMin: true,
      ageMax: true,
      coachName: true,
      venueNote: true,
      capacity: true,
      fee: true,
      feeMode: true,
      advancePct: true,
      allowCoupons: true,
      allowRewardPoints: true,
      waitlistEnabled: true,
    },
  });
  if (!camp) return null;
  if (!["REGISTRATIONS_OPEN", "REGISTRATIONS_CLOSED", "ONGOING"].includes(camp.status)) {
    return null;
  }
  const taken = await campSeatsTaken(camp.id);
  return { ...camp, seatsTaken: taken, seatsLeft: Math.max(0, camp.capacity - taken) };
}

/** The signed-in user's camp registrations (newest first). */
export async function listMyCampRegistrations(userId: string) {
  return db.campRegistration.findMany({
    where: { userId, archivedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      participantName: true,
      paidAmount: true,
      dueAmount: true,
      createdAt: true,
      camp: {
        select: {
          slug: true,
          name: true,
          sport: true,
          startDate: true,
          endDate: true,
          startHour: true,
          endHour: true,
          daysOfWeek: true,
        },
      },
    },
  });
}
