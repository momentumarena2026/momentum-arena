import { TournamentCenter } from "../tournament-center";

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <TournamentCenter slug={slug} initialTab="table" />;
}
