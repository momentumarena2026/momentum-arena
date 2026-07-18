"use server";

import { after } from "next/server";
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
import { sportForCourtConfigId } from "@/lib/booking-log-sport";
import { AnalyticsCategory, logWebServerAction } from "@/lib/server-log";
import { previewRedemption, commitRedeemInTx } from "@/lib/rewards/redeem";
import { getRewardConfig, pointsToPaise } from "@/lib/rewards/config";
import { verifyBowlingHoldStillBookable } from "@/lib/bowling-availability";
import { snapshotEquipmentForHold } from "@/lib/equipment";
import { recordOrphanPayment, type OrphanGateway } from "@/lib/payment-orphan";
import { Prisma, BookingCategory, CourtZone } from "@prisma/client";

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
    logWebServerAction("actions/booking.lockSlots", {
      action: "booking.lock",
      category: AnalyticsCategory.BOOKING,
      outcome: "error",
      error: "Please login to book",
    });
    return { success: false, error: "Please login to book" };
  }

  let parsedHours: number[];
  try {
    parsedHours = JSON.parse(formData.get("hours") as string) as number[];
  } catch {
    logWebServerAction("actions/booking.lockSlots", {
      userId: session.user.id,
      action: "booking.lock",
      category: AnalyticsCategory.BOOKING,
      outcome: "error",
      error: "Invalid booking data",
    });
    return { success: false, error: "Invalid booking data" };
  }

  const raw = {
    courtConfigId: formData.get("courtConfigId") as string,
    date: formData.get("date") as string,
    hours: parsedHours,
  };

  const parsed = lockSlotsSchema.safeParse(raw);
  if (!parsed.success) {
    logWebServerAction("actions/booking.lockSlots", {
      userId: session.user.id,
      action: "booking.lock",
      category: AnalyticsCategory.BOOKING,
      outcome: "error",
      metadata: raw,
      error: "Invalid booking data",
    });
    return { success: false, error: "Invalid booking data" };
  }

  const { courtConfigId, date, hours } = parsed.data;
  const resolvedSport = await sportForCourtConfigId(courtConfigId);
  const bookingDate = new Date(date);

  // Reject bookings on past dates or past hours of today. This is the
  // authoritative server-side guard that catches stale clients which have
  // the slot-selection page open from a previous day.
  const todayIST = getTodayIST();
  if (date < todayIST) {
    logWebServerAction("actions/booking.lockSlots", {
      userId: session.user.id,
      action: "booking.lock",
      category: AnalyticsCategory.BOOKING,
      outcome: "error",
      metadata: { courtConfigId, date, hours, sport: resolvedSport },
      error: "Date has already passed",
    });
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
      logWebServerAction("actions/booking.lockSlots", {
        userId: session.user.id,
        action: "booking.lock",
        category: AnalyticsCategory.BOOKING,
        outcome: "error",
        metadata: { courtConfigId, date, hours, conflicts: pastHours, sport: resolvedSport },
        error: "Some selected slots have already started",
      });
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
    logWebServerAction("actions/booking.lockSlots", {
      userId: session.user.id,
      action: "booking.lock",
      category: AnalyticsCategory.BOOKING,
      outcome: "error",
      metadata: {
        courtConfigId,
        date,
        hours,
        conflicts: result.conflicts,
        sport: resolvedSport,
      },
      error: result.error,
    });
    return {
      success: false,
      error: result.error,
      conflicts: result.conflicts,
    };
  }

  logWebServerAction("actions/booking.lockSlots", {
    userId: session.user.id,
    action: "booking.lock",
    category: AnalyticsCategory.BOOKING,
    outcome: "success",
    metadata: {
      holdId: result.holdId,
      courtConfigId,
      date,
      hours,
      slotCount: hours.length,
      sport: resolvedSport,
    },
  });

  return { success: true, holdId: result.holdId };
}

// Release (delete) a transient hold. No-op if already expired/deleted.
export async function cancelHold(holdId: string): Promise<HoldState> {
  const session = await auth();
  if (!session?.user?.id) {
    logWebServerAction("actions/booking.cancelHold", {
      action: "booking.release_hold",
      category: AnalyticsCategory.BOOKING,
      outcome: "error",
      metadata: { holdId },
      error: "Not authenticated",
    });
    return { success: false, error: "Not authenticated" };
  }

  const hold = await getValidHold(holdId, session.user.id);
  const sport = hold?.courtConfig.sport ?? null;
  const released = await releaseSlotHold(holdId, session.user.id);
  logWebServerAction("actions/booking.cancelHold", {
    userId: session.user.id,
    action: "booking.release_hold",
    category: AnalyticsCategory.BOOKING,
    outcome: released ? "success" : "error",
    metadata: { holdId, released, sport },
    error: released ? undefined : "Hold not found or already released",
  });
  return { success: released };
}

// Persist a validated coupon onto the SlotHold so that createBookingFromHold
// can record the discount on Booking and create a CouponUsage row when the
// booking lands. Call after validateCoupon() returns valid.
// Returns the discount amount that was persisted, or null on failure.
export async function applyCouponToHold(
  holdId: string,
  code: string,
  // Platform the coupon is being redeemed from — drives Coupon.validPlatforms
  // and the FIRST_APP_BOOKING condition. Web callers omit it (defaults "web");
  // the mobile apply-coupon route passes the device platform.
  platform: BookingPlatform = "web"
): Promise<{ success: boolean; discountAmount?: number; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    logWebServerAction("actions/booking.applyCouponToHold", {
      action: "booking.apply_coupon",
      category: AnalyticsCategory.BOOKING,
      outcome: "error",
      metadata: { holdId, code },
      error: "Not authenticated",
    });
    return { success: false, error: "Not authenticated" };
  }

  const hold = await getValidHold(holdId, session.user.id);
  if (!hold) {
    logWebServerAction("actions/booking.applyCouponToHold", {
      userId: session.user.id,
      action: "booking.apply_coupon",
      category: AnalyticsCategory.BOOKING,
      outcome: "error",
      metadata: { holdId, code },
      error: "Hold not found or expired",
    });
    return { success: false, error: "Hold not found or expired" };
  }

  const result = await validateCoupon(code, {
    scope: "SPORTS",
    amount: hold.totalAmount,
    userId: session.user.id,
    sport: hold.courtConfig.sport,
    // Bowling-machine bookings get rejected here when the coupon
    // has BOWLING_MACHINE in its categoryExclude list — the
    // new-user welcome discount is pre-seeded that way.
    bookingCategory: hold.courtConfig.category,
    platform,
    // Play date — drives BOOKING_DATE event promos (e.g. final-day 25%).
    bookingDate: hold.date,
  });

  if (!result.valid || !result.couponId || !result.discountAmount) {
    logWebServerAction("actions/booking.applyCouponToHold", {
      userId: session.user.id,
      action: "booking.apply_coupon",
      category: AnalyticsCategory.BOOKING,
      outcome: "error",
      metadata: {
        holdId,
        code,
        sport: hold.courtConfig.sport,
        amount: hold.totalAmount,
      },
      error: result.error ?? "Invalid coupon",
    });
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

  logWebServerAction("actions/booking.applyCouponToHold", {
    userId: session.user.id,
    action: "booking.apply_coupon",
    category: AnalyticsCategory.BOOKING,
    outcome: "success",
    metadata: {
      holdId,
      code: code.toUpperCase().trim(),
      discountAmount: result.discountAmount,
      sport: hold.courtConfig.sport,
      amount: hold.totalAmount,
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

  logWebServerAction("actions/booking.clearCouponFromHold", {
    userId: session.user.id,
    action: "booking.clear_coupon",
    category: AnalyticsCategory.BOOKING,
    outcome: "success",
    metadata: { holdId, previousCode: hold.couponCode },
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
  const action =
    picks.length === 0 ? "booking.clear_equipment" : "booking.apply_equipment";

  if (!session?.user?.id) {
    logWebServerAction("actions/booking.applyEquipmentSelectionToHold", {
      action,
      category: AnalyticsCategory.BOOKING,
      outcome: "error",
      metadata: { holdId, pickCount: picks.length },
      error: "Not authenticated",
    });
    return { success: false, error: "Not authenticated" };
  }

  const hold = await getValidHold(holdId, session.user.id);
  if (!hold) {
    logWebServerAction("actions/booking.applyEquipmentSelectionToHold", {
      userId: session.user.id,
      action,
      category: AnalyticsCategory.BOOKING,
      outcome: "error",
      metadata: { holdId, pickCount: picks.length },
      error: "Hold not found or expired",
    });
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
    logWebServerAction("actions/booking.applyEquipmentSelectionToHold", {
      userId: session.user.id,
      action,
      category: AnalyticsCategory.BOOKING,
      outcome: "success",
      metadata: { holdId, pickCount: 0 },
    });
    return { success: true, totalPaise: 0 };
  }

  // Shared with the at-lock-time path on /api/booking/lock — see
  // lib/equipment.ts for the validation + pricing math (price ×
  // quantity × slotCount, with priceEach + name snapshotted at
  // checkout so admin edits don't change the agreed total).
  const snap = await snapshotEquipmentForHold(
    picks,
    Math.max(1, hold.hours.length),
  );
  if (!snap.ok) {
    logWebServerAction("actions/booking.applyEquipmentSelectionToHold", {
      userId: session.user.id,
      action,
      category: AnalyticsCategory.BOOKING,
      outcome: "error",
      metadata: { holdId, pickCount: picks.length },
      error: snap.error,
    });
    return { success: false, error: snap.error };
  }

  await db.slotHold.update({
    where: { id: holdId },
    data: {
      equipmentSelection: snap.result.snapshot as unknown as Prisma.InputJsonValue,
      equipmentTotalAmount: snap.result.totalRupees,
    },
  });

  logWebServerAction("actions/booking.applyEquipmentSelectionToHold", {
    userId: session.user.id,
    action,
    category: AnalyticsCategory.BOOKING,
    outcome: "success",
    metadata: {
      holdId,
      pickCount: picks.length,
      totalPaise: snap.result.totalPaise,
      sport: hold.courtConfig.sport,
    },
  });

  return { success: true, totalPaise: snap.result.totalPaise };
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
    logWebServerAction("actions/booking.applyPointsRedemptionToHold", {
      action: "booking.apply_points",
      category: AnalyticsCategory.BOOKING,
      outcome: "error",
      metadata: { holdId, points },
      error: "Not authenticated",
    });
    return { success: false, error: "Not authenticated" };
  }

  const hold = await getValidHold(holdId, session.user.id);
  if (!hold) {
    logWebServerAction("actions/booking.applyPointsRedemptionToHold", {
      userId: session.user.id,
      action: "booking.apply_points",
      category: AnalyticsCategory.BOOKING,
      outcome: "error",
      metadata: { holdId, points },
      error: "Hold not found or expired",
    });
    return { success: false, error: "Hold not found or expired" };
  }
  const sport = hold.courtConfig.sport;
  if (!Number.isInteger(points) || points <= 0) {
    logWebServerAction("actions/booking.applyPointsRedemptionToHold", {
      userId: session.user.id,
      action: "booking.apply_points",
      category: AnalyticsCategory.BOOKING,
      outcome: "error",
      metadata: { holdId, points, sport },
      error: "Points must be a positive integer",
    });
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
    logWebServerAction("actions/booking.applyPointsRedemptionToHold", {
      userId: session.user.id,
      action: "booking.apply_points",
      category: AnalyticsCategory.BOOKING,
      outcome: "error",
      metadata: { holdId, points, sport },
      error: preview.blockedReason,
    });
    return { success: false, error: preview.blockedReason };
  }
  if (points > preview.maxPoints) {
    const error = `Max ${preview.maxPoints} points allowed on this bill`;
    logWebServerAction("actions/booking.applyPointsRedemptionToHold", {
      userId: session.user.id,
      action: "booking.apply_points",
      category: AnalyticsCategory.BOOKING,
      outcome: "error",
      metadata: { holdId, points, maxPoints: preview.maxPoints, sport },
      error,
    });
    return { success: false, error };
  }
  if (points < cfg.minPointsToRedeem) {
    const error = `Need at least ${cfg.minPointsToRedeem} points`;
    logWebServerAction("actions/booking.applyPointsRedemptionToHold", {
      userId: session.user.id,
      action: "booking.apply_points",
      category: AnalyticsCategory.BOOKING,
      outcome: "error",
      metadata: { holdId, points, minPoints: cfg.minPointsToRedeem, sport },
      error,
    });
    return { success: false, error };
  }

  const paiseSaved = pointsToPaise(points, cfg);
  await db.slotHold.update({
    where: { id: holdId },
    data: {
      pointsToRedeem: points,
      pointsRedeemPaiseSaved: paiseSaved,
    },
  });

  logWebServerAction("actions/booking.applyPointsRedemptionToHold", {
    userId: session.user.id,
    action: "booking.apply_points",
    category: AnalyticsCategory.BOOKING,
    outcome: "success",
    metadata: { holdId, points, paiseSaved, sport },
  });

  return { success: true, pointsToRedeem: points, paiseSaved };
}

export async function clearPointsRedemptionFromHold(
  holdId: string,
): Promise<{ success: boolean }> {
  const session = await auth();
  if (!session?.user?.id) {
    logWebServerAction("actions/booking.clearPointsRedemptionFromHold", {
      action: "booking.clear_points",
      category: AnalyticsCategory.BOOKING,
      outcome: "error",
      metadata: { holdId },
      error: "Not authenticated",
    });
    return { success: false };
  }

  const hold = await getValidHold(holdId, session.user.id);
  if (!hold) {
    logWebServerAction("actions/booking.clearPointsRedemptionFromHold", {
      userId: session.user.id,
      action: "booking.clear_points",
      category: AnalyticsCategory.BOOKING,
      outcome: "error",
      metadata: { holdId },
      error: "Hold not found or expired",
    });
    return { success: false };
  }

  await db.slotHold.update({
    where: { id: holdId },
    data: {
      pointsToRedeem: null,
      pointsRedeemPaiseSaved: null,
    },
  });

  logWebServerAction("actions/booking.clearPointsRedemptionFromHold", {
    userId: session.user.id,
    action: "booking.clear_points",
    category: AnalyticsCategory.BOOKING,
    outcome: "success",
    metadata: { holdId, previousPoints: hold.pointsToRedeem, sport: hold.courtConfig.sport },
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

  after(async () => {
    await Promise.allSettled([
      sendBookingConfirmation(bookingId).catch((err) =>
        console.error("[notify] booking confirmation failed", err),
      ),
      notifyAdminBookingConfirmed(bookingId).catch((err) =>
        console.error("[notify] admin confirmed failed", err),
      ),
    ]);
  });

  return { success: true, bookingId };
}

// UPI QR: user clicks "I've completed the payment".
// Atomically creates Booking(PENDING) + Payment(PENDING, UPI_QR), deletes Hold.
// Admin verifies WhatsApp screenshot to move Booking -> CONFIRMED.

/** Fire-and-forget audit when the customer picks a checkout payment tile. */
export async function logPaymentMethodSelected(
  holdId: string,
  paymentMethod: string,
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const hold = await getValidHold(holdId, session.user.id);
  logWebServerAction("actions/booking.logPaymentMethodSelected", {
    userId: session.user.id,
    action: "payment.select_payment",
    category: AnalyticsCategory.PAYMENT,
    outcome: "success",
    metadata: {
      holdId,
      paymentMethod,
      sport: hold?.courtConfig.sport ?? null,
    },
  });
}

export async function selectUpiPayment(
  holdId: string,
  overrideAmount?: number
): Promise<BookingState> {
  const session = await auth();
  if (!session?.user?.id) {
    logWebServerAction("actions/booking.selectUpiPayment", {
      action: "payment.upi_qr.commit",
      category: AnalyticsCategory.PAYMENT,
      outcome: "error",
      metadata: { holdId },
      error: "Not authenticated",
    });
    return { success: false, error: "Not authenticated" };
  }

  const hold = await getValidHold(holdId, session.user.id);
  if (!hold) {
    logWebServerAction("actions/booking.selectUpiPayment", {
      userId: session.user.id,
      action: "payment.upi_qr.commit",
      category: AnalyticsCategory.PAYMENT,
      outcome: "error",
      metadata: { holdId },
      error: "Hold not found or expired",
    });
    return { success: false, error: "Hold not found or expired" };
  }

  // Bowling-machine re-check (same as cash + razorpay flows).
  const stillOk = await verifyBowlingHoldStillBookable(holdId);
  if (!stillOk.ok) {
    logWebServerAction("actions/booking.selectUpiPayment", {
      userId: session.user.id,
      action: "payment.upi_qr.commit",
      category: AnalyticsCategory.PAYMENT,
      outcome: "error",
      metadata: { holdId, conflicts: stillOk.conflicts },
      error: stillOk.reason,
    });
    return { success: false, error: stillOk.reason };
  }

  const amount =
    overrideAmount && overrideAmount > 0 ? overrideAmount : hold.totalAmount;

  const bookingId = await createBookingFromHold(holdId, {
    method: "UPI_QR",
    status: "PENDING",
    amount,
  }, "PENDING");

  if (!bookingId) {
    logWebServerAction("actions/booking.selectUpiPayment", {
      userId: session.user.id,
      action: "payment.upi_qr.commit",
      category: AnalyticsCategory.PAYMENT,
      outcome: "error",
      metadata: { holdId, amount },
      error: "Failed to create booking",
    });
    return { success: false, error: "Failed to create booking" };
  }

  // Notification dispatch MUST be wrapped in after(). A bare
  // fire-and-forget promise is killed when the serverless function
  // freezes on response, so the SMS/push only went out when it happened
  // to win that race — the cause of admin alerts going missing at random
  // since the static-QR flow shipped.
  after(async () => {
    await notifyAdminPendingBooking(bookingId).catch((err) =>
      console.error("[notify] admin pending booking failed", err),
    );
  });

  logWebServerAction("actions/booking.selectUpiPayment", {
    userId: session.user.id,
    action: "payment.upi_qr.commit",
    category: AnalyticsCategory.PAYMENT,
    outcome: "success",
    metadata: {
      holdId,
      bookingId,
      amount,
      paymentMethod: "upi_qr",
      sport: hold.courtConfig.sport,
    },
  });

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
  const isAdvance = !!options?.isAdvance;
  const action = isAdvance
    ? "payment.cash.advance_commit"
    : "payment.cash.commit";

  const session = await auth();
  if (!session?.user?.id) {
    logWebServerAction("actions/booking.selectCashPayment", {
      action,
      category: AnalyticsCategory.PAYMENT,
      outcome: "error",
      metadata: { holdId, isAdvance },
      error: "Not authenticated",
    });
    return { success: false, error: "Not authenticated" };
  }

  const hold = await getValidHold(holdId, session.user.id);
  if (!hold) {
    logWebServerAction("actions/booking.selectCashPayment", {
      userId: session.user.id,
      action,
      category: AnalyticsCategory.PAYMENT,
      outcome: "error",
      metadata: { holdId, isAdvance },
      error: "Hold not found or expired",
    });
    return { success: false, error: "Hold not found or expired" };
  }

  // Bowling-machine re-check before we touch payment state. See the
  // verifyBowlingHoldStillBookable docblock — catches admin-override
  // turf bookings on the shared zones between lock and checkout.
  const stillOk = await verifyBowlingHoldStillBookable(holdId);
  if (!stillOk.ok) {
    logWebServerAction("actions/booking.selectCashPayment", {
      userId: session.user.id,
      action,
      category: AnalyticsCategory.PAYMENT,
      outcome: "error",
      metadata: { holdId, isAdvance, conflicts: stillOk.conflicts },
      error: stillOk.reason,
    });
    return { success: false, error: stillOk.reason };
  }

  const amount =
    overrideAmount && overrideAmount > 0 ? overrideAmount : hold.totalAmount;
  // effectiveTotal is POST-discount. `amount` is the advance the customer
  // paid via UPI QR (already post-discount via overrideAmount from the
  // checkout client). Subtracting the advance from pre-discount hold.total
  // would make the venue collect the coupon back.
  const appliedDiscount =
    hold.couponId && hold.discountAmount && hold.discountAmount > 0
      ? hold.discountAmount
      : 0;
  // Subtract redeemed points too (mirror the mobile select-payment route),
  // else the venue collects the redeemed value back on the 50% advance flow.
  const pointsRedeemRupees =
    hold.pointsToRedeem && hold.pointsRedeemPaiseSaved
      ? Math.floor(hold.pointsRedeemPaiseSaved / 100)
      : 0;
  const effectiveTotal = hold.totalAmount - appliedDiscount - pointsRedeemRupees;
  const advanceAmount = isAdvance ? amount : undefined;
  const remainingAmount = isAdvance
    ? Math.max(effectiveTotal - amount, 0)
    : undefined;
  const paymentMethod = isAdvance ? "UPI_QR" : "CASH";

  const bookingId = await createBookingFromHold(holdId, {
    // UPI-QR advance: customer paid the advance via the QR flow, so record
    // UPI_QR as the method. confirmUpiPayment later flips PENDING -> PARTIAL
    // once admin verifies the UTR screenshot. The venue-side cash collection
    // shows up in remainderMethod when markRemainderCollected runs.
    method: paymentMethod,
    status: "PENDING",
    amount,
    isPartialPayment: isAdvance,
    advanceAmount,
    remainingAmount,
  }, "PENDING");

  if (!bookingId) {
    logWebServerAction("actions/booking.selectCashPayment", {
      userId: session.user.id,
      action,
      category: AnalyticsCategory.PAYMENT,
      outcome: "error",
      metadata: {
        holdId,
        isAdvance,
        amount,
        advanceAmount,
        remainingAmount,
        paymentMethod,
      },
      error: "Failed to create booking",
    });
    return { success: false, error: "Failed to create booking" };
  }

  // Notification dispatch MUST be wrapped in after(). A bare
  // fire-and-forget promise is killed when the serverless function
  // freezes on response, so the SMS/push only went out when it happened
  // to win that race — the cause of admin alerts going missing at random
  // since the static-QR flow shipped.
  after(async () => {
    await notifyAdminPendingBooking(bookingId).catch((err) =>
      console.error("[notify] admin pending booking failed", err),
    );
  });

  logWebServerAction("actions/booking.selectCashPayment", {
    userId: session.user.id,
    action,
    category: AnalyticsCategory.PAYMENT,
    outcome: "success",
    metadata: {
      holdId,
      bookingId,
      isAdvance,
      amount,
      advanceAmount,
      remainingAmount,
      paymentMethod: isAdvance ? "cash" : paymentMethod,
      method: paymentMethod,
      sport: hold.courtConfig.sport,
    },
  });

  return { success: true, bookingId };
}

// ────────────────────────────────────────────────────────────────────────────
// Shared helper: atomically create a Booking + Payment from a valid SlotHold
// and delete the hold. Exported so API routes (PhonePe/Razorpay callbacks)
// can reuse it.
// ────────────────────────────────────────────────────────────────────────────

type PaymentRecord = {
  method: "RAZORPAY" | "PHONEPE" | "UPI_QR" | "CASH" | "FREE" | "PASS";
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

  let result:
    | {
        id: string;
        redemptionMeta:
          | { txnId: string; discountPaise: number; bulkRedemption: boolean }
          | null;
      }
    | null;
  try {
    result = await db.$transaction(
    async (tx) => {
    // Re-fetch inside transaction and lock via delete (deleted row implies someone else consumed it)
    const deleted = await tx.slotHold.deleteMany({
      where: { id: holdId },
    });
    if (deleted.count === 0) return null;

    // Defense-in-depth re-check for bowling-machine holds: the payment-
    // init endpoints already called verifyBowlingHoldStillBookable, but
    // an admin override could in theory race in between that check and
    // this transaction. Re-verify inside the transaction so a conflict
    // forces a rollback (which restores the hold via Prisma's
    // auto-rollback on throw) instead of double-booking the zones.
    //
    // For non-bowling categories this is skipped — the cricket/football
    // path doesn't have a "rollover" surface and its standard
    // zone-overlap rules already apply at lock time.
    if (hold.courtConfig.category === ("BOWLING_MACHINE" as BookingCategory)) {
      const config = await tx.courtConfig.findUnique({
        where: { id: hold.courtConfigId },
      });
      if (!config) throw new Error("Court config not found");

      const conflictingBookings = await tx.booking.findMany({
        where: {
          date: hold.date,
          status: { in: ["CONFIRMED", "PENDING"] },
          courtConfig: {
            zones: { hasSome: config.zones as CourtZone[] },
          },
        },
        include: { slots: true },
      });
      const requested = new Set(
        hold.hours.map((h, i) => `${h}:${hold.startMinutes[i] ?? 0}`),
      );
      for (const b of conflictingBookings) {
        for (const s of b.slots) {
          if (s.durationMinutes === 30) {
            if (requested.has(`${s.startHour}:${s.startMinute}`)) {
              throw new Error("BOWLING_SLOT_CONFLICT");
            }
          } else {
            if (
              requested.has(`${s.startHour}:0`) ||
              requested.has(`${s.startHour}:30`)
            ) {
              throw new Error("BOWLING_SLOT_CONFLICT");
            }
          }
        }
      }
    } else {
      // Non-bowling: re-verify the slot is still free at commit time.
      // This USED to be guaranteed by the (non-expired) hold, but holds
      // are now retained past expiry as a booking blueprint for late-payment
      // recovery (see lib/slot-hold cleanupExpiredHolds), so the slot could
      // have been re-booked by someone else while this payment was in
      // flight. Without this check a late payment would silently
      // DOUBLE-BOOK the slot. Throwing rolls the transaction back, which
      // restores the hold (the deleteMany above is undone) so the captured
      // payment can still be recovered/refunded by an admin instead of
      // producing a duplicate booking.
      const config = await tx.courtConfig.findUnique({
        where: { id: hold.courtConfigId },
      });
      if (!config) throw new Error("Court config not found");
      const conflictingBookings = await tx.booking.findMany({
        where: {
          date: hold.date,
          status: { in: ["CONFIRMED", "PENDING"] },
          courtConfig: {
            zones: { hasSome: config.zones as CourtZone[] },
          },
        },
        include: { slots: true },
      });
      const requestedHours = new Set(hold.hours);
      for (const b of conflictingBookings) {
        for (const s of b.slots) {
          if (requestedHours.has(s.startHour)) {
            throw new Error("SLOT_CONFLICT");
          }
        }
      }
    }

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
  } catch (err) {
    // A slot-conflict throw (bowling or standard) means the slot was taken
    // by someone else between hold-expiry and this (late) payment. The
    // transaction rolled back, restoring the hold. If real gateway money
    // was captured, record an orphan so an admin refunds it instead of the
    // customer silently losing both the slot and the money. Then return
    // null so callers treat it as "couldn't create" — never a double-book.
    if (err instanceof Error && err.message.includes("SLOT_CONFLICT")) {
      const gateway: OrphanGateway | null = payment.razorpayPaymentId
        ? "RAZORPAY"
        : payment.method === "PHONEPE"
          ? "PHONEPE"
          : payment.phonePeMerchantTxnId
            ? "PHONEPE_DQR"
            : null;
      if (gateway) {
        recordOrphanPayment({
          gateway,
          reason: "slot-taken",
          userId: hold.userId,
          amountRupees: payment.amount,
          razorpayOrderId: payment.razorpayOrderId ?? null,
          razorpayPaymentId: payment.razorpayPaymentId ?? null,
          phonePeMerchantTxnId: payment.phonePeMerchantTxnId ?? null,
          holdId,
        });
      }
      return null;
    }
    throw err;
  }

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
