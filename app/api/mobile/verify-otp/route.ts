import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyOtp } from "@/lib/otp";
import { signMobileToken, mobileUserResponse } from "@/lib/mobile-auth";

export async function POST(request: Request) {
  try {
    const { email, otp } = await request.json();
    if (!email || !otp) {
      return NextResponse.json(
        { error: "Email and OTP are required" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase();
    const result = await verifyOtp(normalizedEmail, otp, "email");

    if (!result.success) {
      return NextResponse.json(
        { error: result.error, attemptsRemaining: result.attemptsRemaining },
        { status: 400 }
      );
    }

    // Find or create user
    let user = await db.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      user = await db.user.create({
        data: {
          email: normalizedEmail,
          emailVerified: new Date(),
        },
      });
    } else if (!user.emailVerified) {
      user = await db.user.update({
        where: { id: user.id },
        data: { emailVerified: new Date() },
      });
    }

    const token = signMobileToken(user.id, user.email!);

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
