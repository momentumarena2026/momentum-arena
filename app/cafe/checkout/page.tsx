import { auth } from "@/lib/auth";
import { getActiveGateway } from "@/actions/admin-payment-settings";
import { CafeCheckoutClient } from "@/components/cafe/cafe-checkout-client";

export default async function CafeCheckoutPage() {
  const [session, activeGateway] = await Promise.all([
    auth(),
    getActiveGateway(),
  ]);
  const isLoggedIn = !!session?.user;

  return <CafeCheckoutClient isLoggedIn={isLoggedIn} gateway={activeGateway} />;
}
