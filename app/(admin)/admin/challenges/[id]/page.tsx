import { notFound } from "next/navigation";
import { getChallengeDetail } from "@/actions/admin-challenges";
import { ChallengeStory } from "./challenge-story";

export const dynamic = "force-dynamic";

export default async function AdminChallengeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getChallengeDetail(id);
  if (!data) notFound();
  return <ChallengeStory data={JSON.parse(JSON.stringify(data))} />;
}
