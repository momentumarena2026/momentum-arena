import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPublicTournamentBySlug } from "@/lib/tournaments";
import { RegisterClient } from "./register-client";

export const dynamic = "force-dynamic";

export default async function TournamentRegisterPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/tournaments/${slug}/register`)}`);
  }
  const t = await getPublicTournamentBySlug(slug);
  if (!t) notFound();
  if (t.status !== "REG_OPEN") redirect(`/tournaments/${slug}`);
  const mine = t.teams.find((x) => x.captainUserId === session.user!.id);
  if (mine) redirect(`/tournaments/${slug}`);

  return (
    <RegisterClient
      tournament={{
        id: t.id,
        slug: t.slug,
        name: t.name,
        sport: t.sport,
        entryFee: t.entryFee,
        feeMode: t.feeMode,
        advancePct: t.advancePct,
        allowCoupons: t.allowCoupons,
        membersPerTeamMin: t.membersPerTeamMin,
        membersPerTeamMax: t.membersPerTeamMax,
        confirmedCount: t.teams.filter((x) => x.status === "CONFIRMED").length,
        totalTeams: t.totalTeams,
      }}
      prefill={{
        captainName: session.user.name || "",
        captainPhone: (session.user as { phone?: string }).phone || "",
        captainEmail: session.user.email || "",
      }}
    />
  );
}
