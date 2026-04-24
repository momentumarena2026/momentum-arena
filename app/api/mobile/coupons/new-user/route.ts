import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { getNewUserDiscount } from "@/lib/new-user-discount";
import type { Sport } from "@prisma/client";

// GET /api/mobile/coupons/new-user?sport=CRICKET&amount=2000
// Returns the new-user discount the server will auto-honour for this user
// (null if they already have a confirmed booking or no active system code).
export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sport = searchParams.get("sport") as Sport | null;
  const amountStr = searchParams.get("amount");
  const amount = amountStr ? parseInt(amountStr, 10) : NaN;

  if (!sport || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "sport and amount are required" },
      { status: 400 }
    );
  }

  try {
    const discount = await getNewUserDiscount(user.id, sport, amount);
    return NextResponse.json({ discount });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 }
    );
  }
}
