import { NextRequest, NextResponse } from "next/server";
import { getMyRewardTransactions } from "@/actions/rewards";
import { getMobileUser } from "@/lib/mobile-auth";

export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const before = request.nextUrl.searchParams.get("before") ?? undefined;
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 20);
  const result = await getMyRewardTransactions({ before, limit }, user.id);
  return NextResponse.json(result);
}
