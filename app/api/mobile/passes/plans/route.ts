import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { getActivePassPlans } from "@/actions/passes";

/** Storefront plan cards — same band-validity-filtered list the web
 *  /passes page renders. Empty when the admin storefront toggle is off. */
export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const plans = await getActivePassPlans();
  return NextResponse.json({ plans });
}
