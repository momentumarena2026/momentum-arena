import { notFound } from "next/navigation";
import { getPublicMatch } from "@/lib/public-match";
import { auth } from "@/lib/auth";
import { MatchScoreClient } from "./score-client";

export const dynamic = "force-dynamic";

export default async function MatchPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const match = await getPublicMatch(code);
  if (!match) notFound();
  const session = await auth().catch(() => null);
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;

  return (
    <MatchScoreClient
      initial={JSON.parse(
        JSON.stringify({
          ...match,
          canScore: !match.createdByUserId || match.createdByUserId === userId,
        }),
      )}
    />
  );
}
