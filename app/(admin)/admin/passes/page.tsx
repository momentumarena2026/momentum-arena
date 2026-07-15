import { getPassAdminData } from "@/actions/admin-passes";
import { PassesManager } from "./passes-manager";

export default async function AdminPassesPage() {
  const { configs, plans } = await getPassAdminData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Monthly Passes</h1>
        <p className="mt-1 text-zinc-400">
          Sell bulk hours on a court at a discounted effective hourly rate.
          Customers buy a pass and redeem hours at checkout; the balance
          lives on their account and expires after the validity window.
        </p>
      </div>

      <PassesManager configs={configs} plans={plans} />
    </div>
  );
}
