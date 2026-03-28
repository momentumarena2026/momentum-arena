import { getRecurringConfig } from "@/actions/admin-recurring";
import { RecurringAdmin } from "./recurring-admin";

export default async function AdminRecurringPage() {
  const config = await getRecurringConfig();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Recurring Bookings</h1>
        <p className="mt-1 text-zinc-400">
          Configure discount tiers, allowed days, and limits for recurring bookings
        </p>
      </div>

      <RecurringAdmin initialConfig={config} />
    </div>
  );
}
