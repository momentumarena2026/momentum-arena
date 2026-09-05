import { db } from "@/lib/db";
import { RAZORPAY_KEY_ID } from "@/lib/razorpay";
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

/**
 * Has this participant already joined this camp?
 *
 * Decides whether the one-time joining fee applies. Only a CONFIRMED,
 * un-archived registration counts: an abandoned PENDING_PAYMENT attempt
 * is somebody who never joined, and letting it waive the fee would mean
 * a customer could skip it by starting a registration and walking away.
 *
 * Matched on the ACCOUNT or the PHONE, either alone. A family often
 * registers several children from one account, and a walk-in the venue
 * entered at the desk has no account at all — so a person can easily be
 * a returning participant under one identifier and a stranger under the
 * other. Matching on either is the forgiving direction, and forgiving is
 * correct here: charging a joining fee twice is a refund and an argument,
 * while missing one is a few hundred rupees.
 */
export async function hasJoinedCampBefore(
  campId: string,
  who: { userId?: string | null; phone?: string | null },
): Promise<boolean> {
  const phone = (who.phone ?? "").trim();
  const identifiers: { userId?: string; phone?: string }[] = [];
  if (who.userId) identifiers.push({ userId: who.userId });
  if (phone) identifiers.push({ phone });
  if (identifiers.length === 0) return false;

  try {
    const prior = await db.campRegistration.findFirst({
      where: {
        campId,
        status: "CONFIRMED",
        archivedAt: null,
        OR: identifiers,
      },
      select: { id: true },
    });
    return prior != null;
  } catch {
    // Unreadable history is not proof of a first registration. Treat it
    // as a returning participant: the failure then costs the venue a
    // joining fee rather than charging a customer one they do not owe.
    return true;
  }
}

/**
 * What a registration costs, split into its two parts.
 *
 * Pure, so the arithmetic is testable without a database. Coupons and
 * reward points apply to the MONTHLY fee only — that is what they
 * discounted before joining fees existed, and a promotion on a camp's
 * monthly price should not quietly waive the venue's cost of enrolling
 * someone.
 */
export function priceCampRegistration(input: {
  monthlyFee: number;
  registrationFee: number;
  discount: number;
  pointsRupees: number;
  firstTime: boolean;
}): { monthly: number; joining: number; total: number } {
  const monthly = Math.max(0, input.monthlyFee - input.discount - input.pointsRupees);
  const joining = input.firstTime ? Math.max(0, input.registrationFee) : 0;
  return { monthly, joining, total: monthly + joining };
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
      registrationFee: true,
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

  // The joining fee applies only the first time this participant signs
  // up for THIS camp; every renewal is the monthly fee alone.
  const firstTime =
    camp.registrationFee > 0
      ? !(await hasJoinedCampBefore(camp.id, { userId: input.userId, phone }))
      : false;
  const price = priceCampRegistration({
    monthlyFee: camp.fee,
    registrationFee: camp.registrationFee,
    discount,
    pointsRupees,
    firstTime,
  });

  const netFee = price.total;
  // ADVANCE mode splits the MONTHLY fee, and the joining fee is then
  // collected in full up front. Letting an advance percentage apply to it
  // would leave the venue carrying part of an enrolment cost it has
  // already incurred, and would put a one-time charge on a bill the
  // customer expects to be recurring.
  const payableNow = isAdminEntry
    ? 0
    : onlinePayable(price.monthly, camp.feeMode as "FULL" | "ADVANCE" | "FREE", camp.advancePct) +
      price.joining;
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
      registrationFee: price.joining,
      paymentMethod: isAdminEntry ? input.offline!.method : null,
      // A desk walk-in is money in hand right now; an online registration
      // gets its stamp when the payment confirms.
      paidAt: paidNow > 0 ? new Date() : null,
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
      // Cash-basis stamp for analytics / CA.
      paidAt: new Date(),
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
      registrationFee: true,
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
      registrationFee: true,
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


/**
 * Razorpay order for a camp registration.
 *
 * Mirrors createPassOrder: the notes carry what was bought, so the verify
 * route trusts the ORDER rather than the client — otherwise a cheap order
 * could confirm an expensive registration.
 */
export async function createCampOrder(
  registrationId: string,
  userId: string,
  amountRupees: number,
): Promise<{ orderId: string; amount: number }> {
  // The secret is deliberately not exported from lib/razorpay — read it
  // here the same way that module does, so it never crosses a boundary.
  const auth = Buffer.from(
    `${RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET ?? ""}`,
  ).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      amount: Math.round(amountRupees * 100),
      currency: "INR",
      receipt: `camp_${registrationId.slice(-12)}`,
      notes: { type: "CAMP", registrationId, userId },
    }),
  });
  if (!res.ok) {
    throw new Error(`Razorpay camp order failed: ${await res.text()}`);
  }
  const order = (await res.json()) as { id: string };
  return { orderId: order.id, amount: amountRupees };
}

/**
 * Confirm a camp registration from a settled PhonePe DQR transaction.
 *
 * `paymentRef` is the only pointer from a PhonePe txn back to the
 * registration, so a re-initiated QR that overwrote it would orphan the
 * first payment. The suffix match mirrors confirmDqrTournament: the
 * registration id is embedded in the txn id, so a superseded txn still
 * resolves to its row.
 */
export async function confirmDqrCamp(
  transactionId: string,
  providerReferenceId?: string,
  amountPaise?: number,
): Promise<{ registrationId?: string; mismatch?: boolean }> {
  let reg = await db.campRegistration.findFirst({
    where: { paymentRef: transactionId },
    select: { id: true, status: true },
  });

  // Superseded txn: "DQRC_<regIdTail>_<ms>" still names its registration.
  if (!reg) {
    const tail = transactionId.split("_")[1];
    if (tail) {
      reg = await db.campRegistration.findFirst({
        where: { id: { endsWith: tail }, status: "PENDING_PAYMENT" },
        select: { id: true, status: true },
      });
    }
  }
  if (!reg) return { mismatch: true };
  if (reg.status === "CONFIRMED") return { registrationId: reg.id };

  const paid = Math.round((amountPaise ?? 0) / 100);
  const res = await confirmCampPayment({
    registrationId: reg.id,
    paidRupees: paid,
    method: "PHONEPE",
    paymentRef: providerReferenceId ?? transactionId,
  });
  if (!res.ok) return { mismatch: true };
  return { registrationId: reg.id };
}
