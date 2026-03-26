"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createSlotLock, releaseSlotLock } from "@/lib/slot-lock";
import { getSlotPricesForDate } from "@/lib/pricing";
import { sendBookingConfirmation } from "@/lib/notifications";
import { createRazorpayOrder } from "@/lib/razorpay";

const lockSlotsSchema = z.object({
  courtConfigId: z.string().min(1),
  date: z.string().min(1),
  hours: z.array(z.number().int().min(5).max(24)).min(1),
});

export interface BookingState {
  success: boolean;
  error?: string;
  bookingId?: string;
  conflicts?: number[];
}

export async function lockSlots(
  _prevState: BookingState,
  formData: FormData
): Promise<BookingState> {
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

  // Get prices for the selected slots
  const allPrices = await getSlotPricesForDate(courtConfigId, bookingDate);
  const slotPrices = hours.map((hour) => {
    const priceData = allPrices.find((p) => p.hour === hour);
    return { hour, price: priceData?.price ?? 0 };
  });

  const result = await createSlotLock(
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

  return { success: true, bookingId: result.bookingId };
}

export async function cancelLock(bookingId: string): Promise<BookingState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  const released = await releaseSlotLock(bookingId, session.user.id);
  return {
    success: released,
    error: released ? undefined : "Lock not found or already expired",
  };
}

export interface PaymentInitState {
  success: boolean;
  error?: string;
  razorpayOrderId?: string;
  razorpayKeyId?: string;
  amount?: number;
  bookingId?: string;
}

export async function initiateRazorpayPayment(
  bookingId: string
): Promise<PaymentInitState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  const booking = await db.booking.findUnique({
    where: { id: bookingId, userId: session.user.id, status: "LOCKED" },
  });

  if (!booking) {
    return { success: false, error: "Booking not found or lock expired" };
  }

  if (booking.lockExpiresAt && booking.lockExpiresAt < new Date()) {
    return { success: false, error: "Lock expired. Please try again." };
  }

  try {
    const order = await createRazorpayOrder(booking.totalAmount, bookingId);

    // Create payment record
    await db.payment.create({
      data: {
        bookingId,
        method: "RAZORPAY",
        status: "PENDING",
        amount: booking.totalAmount,
        razorpayOrderId: order.id,
      },
    });

    return {
      success: true,
      razorpayOrderId: order.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID!,
      amount: booking.totalAmount,
      bookingId,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to create payment",
    };
  }
}

export async function confirmRazorpayPayment(
  bookingId: string,
  razorpayPaymentId: string,
  razorpaySignature: string
): Promise<BookingState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  const payment = await db.payment.findUnique({
    where: { bookingId },
    include: { booking: true },
  });

  if (!payment || payment.booking.userId !== session.user.id) {
    return { success: false, error: "Payment not found" };
  }

  // In production, verify signature here
  // const isValid = verifyRazorpaySignature(payment.razorpayOrderId!, razorpayPaymentId, razorpaySignature);

  await db.$transaction([
    db.payment.update({
      where: { id: payment.id },
      data: {
        status: "COMPLETED",
        razorpayPaymentId,
        razorpaySignature,
        confirmedAt: new Date(),
      },
    }),
    db.booking.update({
      where: { id: bookingId },
      data: { status: "CONFIRMED" },
    }),
  ]);

  // Send notifications
  await sendBookingConfirmation(bookingId);

  return { success: true, bookingId };
}

export async function selectUpiPayment(
  bookingId: string
): Promise<BookingState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  const booking = await db.booking.findUnique({
    where: { id: bookingId, userId: session.user.id, status: "LOCKED" },
  });

  if (!booking) {
    return { success: false, error: "Booking not found or lock expired" };
  }

  // Create pending payment for UPI
  await db.payment.upsert({
    where: { bookingId },
    update: { method: "UPI_QR", status: "PENDING" },
    create: {
      bookingId,
      method: "UPI_QR",
      status: "PENDING",
      amount: booking.totalAmount,
    },
  });

  // Confirm the booking (admin will verify payment later)
  await db.booking.update({
    where: { id: bookingId },
    data: { status: "CONFIRMED" },
  });

  await sendBookingConfirmation(bookingId);

  return { success: true, bookingId };
}

export async function selectCashPayment(
  bookingId: string
): Promise<BookingState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  const booking = await db.booking.findUnique({
    where: { id: bookingId, userId: session.user.id, status: "LOCKED" },
  });

  if (!booking) {
    return { success: false, error: "Booking not found or lock expired" };
  }

  await db.payment.upsert({
    where: { bookingId },
    update: { method: "CASH", status: "PENDING" },
    create: {
      bookingId,
      method: "CASH",
      status: "PENDING",
      amount: booking.totalAmount,
    },
  });

  await db.booking.update({
    where: { id: bookingId },
    data: { status: "CONFIRMED" },
  });

  await sendBookingConfirmation(bookingId);

  return { success: true, bookingId };
}
