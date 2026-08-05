import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { setTeamSlotPreferences } from "@/lib/tournaments";

/**
 * POST — the captain saves which pre-decided windows their team can
 * play. One route for web and app: getAuthUserId reads either the web
 * session cookie or the app's bearer token.
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const teamId = typeof body?.teamId === "string" ? body.teamId : "";
  const slotIds = Array.isArray(body?.slotIds)
    ? body.slotIds.filter((x: unknown) => typeof x === "string")
    : [];
  if (!teamId) {
    return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  }
  const res = await setTeamSlotPreferences({ teamId, userId, slotIds });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ success: true });
}
