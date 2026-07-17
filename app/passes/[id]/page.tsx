import { notFound } from "next/navigation";
import { getPassDetail } from "@/actions/passes";
import { PassDetailClient } from "./pass-detail-client";

// Balances + members change at redemption/management time — always fresh.
export const dynamic = "force-dynamic";

export default async function PassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pass = await getPassDetail(id);
  // Not signed in, no such pass, or no relation to it — same 404 so a
  // pass id can't be probed.
  if (!pass) notFound();
  return <PassDetailClient pass={pass} />;
}
