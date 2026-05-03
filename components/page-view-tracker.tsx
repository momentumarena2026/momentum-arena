"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { trackPageView } from "@/lib/analytics";

/**
 * Fires a `page_view` event on every client-side route change. Mounts
 * once at the root layout — feature pages don't need to do anything.
 *
 * Implementation note: we deliberately don't include search params
 * in the tracked path so a coupon code in a URL doesn't blow up
 * cardinality on the analytics dashboard. If you ever need that,
 * stamp it as a separate property in the relevant trackXxx() helper
 * (e.g. trackCouponApplied already captures the code).
 */
export function PageViewTracker() {
  const pathname = usePathname();
  const lastPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    // Skip the no-op fire when StrictMode causes a double-render —
    // the path didn't actually change.
    if (lastPathRef.current === pathname) return;
    const previous = lastPathRef.current;
    lastPathRef.current = pathname;
    trackPageView(pathname, previous ?? undefined);
  }, [pathname]);

  return null;
}
