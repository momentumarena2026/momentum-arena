import { getActivePassPlans, getMyPasses } from "@/actions/passes";
import { arePassesEnabled } from "@/lib/passes";
import { PassesClient } from "./passes-client";

// Plans change at admin-edit time; render fresh per request.
export const dynamic = "force-dynamic";

export default async function PassesPage() {
  const [enabled, plans, myPasses] = await Promise.all([
    arePassesEnabled(),
    getActivePassPlans(),
    getMyPasses(),
  ]);
  return <PassesClient enabled={enabled} plans={plans} myPasses={myPasses} />;
}
