import { NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { verifyPhoneOtp, normalizePhone } from "@/lib/otp";
import { signMobileToken, mobileUserResponse } from "@/lib/mobile-auth";
import { awardSignupBonus } from "@/lib/rewards/earn";
import { applyReferralForNewUser } from "@/actions/referral";

export async function POST(request: Request) {
  try {
    const { phone, otp, referralCode } = await request.json();
    if (!phone || !otp) {
      return NextResponse.json(
        { error: "Phone and OTP are required" },
        { status: 400 }
      );
    }

    const normalizedPhone = normalizePhone(phone);
    const result = await verifyPhoneOtp(phone, otp);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error, attemptsRemaining: result.attemptsRemaining },
        { status: 400 }
      );
    }

    // Find or create user
    let user = await db.user.findUnique({
      where: { phone: normalizedPhone },
    });

    if (!user) {
      user = await db.user.create({
        data: {
          phone: normalizedPhone,
          phoneVerified: new Date(),
        },
      });
      const newUserId = user.id;
      after(() => {
        void awardSignupBonus(newUserId).catch(() => {});
        void applyReferralForNewUser(newUserId, referralCode).catch(() => {});
      });
    } else if (!user.phoneVerified) {
      user = await db.user.update({
        where: { id: user.id },
        data: { phoneVerified: new Date() },
      });
    }

    const token = signMobileToken(user.id, user.email || user.phone!);

    return NextResponse.json({
      user: mobileUserResponse({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        emailVerified: !!user.emailVerified,
        hasPassword: !!user.passwordHash,
        image: user.image,
      }),
      tokens: { accessToken: token },
    });
  } catch {
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
