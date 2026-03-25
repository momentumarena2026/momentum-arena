import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { verifyOtp } from "@/lib/otp";

export async function POST(request: Request) {
  try {
    const { email, otp, newPassword } = await request.json();

    if (!email || !otp || !newPassword) {
      return NextResponse.json(
        { error: "Email, OTP, and new password are required" },
        { status: 400 }
      );
    }

    if (newPassword.length < 10) {
      return NextResponse.json(
        { error: "Password must be at least 10 characters" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase();

    // Verify OTP
    const result = await verifyOtp(normalizedEmail, otp, "email");
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Update password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await db.user.update({
      where: { email: normalizedEmail },
      data: {
        passwordHash: hashedPassword,
        emailVerified: new Date(), // Mark verified since OTP was confirmed
      },
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to reset password" },
      { status: 500 }
    );
  }
}
