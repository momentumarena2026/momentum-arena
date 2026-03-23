import { db } from "@/lib/db";
import { SPORT_INFO } from "@/lib/court-config";
import { SportCard } from "@/components/booking/sport-card";
import { PromoBanners } from "@/components/booking/promo-banners";
import { getActiveBanners } from "@/actions/admin-banners";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default async function BookPage() {
  const [configs, banners] = await Promise.all([
    db.courtConfig.findMany({ where: { isActive: true }, select: { sport: true } }),
    getActiveBanners("BOOK_PAGE").catch(() => []),
  ]);

  const activeSports = new Set(configs.map((c) => c.sport));

  const sports = Object.entries(SPORT_INFO).map(([key, info]) => ({
    sport: key,
    ...info,
    isActive: activeSports.has(key as keyof typeof SPORT_INFO),
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/dashboard"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-white">Book a Court</h1>
        <p className="mt-1 text-zinc-400">
          Choose your sport to get started
        </p>
      </div>

      <PromoBanners banners={banners.map((b) => ({ id: b.id, title: b.title, description: b.description, discountInfo: b.discountInfo }))} />

      <div className="grid gap-3 sm:grid-cols-2">
        {sports.map((sport) => (
          <SportCard
            key={sport.sport}
            sport={sport.sport}
            name={sport.name}
            description={sport.description}
            isActive={sport.isActive}
          />
        ))}
      </div>
    </div>
  );
}
