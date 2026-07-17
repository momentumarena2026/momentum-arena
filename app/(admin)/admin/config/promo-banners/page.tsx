import { getPromoBannersAdminData } from "@/actions/admin-promo-banners";
import { PromoBannersManager } from "./promo-banners-manager";

/** Web & App Config → Promotion Banners. */
export default async function AdminPromoBannersPage() {
  const data = await getPromoBannersAdminData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Promotion Banners</h1>
        <p className="mt-1 text-zinc-400">
          Image banners shown on chosen customer screens — web and app. A
          banner linked to a coupon retires automatically when the coupon
          expires or is disabled.
        </p>
      </div>
      <PromoBannersManager initialBanners={data.banners} coupons={data.coupons} />
    </div>
  );
}
