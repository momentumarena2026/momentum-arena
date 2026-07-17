import { Skeleton } from "@/components/ui/skeleton";

/**
 * Checkout page skeleton. Overrides the parent /book loading.tsx
 * (which renders a 3-card grid) because /book/checkout is a single
 * vertical stack: Booking Summary tile → equipment line → Total →
 * payment-method selector → Pay button. Matching the live shape
 * avoids the page-jump customers used to see when clicking Continue
 * on a slow connection.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12">
      {/* Header */}
      <div>
        <Skeleton className="mb-4 h-4 w-12" />
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-3 w-72" />
      </div>

      {/* Booking Summary tile */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>

        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex justify-between">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>

        <div className="border-t border-zinc-800 pt-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex justify-between">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
          <div className="mt-2 flex justify-between border-t border-zinc-800 pt-2">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-5 w-20" />
          </div>
        </div>
      </div>

      {/* Discount input row */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>

      {/* Payment method tiles — 3 across on desktop, stacked on mobile */}
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      </div>

      {/* Pay button */}
      <Skeleton className="h-12 w-full rounded-xl" />
    </div>
  );
}
