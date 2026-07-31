import { CafeCartProvider } from "@/lib/cafe-cart-context";
import { SiteHeader } from "@/components/site-header";
import { MinimalHeader } from "@/components/minimal-header";
import { PathSwitch } from "@/components/nav/path-switch";

/**
 * Cafe pages now carry the same SiteHeader as the rest of the funnel
 * (they used to render bare, with the menu page hand-rolling a logo in
 * its hero). The checkout payment screen gets the logo-only bar, same
 * as booking checkout.
 */
export default function CafeLayout({ children }: { children: React.ReactNode }) {
  return (
    <CafeCartProvider>
      <div className="min-h-screen bg-black">
        <PathSwitch
          prefix="/cafe/checkout"
          match={<MinimalHeader />}
          otherwise={<SiteHeader active="cafe" />}
        />
        {children}
      </div>
    </CafeCartProvider>
  );
}
