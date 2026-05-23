"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Mounted once on /admin/bookings. Keeps the most recently applied
 * filter set alive across sessions so staff don't have to re-pick
 * "Confirmed + Today + Cricket" every time they come back to the
 * bookings list.
 *
 * Behaviour:
 *   1. If the URL carries any filter params, snapshot them (minus
 *      `page` — pagination position shouldn't bleed across visits).
 *   2. If the URL has NO params AND we have a snapshot in localStorage,
 *      replace the URL with the saved filter set. The page re-renders
 *      server-side with those params and the table reflects them.
 *   3. The "Clear all filters" link in filters-collapsible.tsx ships
 *      `?cleared=1`; we recognise it, wipe the snapshot, and redirect
 *      to the bare URL so the user lands on the true default state.
 *
 * Renders nothing — pure side-effect island.
 */

const STORAGE_KEY = "admin-bookings-filter";

export function FiltersPersist() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const search = window.location.search;

    // Explicit clear — the "Clear all filters" CTA lands here.
    if (search.includes("cleared=1")) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* localStorage disabled (incognito, etc.) — fine, just don't persist */
      }
      router.replace("/admin/bookings");
      return;
    }

    if (search && search.length > 1) {
      // URL has params — save them so the next fresh visit can restore.
      // Strip `page` so coming back doesn't drop the user onto page 7.
      try {
        const params = new URLSearchParams(search);
        params.delete("page");
        const cleaned = params.toString();
        if (cleaned) {
          window.localStorage.setItem(STORAGE_KEY, cleaned);
        } else {
          window.localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        /* ignore */
      }
      return;
    }

    // Empty URL — restore the last applied filter set if any.
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    if (saved) {
      router.replace(`/admin/bookings?${saved}`);
    }
  }, [router]);

  return null;
}
