import { getPassAdminData, getPassesEnabled, getSoldPasses } from "@/actions/admin-passes";
import { SoldPasses } from "./sold-passes";
import { PassesManager } from "./passes-manager";
import { IssuePass } from "./issue-pass";

export default async function AdminPassesPage() {
  const [{ configs, plans }, sold, salesEnabled] = await Promise.all([
    getPassAdminData(),
    getSoldPasses(),
    getPassesEnabled(),
  ]);

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

      <PassesManager configs={configs} plans={plans} salesEnabled={salesEnabled} />

      <IssuePass plans={plans} />

      <SoldPasses passes={sold} />
    </div>
  );
}
