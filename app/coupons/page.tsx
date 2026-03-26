import { auth } from "@/lib/auth";
import { getAvailableCoupons, getPersonalizedCoupons } from "@/actions/customer-coupons";
import { formatPrice } from "@/lib/pricing";
import { CouponCards } from "./coupon-cards";

export default async function CouponsPage() {
  const session = await auth();
  const isLoggedIn = !!session?.user?.id;

  const [allCoupons, personalizedData] = await Promise.all([
    getAvailableCoupons("BOTH"),
    isLoggedIn ? getPersonalizedCoupons() : null,
  ]);

  const personalizedCoupons = personalizedData
    ? [
        ...personalizedData.birthdayCoupons,
        ...personalizedData.firstTimeCoupons,
        ...personalizedData.groupCoupons,
      ]
    : [];

  // Deduplicate personalized from public list
  const personalizedIds = new Set(personalizedCoupons.map((c) => c.id));

  return (
    <div className="min-h-screen bg-black">
      {/* Banner */}
      <div className="relative overflow-hidden border-b border-zinc-800">
        <div className="absolute inset-0 bg-gradient-to-r from-amber-500/10 via-transparent to-amber-500/5" />
        <div className="relative mx-auto max-w-5xl px-4 py-12 sm:py-16">
          <h1 className="text-3xl font-bold text-white sm:text-4xl">
            Available Offers
          </h1>
          <p className="mt-2 text-zinc-400 max-w-xl">
            Use these coupon codes to get discounts on sports bookings and cafe
            orders at Momentum Arena.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-8">
        <CouponCards
          allCoupons={allCoupons}
          personalizedCoupons={personalizedCoupons}
          personalizedIds={Array.from(personalizedIds)}
          isLoggedIn={isLoggedIn}
        />
      </div>
    </div>
  );
}
