"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  createSlotHold,
  releaseSlotHold,
  getValidHold,
} from "@/lib/slot-hold";
import { getSlotPricesForDate } from "@/lib/pricing";
import { getTodayIST, getCurrentHourIST } from "@/lib/ist-date";
import {
  sendBookingConfirmation,
  notifyAdminPendingBooking,
  notifyAdminBookingConfirmed,
} from "@/lib/notifications";
import { createRazorpayOrder, verifyRazorpaySignature } from "@/lib/razorpay";
import { validateCoupon } from "@/actions/coupon-validation";
import { previewRedemption, commitRedeemInTx } from "@/lib/rewards/redeem";
import { getRewardConfig, pointsToPaise } from "@/lib/rewards/config";
import { Prisma } from "@prisma/client";

const lockSlotsSchema = z.object({
  courtConfigId: z.string().min(1),
  date: z.string().min(1),
  hours: z.array(z.number().int().min(5).max(24)).min(1),
});

export interface HoldState {
  success: boolean;
  error?: string;
  holdId?: string;
  conflicts?: number[];
}

export interface BookingState {
  success: boolean;
  error?: string;
  bookingId?: string;
  conflicts?: number[];
}

// How long to keep the hold alive during an in-flight payment attempt.
// Gives user time to complete the payment flow on a gateway.
const PAYMENT_ATTEMPT_TTL_MINUTES = 15;

// Reserve slots transiently. Creates a SlotHold; does NOT create a Booking.
// The Booking is only created when the user commits to a payment method.
export async function lockSlots(
  _prevState: HoldState,
  formData: FormData
): Promise<HoldState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Please login to book" };
  }

  let parsedHours: number[];
  try {
    parsedHours = JSON.parse(formData.get("hours") as string) as number[];
  } catch {
    return { success: false, error: "Invalid booking data" };
  }

  const raw = {
    courtConfigId: formData.get("courtConfigId") as string,
    date: formData.get("date") as string,
    hours: parsedHours,
  };

  const parsed = lockSlotsSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: "Invalid booking data" };
  }

  const { courtConfigId, date, hours } = parsed.data;
  const bookingDate = new Date(date);

  // Reject bookings on past dates or past hours of today. This is the
  // authoritative server-side guard that catches stale clients which have
  // the slot-selection page open from a previous day.
  const todayIST = getTodayIST();
  if (date < todayIST) {
    return {
      success: false,
      error:
        "This date has already passed. Please refresh the page and try again.",
    };
  }
  if (date === todayIST) {
    const currentHour = getCurrentHourIST();
    const pastHours = hours.filter((h) => h <= currentHour);
    if (pastHours.length > 0) {
      return {
        success: false,
        error:
          "Some selected slots have already started. Please refresh the page and try again.",
        conflicts: pastHours,
      };
    }
  }

  const allPrices = await getSlotPricesForDate(courtConfigId, bookingDate);
  const slotPrices = hours.map((hour) => {
    const priceData = allPrices.find((p) => p.hour === hour);
    return { hour, price: priceData?.price ?? 0 };
  });

  const result = await createSlotHold(
    session.user.id,
    courtConfigId,
    bookingDate,
    hours,
    slotPrices
  );

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      conflicts: result.conflicts,
    };
  }

  return { success: true, holdId: result.holdId };
}

// Release (delete) a transient hold. No-op if already expired/deleted.
export async function cancelHold(holdId: string): Promise<HoldState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  const released = await releaseSlotHold(holdId, session.user.id);
  return { success: released };
}

// Persist a validated coupon onto the SlotHold so that createBookingFromHold
// can record the discount on Booking and create a CouponUsage row when the
// booking lands. Call after validateCoupon() returns valid.
// Returns the discount amount that was persisted, or null on failure.
export async function applyCouponToHold(
  holdId: string,
  code: string
): Promise<{ success: boolean; discountAmount?: number; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  const hold = await getValidHold(holdId, session.user.id);
  if (!hold) {
    return { success: false, error: "Hold not found or expired" };
  }

  const result = await validateCoupon(code, {
    scope: "SPORTS",
    amount: hold.totalAmount,
    userId: session.user.id,
    sport: hold.courtConfig.sport,
  });

  if (!result.valid || !result.couponId || !result.discountAmount) {
    return { success: false, error: result.error ?? "Invalid coupon" };
  }

  // Reset any points-redemption pick — the 20%-of-bill cap is
  // computed off the post-coupon bill, so a freshly-applied coupon
  // would invalidate the previous slider position. Customer re-picks
  // points after the coupon lands; the slider UI auto-refetches the
  // preview when the hold mutates.
  await db.slotHold.update({
    where: { id: holdId },
    data: {
      couponId: result.couponId,
      couponCode: code.toUpperCase().trim(),
      discountAmount: result.discountAmount,
      pointsToRedeem: null,
      pointsRedeemPaiseSaved: null,
    },
  });

  return { success: true, discountAmount: result.discountAmount };
}

// Clear any coupon previously applied to this hold — used when the user
// removes the discount in checkout before paying.
export async function clearCouponFromHold(
  holdId: string
): Promise<{ success: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false };

  const hold = await getValidHold(holdId, session.user.id);
  if (!hold) return { success: false };

  // Same reset as applyCouponToHold — clearing the coupon also
  // changes the cap base, so we force a fresh redemption pick.
  await db.slotHold.update({
    where: { id: holdId },
    data: {
      couponId: null,
      couponCode: null,
      discountAmount: null,
      pointsToRedeem: null,
      pointsRedeemPaiseSaved: null,
    },
  });
  return { success: true };
}

// ─── Equipment selection (carrier on the hold, like coupon/points) ──

export interface ApplyEquipmentResult {
  success: boolean;
  /** Sum of priceEach × quantity across selected items, in PAISE */
  totalPaise?: number;
  error?: string;
}

/**
 * Persist the customer's equipment-rental picks on the SlotHold.
 * Stored as a Json snapshot so admin-side price edits between
 * checkout and commit don't change what the customer agreed to.
 *
 * Pass an empty array to clear the selection. Server re-prices
 * every item against the live Equipment row so the client can't
 * fabricate cheaper rentals.
 */
export async function applyEquipmentSelectionToHold(
  holdId: string,
  picks: Array<{ equipmentId: string; quantity: number }>,
): Promise<ApplyEquipmentResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  const hold = await getValidHold(holdId, session.user.id);
  if (!hold) {
    return { success: false, error: "Hold not found or expired" };
  }

  if (picks.length === 0) {
    await db.slotHold.update({
      where: { id: holdId },
      data: {
        // Prisma typings require the explicit DbNull sentinel for a
        // nullable Json column reset; plain `null` is rejected.
        equipmentSelection: Prisma.DbNull,
        equipmentTotalAmount: null,
      },
    });
    return { success: true, totalPaise: 0 };
  }

  // Validate quantity bounds and dedupe by equipmentId.
  const byId = new Map<string, number>();
  for (const p of picks) {
    if (!p.equipmentId || !Number.isInteger(p.quantity) || p.quantity <= 0) {
      return { success: false, error: "Invalid equipment selection" };
    }
    byId.set(p.equipmentId, (byId.get(p.equipmentId) ?? 0) + p.quantity);
  }

  // Fetch each item to re-derive its current price + label.
  const items = await db.equipment.findMany({
    where: {
      id: { in: Array.from(byId.keys()) },
      isActive: true,
      isCustomerSelectable: true,
    },
  });
  if (items.length !== byId.size) {
    return { success: false, error: "One of those items is no longer available" };
  }

  const snapshot = items.map((eq) => {
    const quantity = byId.get(eq.id) ?? 0;
    const totalPrice = eq.pricePerHour * quantity; // paise
    return {
      equipmentId: eq.id,
      name: eq.name,
      quantity,
      priceEach: eq.pricePerHour,
      totalPrice,
    };
  });
  const totalPaise = snapshot.reduce((sum, e) => sum + e.totalPrice, 0);
  // Persist as ₹ on the hold (existing fields like discountAmount use
  // rupees end-to-end) — convert paise → rupees with round to avoid
  // fractional ₹ leaking into the booking total.
  const totalRupees = Math.round(totalPaise / 100);

  await db.slotHold.update({
    where: { id: holdId },
    data: {
      equipmentSelection: snapshot as unknown as Prisma.InputJsonValue,
      equipmentTotalAmount: totalRupees,
    },
  });

  return { success: true, totalPaise };
}

// ─── Momentum Points redemption (same carrier pattern as the coupon) ──

export interface ApplyPointsResult {
  success: boolean;
  pointsToRedeem?: number;
  paiseSaved?: number;
  error?: string;
}

/**
 * Persist the user's points redemption pick on the SlotHold.
 * Validates via previewRedemption against the POST-coupon bill so the
 * 20%-of-bill cap is computed off the correct base.
 *
 * Idempotent: re-calling with a new value overwrites the previous pick.
 */
export async function applyPointsRedemptionToHold(
  holdId: string,
  points: number,
): Promise<ApplyPointsResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  const hold = await getValidHold(holdId, session.user.id);
  if (!hold) {
    return { success: false, error: "Hold not found or expired" };
  }
  if (!Number.isInteger(points) || points <= 0) {
    return { success: false, error: "Points must be a positive integer" };
  }

  const cfg = await getRewardConfig();
  // Cap is computed off the bill the customer would actually pay
  // (post-coupon) so a stacked coupon doesn't artificially inflate
  // the redemption ceiling.
  const couponDiscount =
    hold.couponId && hold.discountAmount && hold.discountAmount > 0
      ? hold.discountAmount
      : 0;
  const postCouponRupees = Math.max(0, hold.totalAmount - couponDiscount);
  const billPaise = postCouponRupees * 100;

  const preview = await previewRedemption({
    userId: session.user.id,
    billPaise,
  });
  if (preview.blockedReason) {
    return { success: false, error: preview.blockedReason };
  }
  if (points > preview.maxPoints) {
    return {
      success: false,
      error: `Max ${preview.maxPoints} points allowed on this bill`,
    };
  }
  if (points < cfg.minPointsToRedeem) {
    return {
      success: false,
      error: `Need at least ${cfg.minPointsToRedeem} points`,
    };
  }

  const paiseSaved = pointsToPaise(points, cfg);
  await db.slotHold.update({
    where: { id: holdId },
    data: {
      pointsToRedeem: points,
      pointsRedeemPaiseSaved: paiseSaved,
    },
  });

  return { success: true, pointsToRedeem: points, paiseSaved };
}

export async function clearPointsRedemptionFromHold(
  holdId: string,
): Promise<{ success: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false };

  const hold = await getValidHold(holdId, session.user.id);
  if (!hold) return { success: false };

  await db.slotHold.update({
    where: { id: holdId },
    data: {
      pointsToRedeem: null,
      pointsRedeemPaiseSaved: null,
    },
  });
  return { success: true };
}

// Helper: extends a hold's expiry once payment has been initiated.
// Ensures the hold survives long enough for the payment gateway round-trip.
async function extendHoldForPayment(
  holdId: string,
  data: Prisma.SlotHoldUpdateInput
) {
  const newExpiry = new Date(
    Date.now() + PAYMENT_ATTEMPT_TTL_MINUTES * 60 * 1000
  );
  await db.slotHold.update({
    where: { id: holdId },
    data: {
      ...data,
      paymentInitiatedAt: new Date(),
      expiresAt: newExpiry,
    },
  });
}

export interface RazorpayInitState {
  success: boolean;
  error?: string;
  razorpayOrderId?: string;
  razorpayKeyId?: string;
  amount?: number;
  holdId?: string;
}

// Online payment via Razorpay — create gateway order, attach to hold, extend hold TTL.
// Booking is NOT created here; it's created atomically on verify success.
export async function initiateRazorpayPayment(
  holdId: string,
  overrideAmount?: number
): Promise<RazorpayInitState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  const hold = await getValidHold(holdId, session.user.id);
  if (!hold) {
    return { success: false, error: "Hold not found or expired" };
  }

  const amount =
    overrideAmount && overrideAmount > 0 ? overrideAmount : hold.totalAmount;

  try {
    const order = await createRazorpayOrder(amount, holdId);

    await extendHoldForPayment(holdId, {
      razorpayOrderId: order.id,
      paymentMethod: "RAZORPAY",
      paymentAmount: amount,
    });

    return {
      success: true,
      razorpayOrderId: order.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
      amount,
      holdId,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to create payment",
    };
  }
}

// Razorpay success handler — verifies signature, atomically creates
// Booking(CONFIRMED) + Payment(COMPLETED), and deletes the SlotHold.
export async function confirmRazorpayPayment(
  holdId: string,
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string
): Promise<BookingState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  const hold = await db.slotHold.findUnique({ where: { id: holdId } });
  if (!hold || hold.userId !== session.user.id) {
    return { success: false, error: "Hold not found" };
  }
  if (hold.razorpayOrderId !== razorpayOrderId) {
    return { success: false, error: "Order mismatch" };
  }

  const isValid = verifyRazorpaySignature(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature
  );
  if (!isValid) {
    return { success: false, error: "Payment signature verification failed" };
  }

  const bookingId = await createBookingFromHold(holdId, {
    method: "RAZORPAY",
    status: "COMPLETED",
    amount: hold.paymentAmount ?? hold.totalAmount,
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    confirmedAt: new Date(),
  }, "CONFIRMED");

  if (!bookingId) {
    return { success: false, error: "Failed to create booking" };
  }

  sendBookingConfirmation(bookingId).catch((err) => console.error("Notification dispatch failed:", err));
  notifyAdminBookingConfirmed(bookingId).catch((err) => console.error("Notification dispatch failed:", err));

  return { success: true, bookingId };
}

// UPI QR: user clicks "I've completed the payment".
// Atomically creates Booking(PENDING) + Payment(PENDING, UPI_QR), deletes Hold.
// Admin verifies WhatsApp screenshot to move Booking -> CONFIRMED.
export async function selectUpiPayment(
  holdId: string,
  overrideAmount?: number
): Promise<BookingState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  const hold = await getValidHold(holdId, session.user.id);
  if (!hold) {
    return { success: false, error: "Hold not found or expired" };
  }

  const amount =
    overrideAmount && overrideAmount > 0 ? overrideAmount : hold.totalAmount;

  const bookingId = await createBookingFromHold(holdId, {
    method: "UPI_QR",
    status: "PENDING",
    amount,
  }, "PENDING");

  if (!bookingId) {
    return { success: false, error: "Failed to create booking" };
  }

  notifyAdminPendingBooking(bookingId).catch(console.error);

  return { success: true, bookingId };
}

// Cash: user opts to pay at the venue (or via advance UPI).
// Creates Booking(PENDING) + Payment(PENDING, CASH). Admin confirms on arrival.
//
// When isAdvance is true (the "Pay 50% Now, 50% at Venue" option paid via
// UPI QR), overrideAmount is the half the customer paid via QR. The server
// records:
//   - Payment.amount = overrideAmount (what was actually paid online)
//   - Payment.isPartialPayment = true
//   - Payment.advanceAmount = overrideAmount
//   - Payment.remainingAmount = effectiveTotal - overrideAmount
//     (effectiveTotal = hold.totalAmount minus any coupon applied on the
//     hold — using pre-discount here makes the venue collect the discount
//     back, e.g. ₹1,050 instead of ₹950 when FLAT100 trimmed ₹2,000 → ₹1,900)
// so the booking confirmation and admin views correctly show the advance
// breakdown instead of "full payment due".
export async function selectCashPayment(
  holdId: string,
  overrideAmount?: number,
  options?: { isAdvance?: boolean }
): Promise<BookingState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  const hold = await getValidHold(holdId, session.user.id);
  if (!hold) {
    return { success: false, error: "Hold not found or expired" };
  }

  const amount =
    overrideAmount && overrideAmount > 0 ? overrideAmount : hold.totalAmount;
  const isAdvance = !!options?.isAdvance;
  // effectiveTotal is POST-discount. `amount` is the advance the customer
  // paid via UPI QR (already post-discount via overrideAmount from the
  // checkout client). Subtracting the advance from pre-discount hold.total
  // would make the venue collect the coupon back.
  const appliedDiscount =
    hold.couponId && hold.discountAmount && hold.discountAmount > 0
      ? hold.discountAmount
      : 0;
  const effectiveTotal = hold.totalAmount - appliedDiscount;
  const advanceAmount = isAdvance ? amount : undefined;
  const remainingAmount = isAdvance
    ? Math.max(effectiveTotal - amount, 0)
    : undefined;

  const bookingId = await createBookingFromHold(holdId, {
    // UPI-QR advance: customer paid the advance via the QR flow, so record
    // UPI_QR as the method. confirmUpiPayment later flips PENDING -> PARTIAL
    // once admin verifies the UTR screenshot. The venue-side cash collection
    // shows up in remainderMethod when markRemainderCollected runs.
    method: isAdvance ? "UPI_QR" : "CASH",
    status: "PENDING",
    amount,
    isPartialPayment: isAdvance,
    advanceAmount,
    remainingAmount,
  }, "PENDING");

  if (!bookingId) {
    return { success: false, error: "Failed to create booking" };
  }

  notifyAdminPendingBooking(bookingId).catch(console.error);

  return { success: true, bookingId };
}

// ────────────────────────────────────────────────────────────────────────────
// Shared helper: atomically create a Booking + Payment from a valid SlotHold
// and delete the hold. Exported so API routes (PhonePe/Razorpay callbacks)
// can reuse it.
// ────────────────────────────────────────────────────────────────────────────

type PaymentRecord = {
  method: "RAZORPAY" | "PHONEPE" | "UPI_QR" | "CASH" | "FREE";
  status: "PENDING" | "PARTIAL" | "COMPLETED" | "FAILED" | "REFUNDED";
  amount: number;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  phonePeMerchantTxnId?: string;
  phonePeTransactionId?: string;
  confirmedAt?: Date;
  confirmedBy?: string;
  isPartialPayment?: boolean;
  advanceAmount?: number;
  remainingAmount?: number;
};

/**
 * Atomically: consume a SlotHold and create a Booking + Payment.
 * Returns the new bookingId, or null if the hold has already been consumed.
 *
 * Idempotent: if the hold is gone but a Booking already exists with the
 * matching gateway reference, returns that bookingId (prevents double-booking
 * when gateway callbacks fire multiple times).
 */
/** Origin of the booking — populates Booking.platform. Defaults to "web"
 *  when callers omit it (every server-action call site we control runs
 *  in the web app). Mobile API routes pass the value derived from the
 *  request's `X-Platform` header so we can split funnel analytics. */
export type BookingPlatform = "web" | "android" | "ios";

export async function createBookingFromHold(
  holdId: string,
  payment: PaymentRecord,
  bookingStatus: "PENDING" | "CONFIRMED",
  platform: BookingPlatform = "web"
): Promise<string | null> {
  // Idempotency: if a prior attempt already consumed this hold and created a
  // Booking, find the matching booking by gateway reference and return it.
  if (payment.razorpayPaymentId) {
    const existing = await db.payment.findFirst({
      where: { razorpayPaymentId: payment.razorpayPaymentId },
    });
    if (existing) return existing.bookingId;
  }
  if (payment.phonePeMerchantTxnId) {
    const existing = await db.payment.findFirst({
      where: { phonePeMerchantTxnId: payment.phonePeMerchantTxnId },
    });
    if (existing) return existing.bookingId;
  }

  const hold = await db.slotHold.findUnique({
    where: { id: holdId },
    include: { courtConfig: { select: { category: true, slotDurationMinutes: true } } },
  });
  if (!hold) return null;

  // slotPrices is a Json blob; the bowling-machine flow stores an
  // extra `minute` key on each entry. Older holds don't have it —
  // default to 0 so the BookingSlot.startMinute fallback is correct.
  const slotPrices = hold.slotPrices as unknown as {
    hour: number;
    minute?: number;
    price: number;
  }[];

  // Derive the per-slot duration once. CourtConfig.slotDurationMinutes
  // is 30 for the bowling-machine court and 60 for everything else.
  const slotDuration = hold.courtConfig.slotDurationMinutes ?? 60;

  // Equipment selection carried on the hold becomes EquipmentRental
  // rows tied to the booking. Snapshot the price the customer
  // agreed to (not the live Equipment.pricePerHour) so admin edits
  // to the catalog mid-checkout don't change the bill.
  const equipmentSelection = (hold.equipmentSelection ?? null) as
    | Array<{
        equipmentId: string;
        name: string;
        quantity: number;
        priceEach: number;
        totalPrice: number;
      }>
    | null;
  const equipmentTotalRupees = hold.equipmentTotalAmount ?? 0;

  // If a coupon was applied on the hold, carry it through to the Booking.
  // originalAmount + discountAmount + (reduced) totalAmount mirror what the
  // legacy DiscountCode path does, so the admin/user detail pages render
  // consistently regardless of which coupon system populated the fields.
  const appliedDiscount =
    hold.couponId && hold.discountAmount && hold.discountAmount > 0
      ? hold.discountAmount
      : 0;

  // Reward redemption stacked on top of any coupon. We bake it INTO
  // `discountAmount` so the existing Booking.discountAmount column
  // continues to mean "total discount off the bill". The per-source
  // breakdown lives in the RewardTransaction ledger (the
  // REDEEMED_BOOKING row references this booking) + the CouponUsage
  // table — both of which are queryable when the admin needs to split
  // "how much was coupon vs how much was points".
  const pointsToRedeem = hold.pointsToRedeem ?? 0;
  const pointsRedeemRupees =
    pointsToRedeem > 0 && hold.pointsRedeemPaiseSaved
      ? Math.floor(hold.pointsRedeemPaiseSaved / 100)
      : 0;
  const combinedDiscount = appliedDiscount + pointsRedeemRupees;
  // Equipment rentals are PLUSed on top — the customer pays the
  // slot total minus discounts PLUS the gear they ticked.
  const effectiveTotal =
    hold.totalAmount - combinedDiscount + equipmentTotalRupees;

  // If we're going to commit a redemption, pre-load the config once so
  // the transaction's path doesn't take a fresh DB hit. The config
  // accessor has its own 1-minute cache so this is essentially free.
  const rewardCfg = pointsToRedeem > 0 ? await getRewardConfig() : null;

  const result = await db.$transaction(
    async (tx) => {
    // Re-fetch inside transaction and lock via delete (deleted row implies someone else consumed it)
    const deleted = await tx.slotHold.deleteMany({
      where: { id: holdId },
    });
    if (deleted.count === 0) return null;

    const booking = await tx.booking.create({
      data: {
        userId: hold.userId,
        courtConfigId: hold.courtConfigId,
        date: hold.date,
        status: bookingStatus,
        totalAmount: effectiveTotal,
        originalAmount:
          combinedDiscount > 0
            ? hold.totalAmount + equipmentTotalRupees
            : null,
        discountAmount: combinedDiscount,
        // Denormalised from the court config so coupon validation /
        // analytics / reports can filter by category without a join.
        category: hold.courtConfig.category,
        equipmentTotalAmount: equipmentTotalRupees,
        platform,
        // Preserve the unified "Half Court" context from the hold so
        // customer-facing views can render a neutral label instead of the
        // concrete LEFT/RIGHT courtConfig label. Admin views keep the
        // concrete label regardless.
        wasBookedAsHalfCourt: hold.wasBookedAsHalfCourt,
        slots: {
          // Each BookingSlot now carries the explicit minute + duration so
          // the booking detail page, reports, and edit flows can render
          // 30-min bowling slots cleanly alongside legacy 60-min cricket
          // ones without re-deriving from courtConfig at query time.
          create: slotPrices.map((s, i) => ({
            startHour: s.hour,
            startMinute: hold.startMinutes[i] ?? s.minute ?? 0,
            durationMinutes: slotDuration,
            price: s.price,
          })),
        },
        payment: {
          create: {
            method: payment.method,
            status: payment.status,
            amount: payment.amount,
            razorpayOrderId: payment.razorpayOrderId,
            razorpayPaymentId: payment.razorpayPaymentId,
            razorpaySignature: payment.razorpaySignature,
            phonePeMerchantTxnId: payment.phonePeMerchantTxnId,
            phonePeTransactionId: payment.phonePeTransactionId,
            confirmedAt: payment.confirmedAt,
            confirmedBy: payment.confirmedBy,
            isPartialPayment: payment.isPartialPayment,
            advanceAmount: payment.advanceAmount,
            remainingAmount: payment.remainingAmount,
          },
        },
      },
    });

      // Equipment rentals — one row per ticked item, snapshotted at
      // the price the customer agreed to (from hold.equipmentSelection)
      // rather than the live Equipment.pricePerHour catalog price.
      // Admin can add MORE rentals later via Phase 8's post-booking
      // editor; the totals there go to Booking.equipmentTotalAmount.
      if (equipmentSelection && equipmentSelection.length > 0) {
        await tx.equipmentRental.createMany({
          data: equipmentSelection.map((e) => ({
            bookingId: booking.id,
            equipmentId: e.equipmentId,
            quantity: e.quantity,
            // EquipmentRental.totalPrice is paise per Phase 1's column
            // convention. The hold stores it as PAISE already
            // (priceEach is the paise per unit; totalPrice the row sum).
            totalPrice: e.totalPrice,
          })),
        });
      }

      // Record the coupon usage + increment its counter so validators honor
      // max-uses/per-user limits on the next booking. Kept inside the same
      // transaction as the Booking insert so either both land or neither.
      if (hold.couponId && appliedDiscount > 0) {
        await tx.couponUsage.create({
          data: {
            couponId: hold.couponId,
            userId: hold.userId,
            bookingId: booking.id,
            discountAmount: appliedDiscount,
          },
        });
        await tx.coupon.update({
          where: { id: hold.couponId },
          data: { usedCount: { increment: 1 } },
        });
      }

      // Commit the points redemption inside the same transaction so a
      // paid booking and its REDEEMED_BOOKING ledger row land atomically.
      // commitRedeemInTx throws if the user's balance dropped below
      // pointsToRedeem between checkout-apply time and now, which rolls
      // back the whole booking — the caller's payment.confirm webhook
      // will see the throw and the customer's payment will be refunded
      // upstream (Razorpay auto-refunds when our verify endpoint 500s).
      let redemptionMeta:
        | { txnId: string; discountPaise: number; bulkRedemption: boolean }
        | null = null;
      if (pointsToRedeem > 0 && rewardCfg) {
        redemptionMeta = await commitRedeemInTx(tx, {
          userId: hold.userId,
          type: "REDEEMED_BOOKING",
          points: pointsToRedeem,
          bookingId: booking.id,
          cafeOrderId: null,
          cfg: {
            pointValuePaise: rewardCfg.pointValuePaise,
            bulkRedemptionPaiseThreshold: rewardCfg.bulkRedemptionPaiseThreshold,
          },
        });
      }

      return { id: booking.id, redemptionMeta };
    },
    // Default 5s is too tight during Neon cold starts — a slow cold-start
    // lookup inside the transaction could silently roll back a successful
    // payment, leaving an orphaned Razorpay charge with no booking row.
    { timeout: 15000 }
  );

  if (!result) return null;

  // Raise the BULK_REDEMPTION alert out-of-band (fire-and-forget). Kept
  // outside the transaction so a slow alert insert doesn't extend the
  // booking commit, and so an alert-insert failure can't roll back the
  // booking + redemption ledger row.
  if (result.redemptionMeta?.bulkRedemption) {
    const meta = result.redemptionMeta;
    void db.rewardAlert.create({
      data: {
        userId: hold.userId,
        kind: "BULK_REDEMPTION",
        severity: "MEDIUM",
        status: "OPEN",
        details: {
          txnId: meta.txnId,
          points: pointsToRedeem,
          paise: meta.discountPaise,
          bookingId: result.id,
        },
      },
    }).catch((err) => {
      console.warn(
        "[rewards] failed to insert BULK_REDEMPTION alert:",
        err instanceof Error ? err.message : err,
      );
    });
  }

  return result.id;
}
