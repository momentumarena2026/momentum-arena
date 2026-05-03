"use client";

import { useState } from "react";
import Link from "next/link";
import { Calendar, ChevronDown, ChevronUp } from "lucide-react";

/**
 * Wraps the /admin/bookings filter card in a collapsed-by-default
 * shell. Keeps each filter row a Link-driven URL navigation (the
 * page is still server-rendered from searchParams) but hides the
 * 5-row chip strip behind a single header until the staffer wants
 * to fiddle with filters.
 *
 * The header stays visible at all times with:
 *   - Filter icon + label
 *   - Active-count badge when at least one filter diverges from
 *     defaults — so the staffer never loses sight of an applied
 *     filter while it's collapsed.
 *   - A chevron flipping based on expanded state.
 *
 * Clear-all is rendered inside the body so it only shows when the
 * staffer has the strip open.
 */
export function FiltersCollapsible({
  activeFilters,
  totalLabel,
  defaultExpanded = false,
  children,
}: {
  /** Count of filters that differ from defaults — drives the badge. */
  activeFilters: number;
  /**
   * Optional bookings count label for the header (e.g. "245 total"
   * or "12 filtered"). Shows on the right of the title row.
   */
  totalLabel?: string;
  /**
   * If true, the strip starts open. Server passes `true` when the
   * URL has any filter applied so the user never has to click to see
   * what's already filtered.
   */
  defaultExpanded?: boolean;
  /** The five filter rows — passed as children from the server page. */
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50">
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
              href="/admin/bookings"
              className="inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-white transition-colors uppercase tracking-wider"
            >
              Clear all filters
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
