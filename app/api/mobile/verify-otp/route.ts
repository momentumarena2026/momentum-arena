import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPhoneOtp, normalizePhone } from "@/lib/otp";
import { signMobileToken, mobileUserResponse } from "@/lib/mobile-auth";

export async function POST(request: Request) {
  try {
    const { phone, otp } = await request.json();
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
