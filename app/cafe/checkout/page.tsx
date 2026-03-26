import { auth } from "@/lib/auth";
import { CafeCheckoutClient } from "@/components/cafe/cafe-checkout-client";

export default async function CafeCheckoutPage() {
  const session = await auth();
  const isLoggedIn = !!session?.user;

  return <CafeCheckoutClient isLoggedIn={isLoggedIn} />;
}
