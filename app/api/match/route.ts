import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import {
  createPublicMatch,
  getPublicMatch,
  scorePublicMatch,
  finishPublicMatch,
  listMyPublicMatches,
  replay,
  type ScoreEvent,
  type PublicMatchSport,
} from "@/lib/public-match";

/**
 * Casual match scoring. Unified auth, so the app shares these routes.
 *
 * GET  ?code=ABC123 → the live scoreboard (public — that's the point)
 * GET  ?mine=1      → the signed-in user's recent matches
 * POST { action }   → create | score | undo | finish
 *
 * Tournament matches are NOT reachable from here: they live behind the
 * admin-issued scorerCode on /api/tournaments/scorer.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);

  if (url.searchParams.get("mine")) {
    const userId = await getAuthUserId(request);
    if (!userId) return NextResponse.json({ matches: [] });
    const rows = await listMyPublicMatches(userId);
    return NextResponse.json({
      matches: rows.map((m) => ({
        code: m.code,
        sport: m.sport,
        status: m.status,
        teamAName: m.teamAName,
        teamBName: m.teamBName,
        createdAt: m.createdAt.toISOString(),
        state: replay(
          (m.events as unknown as ScoreEvent[]) ?? [],
          m.sport as PublicMatchSport,
        ),
      })),
    });
  }

  const code = url.searchParams.get("code");
  if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });
  const match = await getPublicMatch(code);
  if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });

  const userId = await getAuthUserId(request);
  return NextResponse.json({
    match: {
      ...match,
      createdAt: match.createdAt.toISOString(),
      completedAt: match.completedAt?.toISOString() ?? null,
      // Drives whether the client shows the scoring pad or a watch-only view.
      canScore: !match.createdByUserId || match.createdByUserId === userId,
    },
  });
}

export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  const body = await request.json().catch(() => ({}));
  const action = String(body?.action ?? "");

  if (action === "create") {
    const res = await createPublicMatch({
      sport: body.sport,
      teamAName: String(body.teamAName ?? ""),
      teamBName: String(body.teamBName ?? ""),
      oversPerInnings: body.oversPerInnings ? Number(body.oversPerInnings) : null,
      createdByUserId: userId,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    return NextResponse.json({ code: res.code });
  }

  const code = String(body?.code ?? "");
  if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });

  if (action === "score" || action === "undo") {
    const res = await scorePublicMatch({
      code,
      userId,
      event: action === "undo" ? { t: "UNDO" } : (body.event as ScoreEvent),
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    const match = await getPublicMatch(code);
    return NextResponse.json({ state: match?.state });
  }

  if (action === "finish") {
    const res = await finishPublicMatch({ code, userId, abandoned: !!body.abandoned });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
