"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createRazorpayOrder, RAZORPAY_KEY_ID } from "@/lib/razorpay";
import { WalletTxType } from "@prisma/client";
import { sendBookingConfirmation } from "@/lib/notifications";

export interface WalletResult {
  success: boolean;
  error?: string;
}

export interface WalletData {
  id: string;
  balancePaise: number;
  transactions: {
    id: string;
    type: WalletTxType;
    amountPaise: number;
    description: string;
    refBookingId: string | null;
    createdAt: Date;
  }[];
}

export async function getWallet(): Promise<
  WalletResult & { wallet?: WalletData }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  const wallet = await getOrCreateWallet(session.user.id);

  const walletWithTransactions = await db.wallet.findUnique({
    where: { id: wallet.id },
    include: {
      transactions: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          type: true,
          amountPaise: true,
          description: true,
          refBookingId: true,
          createdAt: true,
        },
      },
    },
  });

  if (!walletWithTransactions) {
    return { success: false, error: "Wallet not found" };
  }

  return { success: true, wallet: walletWithTransactions };
}

export async function getOrCreateWallet(userId: string) {
  const existing = await db.wallet.findUnique({ where: { userId } });
  if (existing) return existing;

  return db.wallet.create({
    data: {
      userId,
      balancePaise: 0,
    },
  });
}

export async function creditWallet(
  userId: string,
  amountPaise: number,
  description: string,
  type: WalletTxType = "CREDIT_REFUND",
  refBookingId?: string
): Promise<WalletResult> {
  if (amountPaise <= 0) {
    return { success: false, error: "Amount must be positive" };
  }

  const wallet = await getOrCreateWallet(userId);

  await db.$transaction([
    db.wallet.update({
      where: { id: wallet.id },
      data: { balancePaise: { increment: amountPaise } },
    }),
    db.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type,
        amountPaise,
        description,
        refBookingId: refBookingId || null,
      },
    }),
  ]);

  return { success: true };
}

export async function debitWallet(
  userId: string,
  amountPaise: number,
  description: string,
  type: WalletTxType = "DEBIT_BOOKING",
  refBookingId?: string
): Promise<WalletResult> {
  if (amountPaise <= 0) {
    return { success: false, error: "Amount must be positive" };
  }

  const wallet = await getOrCreateWallet(userId);

  if (wallet.balancePaise < amountPaise) {
    return { success: false, error: "Insufficient wallet balance" };
  }

  await db.$transaction([
    db.wallet.update({
      where: { id: wallet.id },
      data: { balancePaise: { decrement: amountPaise } },
    }),
    db.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type,
        amountPaise,
        description,
        refBookingId: refBookingId || null,
      },
    }),
  ]);

  return { success: true };
}

/**
 * Pay for a booking using wallet balance.
 * Debits wallet, creates payment record, confirms booking.
 */
export async function payBookingWithWallet(
  bookingId: string
): Promise<WalletResult> {
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

  const wallet = await getOrCreateWallet(session.user.id);

  if (wallet.balancePaise < booking.totalAmount) {
    return {
      success: false,
      error: `Insufficient wallet balance. Available: ₹${(wallet.balancePaise / 100).toFixed(2)}, Required: ₹${(booking.totalAmount / 100).toFixed(2)}`,
    };
  }

  // Debit wallet, create payment record, confirm booking in one transaction
  await db.$transaction([
    db.wallet.update({
      where: { id: wallet.id },
      data: { balancePaise: { decrement: booking.totalAmount } },
    }),
    db.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "DEBIT_BOOKING",
        amountPaise: booking.totalAmount,
        description: `Booking #${bookingId.slice(-8).toUpperCase()}`,
        refBookingId: bookingId,
      },
    }),
    db.payment.upsert({
      where: { bookingId },
      update: {
        method: "RAZORPAY", // Using RAZORPAY as wallet isn't a PaymentMethod enum value
        status: "COMPLETED",
        amount: booking.totalAmount,
        confirmedAt: new Date(),
      },
      create: {
        bookingId,
        method: "RAZORPAY",
        status: "COMPLETED",
        amount: booking.totalAmount,
        confirmedAt: new Date(),
      },
    }),
    db.booking.update({
      where: { id: bookingId },
      data: { status: "CONFIRMED" },
    }),
  ]);

  await sendBookingConfirmation(bookingId).catch(console.error);

  return { success: true };
}

export async function topUpWallet(amountPaise: number): Promise<
  WalletResult & {
    razorpayOrderId?: string;
    razorpayKeyId?: string;
    amount?: number;
  }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  if (amountPaise < 10000) {
    // Minimum ₹100
    return { success: false, error: "Minimum top-up amount is ₹100" };
  }

  if (amountPaise > 500000) {
    // Maximum ₹5000
    return { success: false, error: "Maximum top-up amount is ₹5000" };
  }

  try {
    const order = await createRazorpayOrder(
      amountPaise,
      `wallet-topup-${session.user.id}`
    );

    return {
      success: true,
      razorpayOrderId: order.id,
      razorpayKeyId: RAZORPAY_KEY_ID,
      amount: amountPaise,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to create payment",
    };
  }
}

/**
 * Confirm wallet top-up after Razorpay payment verification.
 */
export async function confirmWalletTopUp(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  amountPaise: number
): Promise<WalletResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  await creditWallet(
    session.user.id,
    amountPaise,
    `Wallet top-up via Razorpay`,
    "CREDIT_TOPUP"
  );

  return { success: true };
}
