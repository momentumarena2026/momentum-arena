"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Calendar, ChevronDown, ChevronUp, Filter, X } from "lucide-react";

/**
 * Filter chrome for /admin/bookings. Renders TWO layouts driven by
 * the same `children` (the actual filter rows):
 *
 *   - Desktop (md+): the original inline collapsible card. Header is
 *     a single-row strip with chevron + active-count badge; clicking
 *     toggles the body. Defaults to expanded when any non-default
 *     filter is applied so the user sees what they've already picked.
 *
 *   - Mobile (<md): a sticky bottom bar with a "Filters" pill.
 *     Tapping opens a bottom-sheet that slides up to ~75 % of the
 *     viewport (the rest of the page stays peeking through a
 *     dimmer). Backdrop closes the sheet; tapping a filter chip
 *     applies it (the chip is a `<Link>` so navigation closes the
 *     sheet by remounting the page). The bar sits below the floating
 *     hamburger which is bumped up in admin-sidebar.tsx whenever the
 *     route is /admin/bookings.
 *
 * Clear-all sentinel: "Clear all filters" links to ?cleared=1 so the
 * sibling FiltersPersist island can wipe the localStorage snapshot
 * before redirecting back to the bare URL — otherwise the persist
 * logic would helpfully restore the filter the user just cleared.
 */
export function FiltersCollapsible({
  activeFilters,
  totalLabel,
  defaultExpanded = false,
  children,
}: {
  activeFilters: number;
  totalLabel?: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  // Desktop collapsible state. Mobile sheet uses its own `sheetOpen`
  // boolean so the two breakpoints can't fight each other.
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Lock body scroll while the sheet is open — otherwise touch
  // momentum from inside the sheet bleeds through to the page below.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheetOpen]);

  // Close the sheet automatically when the route changes (e.g. when
  // the user picks a chip and the page re-fetches with new params).
  // We listen to popstate AND mutation of the search string after
  // navigation by tracking the search; a route push from a `<Link>`
  // unmounts and remounts this component so the state resets.
  // No explicit listener needed — Next's App Router handles it.

  return (
    <>
      {/* ─── Desktop inline collapsible (md+) ─────────────────── */}
      <div className="hidden md:block rounded-xl border border-zinc-800 bg-zinc-900/50">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-zinc-900/80 rounded-t-xl"
          aria-expanded={expanded}
        >
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-wider">
            <Calendar className="h-3.5 w-3.5" />
            Filters
            {activeFilters > 0 && (
              <span className="rounded-full bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 text-[10px] font-bold">
                {activeFilters}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {totalLabel && (
              <span className="text-[10px] text-zinc-600 uppercase tracking-wider">
                {totalLabel}
              </span>
            )}
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-zinc-500" />
            ) : (
              <ChevronDown className="h-4 w-4 text-zinc-500" />
            )}
          </div>
        </button>

        {expanded && (
          <div className="border-t border-zinc-800 px-4 py-3 space-y-3">
            {children}
            {activeFilters > 0 && (
              <Link
                href="/admin/bookings?cleared=1"
                className="inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-white transition-colors uppercase tracking-wider"
              >
                Clear all filters
              </Link>
            )}
          </div>
        )}
      </div>

      {/* ─── Mobile sticky bar (<md) ─────────────────────────── */}
      <div className="md:hidden">
        {/* Spacer so the last bookings row isn't covered by the bar.
            Matches the bar height (3.5rem = 56px) plus safe-area inset.
            Sits in document flow so the page can scroll past it. */}
        <div
          aria-hidden
          style={{ height: "calc(3.5rem + env(safe-area-inset-bottom, 0px))" }}
        />
        <div
          className="fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3.5"
            aria-expanded={sheetOpen}
            aria-controls="bookings-filter-sheet"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-white">
              <Filter className="h-4 w-4 text-emerald-400" />
              Filters
              {activeFilters > 0 && (
                <span className="rounded-full bg-emerald-500/20 text-emerald-400 px-2 py-0.5 text-[10px] font-bold">
                  {activeFilters}
                </span>
              )}
            </span>
            {totalLabel && (
              <span className="text-[11px] text-zinc-500 uppercase tracking-wider">
                {totalLabel}
              </span>
            )}
          </button>
        </div>

        {/* Bottom-sheet — backdrop + panel. The panel translates from
            full off-screen down to its open position; opacity on the
            backdrop fades in. CSS-only transitions, no JS spring. */}
        <div
          className={`fixed inset-0 z-50 transition-opacity duration-200 ${
            sheetOpen
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0"
          }`}
          aria-hidden={!sheetOpen}
        >
          {/* Backdrop */}
          <button
            type="button"
            onClick={() => setSheetOpen(false)}
            aria-label="Close filters"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          {/* Sheet panel */}
          <div
            id="bookings-filter-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Bookings filters"
            className={`absolute bottom-0 left-0 right-0 max-h-[75vh] rounded-t-2xl border-t border-zinc-800 bg-zinc-950 shadow-2xl transition-transform duration-300 ease-out ${
              sheetOpen ? "translate-y-0" : "translate-y-full"
            }`}
            style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
          >
            {/* Drag-handle affordance */}
            <div className="flex justify-center pt-2 pb-1">
              <span className="h-1 w-10 rounded-full bg-zinc-700" />
            </div>
            <div className="flex items-center justify-between px-4 pb-2">
              <h2 className="text-sm font-semibold text-white">Filters</h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-white"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* Scrollable filter body */}
            <div className="overflow-y-auto px-4 pb-4 space-y-3" style={{ maxHeight: "calc(75vh - 4rem)" }}>
              {children}
              {activeFilters > 0 && (
                <Link
                  href="/admin/bookings?cleared=1"
                  className="inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-white transition-colors uppercase tracking-wider"
                  onClick={() => setSheetOpen(false)}
                >
                  Clear all filters
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
