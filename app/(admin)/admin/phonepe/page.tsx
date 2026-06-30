import {
  getPhonePeStores,
  getPhonePeOverview,
  type PhonePeOverview,
} from "@/actions/admin-phonepe";
import { PhonePeDashboard } from "./phonepe-dashboard";

// Empty overview used when no store is configured (defaultStore is null), so
// the client can render the not-configured notice without a wasted action call.
function notConfiguredOverview(): PhonePeOverview {
  return {
    configured: false,
    truncated: false,
    totalCount: 0,
    completedCount: 0,
    pendingCount: 0,
    failedCount: 0,
    totalVolume: 0,
    byChannel: { STATIC: 0, DQR: 0 },
    range: { from: "", to: "" },
  };
}

export default async function AdminPhonePePage() {
  const { stores, defaultStore } = await getPhonePeStores();

  const overview = defaultStore
    ? await getPhonePeOverview({ store: defaultStore })
    : notConfiguredOverview();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">PhonePe Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Live PhonePe QR transactions (static + dynamic QR)
        </p>
      </div>
      <PhonePeDashboard
        stores={stores}
        defaultStore={defaultStore}
        initialOverview={overview}
      />
    </div>
  );
}
