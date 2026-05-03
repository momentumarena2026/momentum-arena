"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, IndianRupee, Layers, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Tab {
  href: string;
  label: string;
  Icon: LucideIcon;
}

const TABS: Tab[] = [
  { href: "/admin/analytics", label: "Revenue", Icon: IndianRupee },
  { href: "/admin/analytics/funnels", label: "Funnels", Icon: BarChart3 },
  { href: "/admin/analytics/events", label: "Events", Icon: Activity },
  { href: "/admin/analytics/cohorts", label: "Cohorts", Icon: Users },
  { href: "/admin/analytics/demand", label: "Demand", Icon: Layers },
];

export function AnalyticsTabs() {
  const pathname = usePathname() ?? "";
  return (
    <div className="border-b border-zinc-800">
      <nav className="-mb-px flex gap-6 overflow-x-auto">
        {TABS.map((t) => {
          // Exact match for /admin/analytics, prefix match for the rest.
          // Keeps Revenue from staying highlighted when you're on Funnels
          // (the prefix would otherwise apply to /admin/analytics/...).
          const active =
            t.href === "/admin/analytics"
              ? pathname === "/admin/analytics"
              : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                active
                  ? "border-emerald-500 text-emerald-400"
                  : "border-transparent text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
              }`}
            >
              <t.Icon className="h-4 w-4" />
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
