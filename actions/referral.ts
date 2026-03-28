"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Derives a short, deterministic referral code from a user ID.
 * Uses the last 8 characters of the cuid, uppercased.
 */
export async function deriveReferralCode(userId: string): Promise<string> {
  const clean = userId.replace(/[^a-z0-9]/gi, "");
  return clean.slice(-8).toUpperCase();
}

export interface ReferralStats {
  referralCode: string;
  totalReferrals: number;
  totalDiscountGiven: number; // paise
}

export async function getReferralStats(): Promise<ReferralStats | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const userId = session.user.id;
  const referralCode = await deriveReferralCode(userId);

  // Find the referral discount code for this user (code = REF-<referralCode>)
  // Referrals are tracked as discount codes created with the pattern "REF<REFERRALCODE>"
  // Count how many distinct users (excluding self) have used any discount code
  // whose code starts with "REF" and matches this user's referral code.
  const refCodePattern = `REF${referralCode}`;

  const discountCode = await db.discountCode.findUnique({
    where: { code: refCodePattern },
    include: {
      usages: {
        where: { userId: { not: userId } },
        select: { discountAmount: true, userId: true },
      },
    },
  });

  const totalReferrals = discountCode
    ? new Set(discountCode.usages.map((u) => u.userId)).size
    : 0;
  const totalDiscountGiven = discountCode
    ? discountCode.usages.reduce((sum, u) => sum + u.discountAmount, 0)
    : 0;

  return {
    referralCode,
    totalReferrals,
    totalDiscountGiven,
  };
}
