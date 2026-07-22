import { NextRequest, NextResponse } from "next/server";
import { getMyRewardOverview } from "@/actions/rewards";
import { getMobileUser } from "@/lib/mobile-auth";

export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const overview = await getMyRewardOverview();
  return NextResponse.json({ overview });
}
