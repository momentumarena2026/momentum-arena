import { db } from "@/lib/db";
import { SPORT_INFO } from "@/lib/court-config";
import { SportCard } from "@/components/booking/sport-card";
import { BackButton } from "@/components/back-button";

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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <BackButton className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors" label="Back" />
        <h1 className="text-2xl font-bold text-white">Book a Court</h1>
        <p className="mt-1 text-zinc-400">
          Choose your sport to get started
        </p>
      </div>

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
