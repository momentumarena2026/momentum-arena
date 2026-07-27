import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { registerTournamentTeam } from "@/lib/tournaments";
import { RAZORPAY_KEY_ID } from "@/lib/razorpay";

/** Register a team (captain pays). Unified auth: web cookie or mobile
 *  bearer — the mobile app reuses this exact route. Returns either a
 *  confirmed/waitlisted state or a Razorpay order to pay. */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Sign in to register a team" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const {
    tournamentId,
    teamName,
    color,
    logoUrl,
    members,
    captainName,
    captainPhone,
    captainEmail,
    couponCode,
    platform,
  } = body || {};
  if (!tournamentId || !teamName || !Array.isArray(members)) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const result = await registerTournamentTeam({
    tournamentId,
    userId,
    teamName: String(teamName),
    color: color ? String(color) : null,
    logoUrl: logoUrl ? String(logoUrl) : null,
    members: members.map((m: unknown) => String(m)),
    captainName: String(captainName || ""),
    captainPhone: String(captainPhone || ""),
    captainEmail: captainEmail ? String(captainEmail) : null,
    couponCode: couponCode ? String(couponCode) : null,
    platform: platform === "android" || platform === "ios" ? platform : "web",
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ...result, keyId: RAZORPAY_KEY_ID });
}
