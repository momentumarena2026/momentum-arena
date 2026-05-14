import { db } from "./db";
import { Sport, BookingCategory } from "@prisma/client";

export interface NewUserDiscountInfo {
  codeId: string;
  code: string;
  type: "PERCENTAGE" | "FLAT";
  value: number;
  discountAmount: number;
}

export async function getNewUserDiscount(
  userId: string,
  sport: Sport,
  totalAmount: number,
  // Sub-category of the booking the discount would be applied to.
  // The active system code is seeded with categoryExclude =
  // [BOWLING_MACHINE], so passing that value short-circuits before
  // computing the discount. Callers that aren't booking-specific
  // (e.g. cafe surfaces) just omit it.
  bookingCategory?: BookingCategory | null,
): Promise<NewUserDiscountInfo | null> {
  // Only count bookings the user made themselves. An admin pre-
  // booking a slot on behalf of a brand-new customer should NOT
  // disqualify that customer from the new-user discount when they
  // come online and try to book the first time. Mirrors the same
  // filter in coupon-validation.ts FIRST_TIME and customer-
  // coupons.ts isFirstTime — kept consistent so all three "is this
  // their first own booking?" surfaces agree.
  const confirmedCount = await db.booking.count({
    where: { userId, status: "CONFIRMED", createdByAdminId: null },
  });

  if (confirmedCount > 0) return null;

  // Find active system discount code
  const now = new Date();
  const systemCode = await db.discountCode.findFirst({
    where: {
      isSystemCode: true,
      isActive: true,
      validFrom: { lte: now },
      validUntil: { gte: now },
    },
  });

  if (!systemCode) return null;

  // Check sport filter
  if (systemCode.sportFilter.length > 0 && !systemCode.sportFilter.includes(sport)) {
    return null;
  }

  // Check sub-category exclusion. Empty array means the code applies
  // to every cricket sub-flow; the migration seeds the active code
  // with [BOWLING_MACHINE] so welcome discounts never land on bowling.
  if (
    bookingCategory &&
    systemCode.categoryExclude.length > 0 &&
    systemCode.categoryExclude.includes(bookingCategory)
  ) {
    return null;
  }

  // Check if already used by this user
  const usageCount = await db.discountUsage.count({
    where: { discountCodeId: systemCode.id, userId },
  });
  if (usageCount > 0) return null;

  // Calculate discount
  let discountAmount: number;
  if (systemCode.type === "PERCENTAGE") {
    discountAmount = Math.floor(totalAmount * systemCode.value / 10000);
  } else {
    discountAmount = systemCode.value;
  }
  discountAmount = Math.min(discountAmount, totalAmount);

  return {
    codeId: systemCode.id,
    code: systemCode.code,
    type: systemCode.type,
    value: systemCode.value,
    discountAmount,
  };
}
