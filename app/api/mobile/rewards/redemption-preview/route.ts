import { NextRequest, NextResponse } from "next/server";
import { getRedemptionPreview } from "@/actions/rewards";
import { getMobileUser } from "@/lib/mobile-auth";

export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const billPaiseRaw = request.nextUrl.searchParams.get("billPaise");
  const billPaise = Number(billPaiseRaw ?? 0);
  if (!Number.isFinite(billPaise) || billPaise < 0) {
    return NextResponse.json({ error: "Invalid billPaise" }, { status: 400 });
  }
  const preview = await getRedemptionPreview({ billPaise });
  return NextResponse.json({ preview });
}
