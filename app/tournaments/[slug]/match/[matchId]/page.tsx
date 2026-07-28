import { notFound } from "next/navigation";
import { getMatchCentre } from "@/lib/tournament-scorecard";
import { areTournamentsEnabled } from "@/lib/tournaments";
import { MatchCentreClient } from "./match-centre";

export const dynamic = "force-dynamic";

export default async function MatchCentrePage({
  params,
}: {
  params: Promise<{ slug: string; matchId: string }>;
}) {
  const { slug, matchId } = await params;
  if (!(await areTournamentsEnabled())) notFound();
  const data = await getMatchCentre(matchId);
  if (!data || data.tournament.slug !== slug) notFound();
  return <MatchCentreClient initial={data} />;
}
