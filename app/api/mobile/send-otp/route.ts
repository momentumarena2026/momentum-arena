import { NextResponse } from "next/server";
import { sendOtp } from "@/lib/otp";

export async function POST(request: Request) {
  try {
    const { email } = await request.json();
    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const result = await sendOtp(email.toLowerCase(), "email");

    if (!result.success) {
      return NextResponse.json(
        { error: result.error, retryAfter: result.retryAfter },
        { status: 429 }
      );
    }

    return NextResponse.json({ success: true, message: "OTP sent to your email" });
  } catch {
    return NextResponse.json({ error: "Failed to send OTP" }, { status: 500 });
  }
}
