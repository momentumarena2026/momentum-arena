import { NextResponse } from "next/server";

/**
 * Tombstone. Email+password login was removed on 2026-04-11 (390e061) when the
 * product moved to phone OTP everywhere — but this route was missed and stayed
 * live and unauthenticated for months. Its siblings under forgot-password/ were
 * tombstoned in that commit; this one now matches them.
 *
 * No shipped client ever called it: `git log -S "api/mobile/login" -- apps/mobile/`
 * is empty across all history, and the store launch (2026-07-24) postdates the
 * removal by three months. Web sign-in is the NextAuth "otp" provider in
 * lib/auth.ts; the app uses /api/mobile/send-otp + /api/mobile/verify-otp.
 *
 * Kept as a 410 rather than deleted so any stray caller gets a purposeful answer
 * instead of Next's 404, matching how the forgot-password pair was retired.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Password login has been removed. Please use phone OTP login." },
    { status: 410 }
  );
}
