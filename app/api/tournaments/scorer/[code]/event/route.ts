import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  applyLiveEvent,
  undoLastEvent,
  startLiveMatch,
  endLiveMatch,
} from "@/lib/tournament-live";
import { checkRateLimit, recordRateLimitHit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Scorer actions: start / event / undo / end. The code both authenticates
 *  the scorer and scopes them to that tournament's matches only. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  // Throttle only on a miss, after the lookup — a correct code must always
  // work (the scorer taps through an over on the venue's shared IP), while
  // a guesser is cut off. Shares the failure counter with the GET route.
  const t = await db.tournament.findUnique({
    where: { scorerCode: code.toUpperCase() },
    select: { id: true, liveScoringEnabled: true },
  });
  if (!t || !t.liveScoringEnabled) {
    const ip = clientIp(request);
    const gate = await checkRateLimit({
      identifier: ip,
      action: "tournament_scorer_fail",
      limit: 20,
      windowSeconds: 300,
      peek: true,
    });
    await recordRateLimitHit({ identifier: ip, action: "tournament_scorer_fail", windowSeconds: 300 });
    if (!gate.allowed) {
      return NextResponse.json(
        { error: "Too many invalid codes — try again shortly" },
        { status: 429, headers: { "Retry-After": String(gate.retryAfter) } }
      );
    }
    return NextResponse.json({ error: "Invalid scorer code" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const { matchId, action, event, winnerTeamId } = body || {};
  if (!matchId || !action) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  // Scope check: the match must belong to this scorer's tournament.
  const match = await db.tournamentMatch.findUnique({
    where: { id: matchId },
    select: { tournamentId: true },
  });
  if (!match || match.tournamentId !== t.id) {
    return NextResponse.json({ error: "Match not in this tournament" }, { status: 403 });
  }

  const actor = `scorer:${code.toUpperCase()}`;
  let result: { ok: boolean; error?: string; needsWinner?: boolean };
  if (action === "start") result = await startLiveMatch(matchId);
  else if (action === "undo") result = await undoLastEvent(matchId);
  else if (action === "end") result = await endLiveMatch(matchId, winnerTeamId || null);
  else if (action === "event" && event?.kind) {
    result = await applyLiveEvent(
      matchId,
      { kind: String(event.kind), teamId: event.teamId, memberId: event.memberId, data: event.data },
      actor
    );
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, needsWinner: result.needsWinner },
      { status: 400 }
    );
  }
  return NextResponse.json({ success: true });
}
