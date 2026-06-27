import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { softDeleteAccount } from "@/actions/account";

/**
 * POST /api/mobile/account/delete — delete the signed-in user's account.
 *
 * The App Store requires in-app account deletion. Shares softDeleteAccount
 * with the web flow (anonymize PII + soft-delete + cancel upcoming bookings).
 * The app drops its token and signs out on success.
 */
export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await softDeleteAccount(user.id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Couldn't delete your account. Please try again." },
      { status: 500 },
    );
  }
}
