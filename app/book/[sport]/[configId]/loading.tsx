import { Skeleton } from "@/components/ui/skeleton";

/**
 * Slot-selection page skeleton. Overrides the parent `app/book/
 * loading.tsx` (which renders a 3-card grid) because /book/[sport]/
 * [configId] doesn't show cards — it's a date strip + tile grid +
 * sticky CTA. Matching the actual layout avoids the jarring "wrong
 * shape, then right shape" jump customers were seeing on a slow
 * navigation between sport picker and slot picker.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Back link + title */}
      <div>
        <Skeleton className="mb-4 h-4 w-12" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="mt-2 h-3 w-1/3" />
      </div>

      {/* Config info tile (diagram + label) */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-14 w-14 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      </div>

      {/* Date strip placeholder */}
      <div className="space-y-3">
        <Skeleton className="h-3 w-24" />
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-14 shrink-0 rounded-lg" />
          ))}
        </div>
      </div>

      {/* Slot tile grid — same columns as the live grid
          (grid-cols-2 sm:grid-cols-3 md:grid-cols-4) so the page
          shape is identical pre- and post-data. */}
      <div className="space-y-3">
        <Skeleton className="h-3 w-32" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
