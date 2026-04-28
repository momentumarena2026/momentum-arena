import { Skeleton } from "@/components/ui/skeleton";

// Booking funnel loader. Covers /book (sport picker), /book/[sport]
// (court picker), /book/[sport]/[court] (slot picker) and the
// checkout step. The shape "header → grid of 3-4 large cards" is
// common to all three pre-checkout screens.
export default function Loading() {
  return (
    <div className="space-y-8 pb-12 max-w-4xl mx-auto">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-3 w-64" />
      </div>

      {/* Big card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden"
          >
            <Skeleton className="h-36 w-full rounded-none" />
            <div className="p-4 space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-28" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
