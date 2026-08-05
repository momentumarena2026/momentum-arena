import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDqrConfigured } from "@/lib/phonepe-dqr";
import { listPublicTournaments, areTournamentsEnabled } from "@/lib/tournaments";
import { CACHE } from "@/lib/api-cache";

export const dynamic = "force-dynamic";

/** Tournament hub list for the mobile app (public). Also carries the
 *  module master-switch — the app's quick-action arc reads `enabled` to
 *  decide whether to show the Tournaments entry at all. */
export async function GET() {
  // All three reads are independent, so they go together. Serialising
  // them cost three Virginia round trips for data that never referenced
  // each other.
  const [enabled, rows, gatewayCfg] = await Promise.all([
    areTournamentsEnabled(),
    listPublicTournaments(),
    db.paymentGatewayConfig
      .findUnique({ where: { id: "singleton" }, select: { dqrEnabled: true } })
      .catch(() => null),
  ]);
  if (!enabled) {
    return NextResponse.json(
      { enabled: false, tournaments: [] },
      { headers: CACHE.catalog },
    );
  }
  return NextResponse.json({
    enabled: true,
    dqrAvailable: isDqrConfigured() && !!gatewayCfg?.dqrEnabled,
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
  }, { headers: CACHE.catalog });
}
