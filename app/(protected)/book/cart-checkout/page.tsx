import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CartCheckoutClient } from "./cart-checkout-client";

export default async function CartCheckoutPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="mx-auto max-w-2xl">
      <CartCheckoutClient
        userName={session.user.name || ""}
        userEmail={session.user.email || ""}
        userPhone={(session.user as { phone?: string }).phone || ""}
      />
    </div>
  );
}
