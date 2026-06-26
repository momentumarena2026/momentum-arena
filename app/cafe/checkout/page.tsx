import { auth } from "@/lib/auth";
import { getCheckoutPaymentConfig } from "@/actions/admin-payment-settings";
import { CafeCheckoutClient } from "@/components/cafe/cafe-checkout-client";

export default async function CafeCheckoutPage() {
  const [session, paymentConfig] = await Promise.all([
    auth(),
    getCheckoutPaymentConfig(),
  ]);
  const isLoggedIn = !!session?.user;

  return (
    <CafeCheckoutClient
      isLoggedIn={isLoggedIn}
      gateway={paymentConfig.activeGateway}
      dqrEnabled={paymentConfig.dqrEnabled}
    />
  );
}
