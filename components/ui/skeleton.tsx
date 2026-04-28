import { cn } from "@/lib/utils";

/**
 * Animated placeholder for content that's still loading. Mimics the
 * shape of the incoming UI so the layout doesn't jump when the real
 * content takes over — better perceived performance than a centered
 * spinner.
 *
 * Use cases:
 *   - Route-level loading.tsx files (matched to the route's layout).
 *   - Tables / lists / cards waiting on a query.
 *
 * NOT for: button loading states, inline form submits — keep a small
 * spinner there since the user is acting on a known shape.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-zinc-800/60", className)}
      {...props}
    />
  );
}
