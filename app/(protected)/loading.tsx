import { Skeleton } from "@/components/ui/skeleton";

// Customer-facing protected routes (/dashboard, /bookings, /profile,
// /referral). Skeleton mirrors the dashboard's general shape — banner
// card on top, stats row, then a list of upcoming bookings — which
// covers ~80% of incoming pages well enough that the layout doesn't
// jolt when the real content takes over.
export default function Loading() {
  return (
    <div className="space-y-6 pb-8">
      {/* Hero banner card (matches dashboard header) */}
      <div className="relative overflow-hidden rounded-2xl border border-zinc-800/50 bg-zinc-900/60 p-6 sm:p-8 space-y-3">
        <Skeleton className="h-3 w-24 bg-emerald-500/20" />
        <Skeleton className="h-8 w-3/4 max-w-md" />
        <Skeleton className="h-9 w-48 rounded-full" />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-2"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>

      {/* Section heading */}
      <Skeleton className="h-5 w-40" />

      {/* List of cards — bookings / referrals / etc. */}
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
          >
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
