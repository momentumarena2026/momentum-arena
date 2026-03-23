import { getPromoBanners } from "@/actions/admin-banners";
import { BannerManager } from "./banner-manager";

export default async function AdminBannersPage() {
  const banners = await getPromoBanners();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Promo Banners</h1>
        <p className="mt-1 text-zinc-400">
          Create promotional banners shown on booking pages
        </p>
      </div>

      <BannerManager
        banners={banners.map((b) => ({
          id: b.id,
          title: b.title,
          description: b.description,
          discountInfo: b.discountInfo,
          placement: b.placement,
          razorpayOfferId: b.razorpayOfferId,
          isActive: b.isActive,
          startsAt: b.startsAt.toISOString().split("T")[0],
          endsAt: b.endsAt.toISOString().split("T")[0],
        }))}
      />
    </div>
  );
}
