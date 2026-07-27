import { notFound } from "next/navigation";
import { getTournamentAdmin } from "@/actions/admin-tournaments";
import { TournamentManage } from "./tournament-manage";

export const dynamic = "force-dynamic";

export default async function AdminTournamentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTournamentAdmin(id);
  if (!t) notFound();

  return (
    <TournamentManage
      tournament={JSON.parse(JSON.stringify(t))}
    />
  );
}
