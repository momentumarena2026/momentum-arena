import { NextRequest, NextResponse } from "next/server";
import { listCourtsForTournament } from "@/actions/admin-tournament-fixtures";
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
    return NextResponse.json({ tournament: t, courts });
  }
  const rows = await listTournamentsAdmin();
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
    })),
  });
}
