import { getPassAdminData, getPassesEnabled, getSoldPasses } from "@/actions/admin-passes";
import { SoldPasses } from "./sold-passes";
import { PassesManager } from "./passes-manager";
import { IssuePass } from "./issue-pass";
import { GiftPass } from "./gift-pass";
import { SharingLimits } from "./sharing-limits";
import { PassAdminTabs } from "./pass-admin-tabs";

export default async function AdminPassesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ configs, plans }, sold, salesEnabled, { tab }] = await Promise.all([
    getPassAdminData(),
    getSoldPasses(),
    getPassesEnabled(),
    searchParams,
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Passes</h1>
        <p className="mt-1 text-zinc-400">
          Sell bulk hours on a court at a discounted effective hourly rate.
          Customers buy a pass and redeem hours at checkout; the balance
          lives on their account and expires after the validity window.
        </p>
      </div>

      <PassAdminTabs
        initial={tab}
        tabs={[
          {
            id: "plans",
            label: "Plans",
            badge: plans.length,
            content: (
              <PassesManager
                configs={configs}
                plans={plans}
                salesEnabled={salesEnabled}
              />
            ),
          },
          {
            id: "sold",
            label: "Sold Passes",
            badge: sold.length,
            content: <SoldPasses passes={sold} />,
          },
          {
            id: "issue",
            label: "Issue & Gift",
            content: (
              <div className="space-y-6">
                <IssuePass plans={plans} />
                <GiftPass configs={configs} />
              </div>
            ),
          },
          {
            id: "settings",
            label: "Sharing",
            content: <SharingLimits configs={configs} />,
          },
        ]}
      />
    </div>
  );
}
