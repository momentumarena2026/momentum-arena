import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDqrConfigured } from "@/lib/phonepe-dqr";
import { listPublicTournaments, areTournamentsEnabled } from "@/lib/tournaments";

export const dynamic = "force-dynamic";

/** Tournament hub list for the mobile app (public). Also carries the
 *  module master-switch — the app's quick-action arc reads `enabled` to
 *  decide whether to show the Tournaments entry at all. */
export async function GET() {
  const enabled = await areTournamentsEnabled();
  if (!enabled) {
    return NextResponse.json({ enabled: false, tournaments: [] });
  }
  const rows = await listPublicTournaments();
  const gatewayCfg = await db.paymentGatewayConfig
    .findUnique({ where: { id: "singleton" }, select: { dqrEnabled: true } })
    .catch(() => null);
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
  });
}
