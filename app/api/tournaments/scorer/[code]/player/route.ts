import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkRateLimit, recordRateLimitHit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Add one player to a team, from the scorer console.
 *
 * The picker already lists whatever squad the captain entered. The gap was
 * everything else: a team that registered without a squad, a substitute
 * who turned up, a name spelled differently on the day. The sheet's answer
 * was "add them from the admin console", which is useless to a volunteer
 * holding a phone at the boundary with the batter waiting.
 *
 * Deliberately narrow, because the scorer code is a low-trust credential
 * shared with whoever is scoring:
 *   - append only. No rename, no delete, no reordering — nothing that can
 *     erase a player who already has recorded stats.
 *   - the team must belong to THIS tournament, so a leaked code can't
 *     touch anyone else's squad.
 *   - capped at the tournament's own membersPerTeamMax.
 *   - an existing name returns that member instead of creating a twin,
 *     so a scorer tapping twice doesn't split one player's stats in two.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;

  // Same shape as the event route: look up first, throttle only on a miss,
  // so the real scorer on the venue's shared IP is never locked out.
  const t = await db.tournament.findUnique({
    where: { scorerCode: code.toUpperCase() },
    select: { id: true, liveScoringEnabled: true, membersPerTeamMax: true },
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
    await recordRateLimitHit({
      identifier: ip,
      action: "tournament_scorer_fail",
      windowSeconds: 300,
    });
    if (!gate.allowed) {
      return NextResponse.json(
        { error: "Too many invalid codes — try again shortly" },
        { status: 429, headers: { "Retry-After": String(gate.retryAfter) } },
      );
    }
    return NextResponse.json({ error: "Invalid scorer code" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    teamId?: unknown;
    name?: unknown;
  } | null;
  const teamId = typeof body?.teamId === "string" ? body.teamId : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!teamId || name.length < 1 || name.length > 60) {
    return NextResponse.json(
      { error: "Enter a player name" },
      { status: 400 },
    );
  }

  const team = await db.tournamentTeam.findFirst({
    // tournamentId in the WHERE, not checked after: a team from another
    // tournament simply isn't found, so a leaked code reaches nothing.
    where: { id: teamId, tournamentId: t.id },
    select: { id: true, members: { select: { id: true, name: true, order: true } } },
  });
  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const existing = team.members.find(
    (m) => m.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) {
    return NextResponse.json({ ok: true, member: { id: existing.id, name: existing.name } });
  }

  if (t.membersPerTeamMax > 0 && team.members.length >= t.membersPerTeamMax) {
    return NextResponse.json(
      { error: `Squad is full (${t.membersPerTeamMax} players)` },
      { status: 400 },
    );
  }

  const member = await db.tournamentTeamMember.create({
    data: {
      teamId: team.id,
      name,
      order: team.members.length,
      isCaptain: false,
    },
    select: { id: true, name: true },
  });

  return NextResponse.json({ ok: true, member });
}
