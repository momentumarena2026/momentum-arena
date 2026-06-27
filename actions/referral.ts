"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { awardReferralBonus } from "@/lib/rewards/earn";

/**
 * Derives a short, deterministic referral code from a user ID.
 * Uses the last 8 characters of the cuid, uppercased.
 */
export async function deriveReferralCode(userId: string): Promise<string> {
  const clean = userId.replace(/[^a-z0-9]/gi, "");
  return clean.slice(-8).toUpperCase();
}

/**
 * Resolve a referral code (the deterministic `deriveReferralCode` value a
 * referrer shares) to the referrer's userId. Case-insensitive, best-effort.
 * Returns null when the code matches nobody or resolves to the new user
 * themselves. cuid ids are lowercase alphanumeric, so the original id suffix
 * is the lowercased code — we match on that, then confirm the derived code.
 */
export async function resolveReferrerByCode(
  code: string,
  excludeUserId: string,
): Promise<string | null> {
  const normalized = code.trim().toUpperCase();
  if (normalized.length < 4) return null;
  const suffix = normalized.toLowerCase();
  const candidate = await db.user.findFirst({
    where: { id: { endsWith: suffix }, NOT: { id: excludeUserId } },
    select: { id: true },
  });
  if (!candidate) return null;
  const derived = await deriveReferralCode(candidate.id);
  return derived === normalized ? candidate.id : null;
}

/**
 * Apply a referral on a freshly-created user: resolve the code, stamp
 * `referredBy` (only if not already set), and award the referral bonus to
 * both sides. The bonus is a no-op when the admin has the referral points at
 * 0 (the default), so this is safe to call unconditionally and coexists with
 * the separate discount-code referral. Best-effort — never throws.
 */
export async function applyReferralForNewUser(
  newUserId: string,
  code: string | null | undefined,
): Promise<void> {
  if (!code) return;
  try {
    const earnerId = await resolveReferrerByCode(code, newUserId);
    if (!earnerId) return;
    const updated = await db.user.updateMany({
      where: { id: newUserId, referredBy: null },
      data: { referredBy: earnerId },
    });
    if (updated.count === 0) return; // already attributed to someone
    await awardReferralBonus({ earnerId, referredId: newUserId });
  } catch (err) {
    console.error("[referral] applyReferralForNewUser failed:", err);
  }
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
