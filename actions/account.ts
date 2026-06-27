"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Soft-delete + anonymize a user account.
 *
 * The App Store (and Play) require apps that let users create an account to
 * also let them delete it from within the app. We don't hard-delete the row
 * (bookings, payments and reward ledger entries reference it and must be
 * retained for accounting); instead we:
 *   - cancel all upcoming bookings + active recurring series,
 *   - drop auth sessions, linked OAuth accounts, push devices, waitlist
 *     entries and the cart so the account stops receiving / doing anything,
 *   - null every piece of PII (name/email/phone/image/password/birthday/
 *     referral) so nothing personal remains and the same phone/email can be
 *     used to sign up fresh, and
 *   - stamp `deletedAt` (admin listing queries already exclude these rows).
 *
 * After this runs the account can no longer be signed into (phone/email are
 * gone, and getMobileUser rejects deletedAt rows).
 */
export async function softDeleteAccount(userId: string): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await db.$transaction(async (tx) => {
    await tx.booking.updateMany({
      where: {
        userId,
        date: { gte: today },
        status: { in: ["PENDING", "CONFIRMED"] },
      },
      data: { status: "CANCELLED" },
    });
    await tx.recurringBooking.updateMany({
      where: { userId, status: { in: ["ACTIVE", "PAUSED"] } },
      data: { status: "CANCELLED" },
    });

    await tx.session.deleteMany({ where: { userId } });
    await tx.account.deleteMany({ where: { userId } });
    await tx.pushDevice.deleteMany({ where: { userId } });
    await tx.waitlist.deleteMany({ where: { userId } });
    await tx.cart.deleteMany({ where: { userId } });

    await tx.user.update({
      where: { id: userId },
      data: {
        name: "Deleted user",
        email: null,
        phone: null,
        image: null,
        passwordHash: null,
        passwordSetAt: null,
        emailVerified: null,
        phoneVerified: null,
        birthday: null,
        referralCode: null,
        referredBy: null,
        deletedAt: new Date(),
      },
    });
  });
}

/**
 * Web entry point — delete the currently signed-in customer's account.
 * The client should call signOut() right after a success.
 */
export async function deleteMyAccount(): Promise<{
  success: boolean;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }
  try {
    await softDeleteAccount(session.user.id);
    return { success: true };
  } catch {
    return {
      success: false,
      error: "Couldn't delete your account. Please try again.",
    };
  }
}
