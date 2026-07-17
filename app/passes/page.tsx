import { getActivePassPlans } from "@/actions/passes";
import { getCheckoutPaymentConfig } from "@/actions/admin-payment-settings";
import { arePassesEnabled } from "@/lib/passes";
import { PassesClient } from "./passes-client";
import { getLivePromoBanners } from "@/lib/promo-banners";

// Plans change at admin-edit time; render fresh per request.
export const dynamic = "force-dynamic";

export default async function PassesPage() {
  // The customer's own passes now live on the account dashboard; this
  // page is the storefront (available plans) only.
  const [enabled, plans, payConfig, promoBanners] = await Promise.all([
    arePassesEnabled(),
    getActivePassPlans(),
    getCheckoutPaymentConfig(),
    getLivePromoBanners("PASSES"),
  ]);
  return (
    <PassesClient
      enabled={enabled}
      plans={plans}
      dqrEnabled={payConfig.dqrEnabled}
      promoBanners={promoBanners}
    />
  );
}
