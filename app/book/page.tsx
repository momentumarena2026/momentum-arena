import { db } from "@/lib/db";
import { SPORT_INFO } from "@/lib/court-config";
import { SportCard } from "@/components/booking/sport-card";
import { BackButton } from "@/components/back-button";
import { getRainBanner } from "@/actions/admin-arena-settings";
import { RainBanner } from "@/components/rain-banner";
import { PromoBannerSlot } from "@/components/promo-banner-slot";

export default async function BookPage() {
  const configs = await db.courtConfig.findMany({
    where: { isActive: true },
    select: { sport: true },
  });

  const activeSports = new Set(configs.map((c) => c.sport));

  const sports = Object.entries(SPORT_INFO).map(([key, info]) => ({
    sport: key,
    ...info,
    isActive: activeSports.has(key as keyof typeof SPORT_INFO),
  }));

  const rainBanner = await getRainBanner().catch(() => ({
    show: false,
    title: "",
    body: "",
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {rainBanner.show ? (
        <div className="-mx-4 -mt-4 overflow-hidden rounded-b-xl sm:mx-0 sm:mt-0 sm:rounded-xl">
          <RainBanner
            title={rainBanner.title}
            body={rainBanner.body}
            href="/book"
          />
        </div>
      ) : null}

      <div>
        <BackButton className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors" label="Back" />
        <h1 className="text-2xl font-bold text-white">Book a Court</h1>
        <p className="mt-1 text-zinc-400">
          Choose your sport to get started
        </p>
      </div>

      {/* Admin-managed promotion banners for this screen. */}
      <PromoBannerSlot screen="BOOK_SPORT" />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
