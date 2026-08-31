import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { areTournamentsEnabled, setMyTeamLogo } from "@/lib/tournaments";

/**
 * POST — the captain sets or clears their team's logo after registration.
 *
 * One route for web and app: getAuthUserId reads either the web session
 * cookie or the app's bearer token, the same way the squad and
 * slot-preference routes do.
 *
 * The image itself is uploaded separately via /api/tournaments/logo-upload,
 * which normalises it to a square webp in our own blob store. This route
 * only stores the resulting URL, and setMyTeamLogo re-checks it is one of
 * ours — the upload endpoint and this one are independent doors.
 *
 * Body: { teamId, logoUrl } — logoUrl null or "" removes the logo.
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  if (!(await areTournamentsEnabled())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const teamId = typeof body?.teamId === "string" ? body.teamId : "";
  if (!teamId) {
    return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  }
  const logoUrl =
    typeof body?.logoUrl === "string" && body.logoUrl.trim()
      ? body.logoUrl.trim()
      : null;

  const res = await setMyTeamLogo({ teamId, userId, logoUrl });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ success: true, logoUrl });
}
