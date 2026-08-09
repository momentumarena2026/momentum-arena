import { notFound } from "next/navigation";
import { getTournamentAdmin } from "@/actions/admin-tournaments";
import { listCourtsForTournament } from "@/actions/admin-tournament-fixtures";
import { getTournamentLeaderboards } from "@/lib/tournament-leaderboards";
import { TournamentManage } from "./tournament-manage";

export const dynamic = "force-dynamic";

export default async function AdminTournamentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [t, courts] = await Promise.all([
    getTournamentAdmin(id),
    listCourtsForTournament(id),
  ]);
  if (!t) notFound();

  // Same helper the public page uses, so the organiser's Leaders tab and
  // the one the teams see can't drift apart.
  const statFields = (Array.isArray(t.statFields) ? t.statFields : []) as {
    key: string;
    label: string;
  }[];
  const leaderboards = await getTournamentLeaderboards(t.id, statFields);

  return (
    <TournamentManage
      tournament={JSON.parse(JSON.stringify(t))}
      courts={JSON.parse(JSON.stringify(courts))}
      leaderboards={leaderboards}
    />
  );
}
