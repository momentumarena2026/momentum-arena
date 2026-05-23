"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

/**
 * Free-text search box for the /admin/bookings filter strip. Searches
 * across customer name, phone number, and email. Submits via Enter
 * or the X icon (to clear), and updates the URL `q` param while
 * preserving every other filter that's already in the URL.
 *
 * Implemented client-side so the input can be controlled (rest of
 * the filter chrome is Link-based, but a search input needs typing).
 * On submit we use `router.replace` rather than `push` so the back
 * button doesn't have to step through every keystroke variant.
 */
export function UserSearchInput({
  /** Current value of the `q` URL param. Used to hydrate the input
   *  on first render so the box reflects the active filter. */
  initialValue,
  /** All other current filter params, encoded as a querystring (no
   *  leading "?"). Preserved when the search submits. */
  preservedParams: preservedParamsRaw,
}: {
  initialValue: string;
  preservedParams: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);

  // Stay in sync if the URL changes externally (e.g. another filter
  // chip is clicked and the page rehydrates with a new `q` value).
  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  function applyTo(next: string) {
    const params = new URLSearchParams(preservedParamsRaw);
    // Always drop pagination on a new search — staff will not be on
    // the same page count for a different filtered list.
    params.delete("page");
    params.delete("q");
    const trimmed = next.trim();
    if (trimmed) params.set("q", trimmed);
    const qs = params.toString();
    router.replace(qs ? `/admin/bookings?${qs}` : "/admin/bookings");
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    applyTo(value);
  }

  function onClear() {
    setValue("");
    applyTo("");
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="shrink-0 w-20 text-[10px] text-zinc-600 uppercase tracking-wider font-semibold">
        User
      </span>
      <form
        onSubmit={onSubmit}
        className="relative flex-1 min-w-[200px] max-w-md"
      >
        <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search by name, phone, or email"
          enterKeyHint="search"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 pl-8 pr-8 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
        />
        {value && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </form>
    </div>
  );
}
