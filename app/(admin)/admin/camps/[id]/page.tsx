import { notFound } from "next/navigation";
import { getCampAdmin } from "@/actions/admin-camps";
import { CampManage } from "./camp-manage";

export const dynamic = "force-dynamic";

export default async function AdminCampPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const camp = await getCampAdmin(id);
  if (!camp) notFound();

  // Dates cross the server/client boundary as ISO strings.
  return <CampManage camp={JSON.parse(JSON.stringify(camp))} />;
}
