import { NextRequest, NextResponse, after } from "next/server";
import { verifyPhoneOtp, normalizePhone } from "@/lib/otp";
import { db } from "@/lib/db";
import { awardSignupBonus } from "@/lib/rewards/earn";
import { applyReferralForNewUser } from "@/actions/referral";

export async function POST(request: NextRequest) {
  try {
    const { phone, otp, referralCode } = await request.json();

    if (!phone || !otp) {
      return NextResponse.json({ error: "Phone and OTP are required" }, { status: 400 });
    }

    const result = await verifyPhoneOtp(phone, otp);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error, attemptsRemaining: result.attemptsRemaining },
        { status: 400 }
      );
    }

    // Ensure user exists (create if first time)
    const normalizedPhone = normalizePhone(phone);
    let user = await db.user.findUnique({ where: { phone: normalizedPhone } });
    if (!user) {
      user = await db.user.create({
        data: {
          phone: normalizedPhone,
          phoneVerified: new Date(),
        },
      });
      const newUserId = user.id;
      // Must be awaited inside after() — a synchronous callback returns
      // undefined immediately, so the serverless freeze kills the floating
      // promises and the signup/referral points are silently lost. Run
      // sequentially: both earns touch the same new user's balance row.
      after(async () => {
        await awardSignupBonus(newUserId).catch((err) =>
          console.error("[verify-phone-otp] signup bonus failed", err),
        );
        await applyReferralForNewUser(newUserId, referralCode).catch((err) =>
          console.error("[verify-phone-otp] referral apply failed", err),
        );
      });
    } else if (!user.phoneVerified) {
      await db.user.update({
        where: { id: user.id },
        data: { phoneVerified: new Date() },
      });
    }

    return NextResponse.json({ success: true, needsName: !user.name });
  } catch (error) {
    console.error("Verify phone OTP error:", error);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
