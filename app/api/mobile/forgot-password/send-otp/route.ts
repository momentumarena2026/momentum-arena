import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendOtp } from "@/lib/otp";

export async function POST(request: Request) {
  try {
    const { email } = await request.json();
    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase();

    // Check user exists
    const user = await db.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return NextResponse.json(
        { error: "No account found with this email" },
        { status: 404 }
      );
    }

    const result = await sendOtp(normalizedEmail, "email");
    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 429 }
      );
    }

    return NextResponse.json({ success: true, message: "OTP sent to your email" });
  } catch {
    return NextResponse.json({ error: "Failed to send OTP" }, { status: 500 });
  }
}
