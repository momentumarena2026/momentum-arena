import { getPhonePeOverview } from "@/actions/admin-phonepe";
import { PhonePeDashboard } from "./phonepe-dashboard";

export default async function AdminPhonePePage() {
  const overview = await getPhonePeOverview();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">PhonePe Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Live PhonePe QR transactions (static + dynamic QR)
        </p>
      </div>
      <PhonePeDashboard initialOverview={overview} />
    </div>
  );
}
