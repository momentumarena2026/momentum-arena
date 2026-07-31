"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Tab shell for the Passes admin — the five sections used to stack on
 * one very long page; now each lives under its own tab. Every panel
 * stays MOUNTED (hidden, not unmounted) so half-filled forms survive a
 * tab hop, and the active tab is mirrored into ?tab= so a refresh or a
 * shared link lands on the same view.
 */
export function PassAdminTabs({
  tabs,
  initial,
}: {
  tabs: { id: string; label: string; badge?: number; content: ReactNode }[];
  initial?: string;
}) {
  const [active, setActive] = useState(
    tabs.some((t) => t.id === initial) ? initial! : tabs[0].id,
  );

  // Mirror into the URL without a navigation (server state untouched).
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", active);
    window.history.replaceState(null, "", url.toString());
  }, [active]);

  return (
    <div>
      <div className="flex flex-wrap gap-1 rounded-xl border border-zinc-800 bg-zinc-900 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
              active === t.id
                ? "bg-emerald-600 text-white"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
            }`}
          >
            {t.label}
            {typeof t.badge === "number" && (
              <span
                className={`rounded-full px-1.5 text-[11px] font-semibold ${
                  active === t.id
                    ? "bg-white/20 text-white"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} hidden={active !== t.id} className="mt-6">
          {t.content}
        </div>
      ))}
    </div>
  );
}
