import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDqrConfigured } from "@/lib/phonepe-dqr";
import {
  listPublicTournaments,
  listPublicTournamentsPage,
  areTournamentsEnabled,
  type TournamentGroup,
} from "@/lib/tournaments";
import { CACHE } from "@/lib/api-cache";

export const dynamic = "force-dynamic";

const VALID_GROUPS: TournamentGroup[] = ["UPCOMING", "ONGOING", "COMPLETED"];

/**
 * Tournament hub list for the mobile app (public). Also carries the
 * module master-switch — the app's quick-action arc reads `enabled` to
 * decide whether to show the Tournaments entry at all.
 *
 * Two shapes, deliberately:
 *
 *  - No query params → the whole list, exactly as before. Older installs
 *    keep working unchanged; this route is served to every version of the
 *    app that is out there, and an OTA cannot reach a user who has not
 *    opened the app yet.
 *  - `?groups=UPCOMING,ONGOING&limit=10&offset=0` → one filtered,
 *    ordered page plus `nextOffset`, for the filter chips + lazy list.
 *
 * `groups` is a comma-separated list because the chips are multi-select.
 * An empty or absent list means all three rather than none — a user who
 * deselects every chip should see everything, not an empty screen.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const paged = searchParams.has("groups") || searchParams.has("limit");

  const enabled = await areTournamentsEnabled();
  if (!enabled) {
    return NextResponse.json(
      { enabled: false, tournaments: [] },
      { headers: CACHE.catalog },
    );
  }

  const gatewayCfg = await db.paymentGatewayConfig
    .findUnique({ where: { id: "singleton" }, select: { dqrEnabled: true } })
    .catch(() => null);
  const dqrAvailable = isDqrConfigured() && !!gatewayCfg?.dqrEnabled;

  if (!paged) {
    const rows = await listPublicTournaments();
    return NextResponse.json(
      {
        enabled: true,
        dqrAvailable,
        tournaments: rows.map((t) => ({
          id: t.id,
          slug: t.slug,
          name: t.name,
          sport: t.sport,
          status: t.status,
          format: t.format,
          bannerImageUrl: t.bannerImageUrl,
          totalTeams: t.totalTeams,
          entryFee: t.entryFee,
          feeMode: t.feeMode,
          prizePool: t.prizePool,
          startDate: t.startDate,
          liveScoringEnabled: t.liveScoringEnabled,
          confirmedTeams: t._count.teams,
        })),
      },
      { headers: CACHE.catalog },
    );
  }

  const requested = (searchParams.get("groups") ?? "")
    .split(",")
    .map((g) => g.trim().toUpperCase())
    .filter((g): g is TournamentGroup =>
      (VALID_GROUPS as string[]).includes(g),
    );
  const limit = Number.parseInt(searchParams.get("limit") ?? "10", 10) || 10;
  const offset = Number.parseInt(searchParams.get("offset") ?? "0", 10) || 0;

  const { rows, hasMore } = await listPublicTournamentsPage({
    groups: requested,
    limit,
    offset,
  });

  return NextResponse.json(
    {
      enabled: true,
      dqrAvailable,
      tournaments: rows.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        sport: t.sport,
        status: t.status,
        format: t.format,
        bannerImageUrl: t.bannerImageUrl,
        totalTeams: t.totalTeams,
        entryFee: t.entryFee,
        feeMode: t.feeMode,
        prizePool: t.prizePool,
        startDate: t.startDate,
        liveScoringEnabled: t.liveScoringEnabled,
        confirmedTeams: t.confirmedTeams,
        group: t.group,
      })),
      nextOffset: hasMore ? offset + rows.length : null,
    },
    // No catalog cache on a paged read: the chips change the URL on every
    // tap and a stale page would out-live the tap that asked for it.
    { headers: { "Cache-Control": "no-store" } },
  );
}
