"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export interface DiscountValidation {
  valid: boolean;
  error?: string;
  discountAmount?: number;
  newTotal?: number;
  codeName?: string;
  codeId?: string;
}

export async function validateDiscountCode(
  code: string,
  bookingId: string
): Promise<DiscountValidation> {
  const session = await auth();
  if (!session?.user?.id) return { valid: false, error: "Not authenticated" };

  const upperCode = code.toUpperCase().trim();
  const now = new Date();

  // Find code
  const discountCode = await db.discountCode.findUnique({
    where: { code: upperCode },
  });

  if (!discountCode || !discountCode.isActive) {
    return { valid: false, error: "Invalid discount code" };
  }

  // Check date range
  if (now < discountCode.validFrom || now > discountCode.validUntil) {
    return { valid: false, error: "This code has expired" };
  }

  // Check max uses
  if (discountCode.maxUses && discountCode.usedCount >= discountCode.maxUses) {
    return { valid: false, error: "This code has reached its usage limit" };
  }

  // Check per-user limit
  const userUsageCount = await db.discountUsage.count({
    where: {
      discountCodeId: discountCode.id,
      userId: session.user.id,
    },
  });
  if (userUsageCount >= discountCode.maxUsesPerUser) {
    return { valid: false, error: "You have already used this code" };
  }

  // Load booking
  const booking = await db.booking.findUnique({
    where: { id: bookingId, userId: session.user.id },
    include: { courtConfig: true },
  });

  if (!booking) return { valid: false, error: "Booking not found" };

  // Check if discount already applied
  if (booking.discountAmount > 0) {
    return { valid: false, error: "A discount is already applied to this booking" };
  }

  // Check min booking amount
  if (discountCode.minBookingAmount && booking.totalAmount < discountCode.minBookingAmount) {
    return {
      valid: false,
      error: `Minimum booking amount is ₹${(discountCode.minBookingAmount / 100).toLocaleString("en-IN")}`,
    };
  }

  // Check sport filter
  if (
    discountCode.sportFilter.length > 0 &&
    !discountCode.sportFilter.includes(booking.courtConfig.sport)
  ) {
    return { valid: false, error: "This code is not valid for this sport" };
  }

  // Calculate discount
  let discountAmount: number;
  if (discountCode.type === "PERCENTAGE") {
    discountAmount = Math.floor(booking.totalAmount * discountCode.value / 10000);
  } else {
    discountAmount = discountCode.value;
  }

  // Cap at total
  discountAmount = Math.min(discountAmount, booking.totalAmount);

  return {
    valid: true,
    discountAmount,
    newTotal: booking.totalAmount - discountAmount,
    codeName: discountCode.code,
    codeId: discountCode.id,
  };
}

export async function applyDiscountCode(
  code: string,
  bookingId: string
): Promise<DiscountValidation> {
  const session = await auth();
  if (!session?.user?.id) return { valid: false, error: "Not authenticated" };

  // Re-validate everything in a transaction
  const upperCode = code.toUpperCase().trim();

  try {
    const result = await db.$transaction(
      async (tx) => {
        const discountCode = await tx.discountCode.findUnique({
          where: { code: upperCode },
        });

        if (!discountCode || !discountCode.isActive) {
          throw new Error("Invalid discount code");
        }

        const now = new Date();
        if (now < discountCode.validFrom || now > discountCode.validUntil) {
          throw new Error("This code has expired");
        }

        if (discountCode.maxUses && discountCode.usedCount >= discountCode.maxUses) {
          throw new Error("Usage limit reached");
        }

        const userUsageCount = await tx.discountUsage.count({
          where: { discountCodeId: discountCode.id, userId: session.user!.id },
        });
        if (userUsageCount >= discountCode.maxUsesPerUser) {
          throw new Error("Already used");
        }

        const booking = await tx.booking.findUnique({
          where: { id: bookingId, userId: session.user!.id },
          include: { courtConfig: true },
        });
        if (!booking) throw new Error("Booking not found");

        if (booking.discountAmount > 0) {
          throw new Error("Discount already applied");
        }

        if (
          discountCode.minBookingAmount &&
          booking.totalAmount < discountCode.minBookingAmount
        ) {
          throw new Error("Below minimum amount");
        }

        if (
          discountCode.sportFilter.length > 0 &&
          !discountCode.sportFilter.includes(booking.courtConfig.sport)
        ) {
          throw new Error("Not valid for this sport");
        }

        let discountAmount: number;
        if (discountCode.type === "PERCENTAGE") {
          discountAmount = Math.floor(booking.totalAmount * discountCode.value / 10000);
        } else {
          discountAmount = discountCode.value;
        }
        discountAmount = Math.min(discountAmount, booking.totalAmount);

        // Apply
        await tx.discountUsage.create({
          data: {
            discountCodeId: discountCode.id,
            userId: session.user!.id,
            bookingId,
            discountAmount,
          },
        });

        await tx.discountCode.update({
          where: { id: discountCode.id },
          data: { usedCount: { increment: 1 } },
        });

        await tx.booking.update({
          where: { id: bookingId },
          data: {
            originalAmount: booking.totalAmount,
            discountAmount,
            discountCodeId: discountCode.id,
            totalAmount: booking.totalAmount - discountAmount,
          },
        });

        return {
          discountAmount,
          newTotal: booking.totalAmount - discountAmount,
          codeName: discountCode.code,
        };
      },
      { isolationLevel: "Serializable", timeout: 10000 }
    );

    return { valid: true, ...result };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Failed to apply discount",
    };
  }
}
