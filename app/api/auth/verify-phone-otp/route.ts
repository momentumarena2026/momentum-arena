import { NextRequest, NextResponse } from "next/server";
import { verifyPhoneOtp, normalizePhone } from "@/lib/otp";
import { db } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const { phone, otp } = await request.json();

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
