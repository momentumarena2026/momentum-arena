import { getChallengeAdmin } from "@/actions/admin-challenges";
import { ChallengesAdmin } from "./challenges-admin";

export const dynamic = "force-dynamic";

export default async function AdminChallengesPage() {
  const data = await getChallengeAdmin();
  return <ChallengesAdmin initial={JSON.parse(JSON.stringify(data))} />;
}
