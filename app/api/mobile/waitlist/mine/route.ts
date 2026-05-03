import { NextRequest, NextResponse } from "next/server";
import { getUserWaitlist } from "@/actions/waitlist";
import { getMobileUser } from "@/lib/mobile-auth";

export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await getUserWaitlist(user.id);
  return NextResponse.json(result);
}
