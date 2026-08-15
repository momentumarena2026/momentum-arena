import { NextRequest, NextResponse } from "next/server";
import { getSlotPlanning } from "@/actions/admin-tournament-slots";
import { listCourtsForTournament } from "@/actions/admin-tournament-fixtures";
import { getTournamentLeaderboards } from "@/lib/tournament-leaderboards";
import { standingsGroups } from "@/lib/tournament-points";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import {
  listTournamentsAdmin,
  getTournamentAdmin,
} from "@/actions/admin-tournaments";

/**
 * GET /api/mobile/admin/tournaments        → list (cards)
 * GET /api/mobile/admin/tournaments?id=X   → full manage detail
 * The server actions gate again internally (requireAdmin resolves the
 * Bearer token); the guard here just keeps the 401 shape consistent.
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_TOURNAMENTS");
  if ("error" in gate) return gate.error;

  const id = request.nextUrl.searchParams.get("id");
  if (id) {
    const t = await getTournamentAdmin(id);
    if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Courts ride along so the app can schedule a fixture without a second
    // round trip — the screen needs them the moment the detail renders.
    const courts = await listCourtsForTournament(id);
    // The match windows already committed on Slots & Draw. Scheduling
    // should land inside one: those windows are what block the customer
    // booking grid, so a match placed outside them is on hours we are
    // still selling.
    const planning = await getSlotPlanning(id);
    // Same helper the web Leaders tab and the public page use, so the three
    // can't drift into showing different top scorers for one tournament.
    const statFields = (Array.isArray(t.statFields) ? t.statFields : []) as {
      key: string;
      label: string;
    }[];
    const leaderboards = await getTournamentLeaderboards(t.id, statFields);
    // Computed here, not in the app, so the phone's points table is the
    // same object the web tab and the public page render.
    const standings = standingsGroups({
      tournament: t,
      matches: t.matches,
      teams: t.teams,
      pools: t.pools,
    });
    return NextResponse.json({
      tournament: t,
      courts,
      windows: planning?.slots ?? [],
      leaderboards,
      standings,
    });
  }
  // Archived events are hidden unless asked for, matching the web list.
  const rows = await listTournamentsAdmin(
    new URL(request.url).searchParams.get("archived") === "1",
  );
  return NextResponse.json({
    tournaments: rows.map((t) => ({
      id: t.id,
      name: t.name,
      sport: t.sport,
      status: t.status,
      format: t.format,
      totalTeams: t.totalTeams,
      entryFee: t.entryFee,
      liveScoringEnabled: t.liveScoringEnabled,
      scorerCode: t.scorerCode,
      teams: t._count.teams,
      matches: t._count.matches,
      archivedAt: t.archivedAt ? t.archivedAt.toISOString() : null,
    })),
  });
}
