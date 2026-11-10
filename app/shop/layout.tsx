import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";

/** See app/passes/layout.tsx — this subtree inherited the root metadata too. */
export const metadata: Metadata = {
  title: "Shop | Momentum Arena Mathura",
  description:
    "Sports gear and Momentum Arena merchandise, collected at the venue in Mathura.",
};

/**
 * Shared layout for the customer-facing shop pages (catalog, cart,
 * checkout, order detail). Uses the shared SiteHeader so the nav +
 * user chip stay consistent across the funnel. Without a header the
 * shop pages render bare against the black background and feel
 * detached from the rest of the app.
 */
export default function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-black">
      <SiteHeader active="shop" />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
