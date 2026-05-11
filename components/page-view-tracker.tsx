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
 *
 * Admin paths (/admin/*, /godmode*) are excluded — admins clicking
 * around the admin panel shouldn't pollute the customer-funnel
 * analytics. The Events log + funnel charts are meant to surface
 * CUSTOMER behavior. The server route also drops these as defense
 * in depth — see /api/events.
 */
function isInternalAdminPath(p: string): boolean {
  return (
    p === "/admin" ||
    p.startsWith("/admin/") ||
    p === "/godmode" ||
    p.startsWith("/godmode/")
  );
}

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
    // Don't track admin clicks. We still update lastPathRef above so
    // a subsequent navigation OUT of admin (e.g. admin → /) still
    // fires the page_view for the destination, with previous=admin
    // intentionally dropped (passed undefined below).
    if (isInternalAdminPath(pathname)) return;
    const referrer =
      previous && !isInternalAdminPath(previous) ? previous : undefined;
    trackPageView(pathname, referrer);
  }, [pathname]);

  return null;
}
