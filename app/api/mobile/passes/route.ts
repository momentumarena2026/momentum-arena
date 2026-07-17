import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { listUserPasses, arePassesEnabled } from "@/lib/passes";

/** The signed-in customer's passes (owned + shared with them) — same
 *  shape the web account page renders, via lib/passes.listUserPasses. */
export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [passes, storefrontEnabled] = await Promise.all([
    listUserPasses(user.id),
    arePassesEnabled().catch(() => false),
  ]);
  return NextResponse.json({ passes, storefrontEnabled });
}
