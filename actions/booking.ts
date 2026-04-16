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
import {
  sendBookingConfirmation,
  notifyAdminPendingBooking,
} from "@/lib/notifications";
import { createRazorpayOrder, verifyRazorpaySignature } from "@/lib/razorpay";
import type { Prisma } from "@prisma/client";

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

  const raw = {
    courtConfigId: formData.get("courtConfigId") as string,
    date: formData.get("date") as string,
    hours: JSON.parse(formData.get("hours") as string) as number[],
  };

  const parsed = lockSlotsSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: "Invalid booking data" };
  }

  const { courtConfigId, date, hours } = parsed.data;
  const bookingDate = new Date(date);

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

  sendBookingConfirmation(bookingId).catch(() => {});

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
export async function selectCashPayment(
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
    method: "CASH",
    status: "PENDING",
    amount,
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
  status: "PENDING" | "COMPLETED" | "FAILED" | "REFUNDED";
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
export async function createBookingFromHold(
  holdId: string,
  payment: PaymentRecord,
  bookingStatus: "PENDING" | "CONFIRMED"
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

  const hold = await db.slotHold.findUnique({ where: { id: holdId } });
  if (!hold) return null;

  const slotPrices = hold.slotPrices as unknown as {
    hour: number;
    price: number;
  }[];

  const result = await db.$transaction(async (tx) => {
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
        totalAmount: hold.totalAmount,
        slots: {
          create: slotPrices.map((s) => ({
            startHour: s.hour,
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

    return booking.id;
  });

  return result;
}
