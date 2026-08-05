import Link from "next/link";
import { listCamps } from "@/actions/admin-camps";
import { CampsClient } from "./camps-client";

export const dynamic = "force-dynamic";

export default async function AdminCampsPage() {
  const camps = await listCamps();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Camps</h1>
        <p className="mt-1 text-zinc-400">
          Fixed-length coaching programmes. Configure the schedule, fee and
          capacity; take registrations online or at the desk.
        </p>
      </div>
      <CampsClient
        camps={camps.map((c) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          sport: c.sport,
          status: c.status,
          startDate: c.startDate.toISOString(),
          endDate: c.endDate.toISOString(),
          capacity: c.capacity,
          fee: c.fee,
          registered: c._count.registrations,
        }))}
      />
    </div>
  );
}
