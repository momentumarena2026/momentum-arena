import { getActivePassPlans, getMyPasses } from "@/actions/passes";
import { PassesClient } from "./passes-client";

// Plans change at admin-edit time; render fresh per request.
export const dynamic = "force-dynamic";

export default async function PassesPage() {
  const [plans, myPasses] = await Promise.all([
    getActivePassPlans(),
    getMyPasses(),
  ]);
  return <PassesClient plans={plans} myPasses={myPasses} />;
}
