import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { areTournamentsEnabled, updateMyTeamSquad } from "@/lib/tournaments";

/** Captain updates their team's squad any time after registration.
 *  Unified auth: web cookie or mobile bearer — the app reuses this route.
 *  Body: { teamId, members: string[] } — the full desired player list;
 *  the server reconciles it stat-safely (see reconcileTeamSquad). */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Sign in to manage your squad" }, { status: 401 });
  }
  if (!(await areTournamentsEnabled())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const { teamId, members } = body || {};
  if (!teamId || !Array.isArray(members)) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const result = await updateMyTeamSquad(
    String(teamId),
    userId,
    members.map((m: unknown) => String(m))
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
