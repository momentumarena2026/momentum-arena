import { LiveMatchClient } from "./live-client";

// Public live-match screen (web). The live API enforces the tournament's
// liveScreenPlatform gate server-side — if the admin set APP_ONLY, this
// page renders the app-download upsell instead of live data.
export default async function LiveMatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; matchId: string }>;
  searchParams: Promise<{ tv?: string }>;
}) {
  const { matchId } = await params;
  const { tv } = await searchParams;
  return <LiveMatchClient matchId={matchId} tvMode={tv === "1"} />;
}
