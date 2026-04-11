import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Password login has been removed. Please use phone OTP login." },
    { status: 410 }
  );
}
