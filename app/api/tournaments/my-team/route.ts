import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUserId } from "@/lib/auth-unified";
import { areTournamentsEnabled, getMyTournamentTeam } from "@/lib/tournaments";

export const dynamic = "force-dynamic";

/** The signed-in captain's team (with squad) in a tournament. Unified
 *  auth: web cookie or mobile bearer — powers the app's Your-Team card. */
export async function GET(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) return NextResponse.json({ team: null });
  if (!(await areTournamentsEnabled())) return NextResponse.json({ team: null });

  const slug = request.nextUrl.searchParams.get("slug") || "";
  if (!slug) return NextResponse.json({ error: "Missing slug" }, { status: 400 });
  const t = await db.tournament.findUnique({ where: { slug }, select: { id: true } });
  if (!t) return NextResponse.json({ team: null });

  const team = await getMyTournamentTeam(t.id, userId);
  return NextResponse.json({ team });
}
