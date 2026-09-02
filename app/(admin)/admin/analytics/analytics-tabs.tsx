"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  BellRing,
  Coffee,
  IndianRupee,
  Layers,
  Trophy,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Tab {
  href: string;
  label: string;
  Icon: LucideIcon;
}

const TABS: Tab[] = [
  // Overall sits first because it is the only tab that subtracts costs
  // from income — Sports and Cafe each report their own revenue and
  // neither knows what the month cost to run. Superadmin-only; the gate
  // lives in getProfitAndLoss, so a non-superadmin who follows the link
  // gets an error page rather than a blank statement. The tab itself is
  // left visible deliberately: hiding it here would need the role in a
  // client component, and the server gate is the one that matters.
  { href: "/admin/analytics/overall", label: "Overall", Icon: IndianRupee },
  // Revenue is now split across Sports and Cafe — both live under
  // /admin/analytics/* with their own dashboards. The bare
  // /admin/analytics URL redirects to /admin/analytics/sports.
  { href: "/admin/analytics/sports", label: "Sports", Icon: Trophy },
  { href: "/admin/analytics/cafe", label: "Cafe", Icon: Coffee },
  { href: "/admin/analytics/funnels", label: "Funnels", Icon: BarChart3 },
  { href: "/admin/analytics/events", label: "Events", Icon: Activity },
  { href: "/admin/analytics/cohorts", label: "Cohorts", Icon: Users },
  { href: "/admin/analytics/demand", label: "Demand", Icon: Layers },
  { href: "/admin/analytics/push", label: "Push", Icon: BellRing },
];

export function AnalyticsTabs() {
  const pathname = usePathname() ?? "";
  return (
    <div className="border-b border-zinc-800">
      <nav className="-mb-px flex gap-6 overflow-x-auto">
        {TABS.map((t) => {
          // Prefix match — works for every tab now that they all have
          // their own subpath. Sports keeps highlight on both
          // /admin/analytics and /admin/analytics/sports.
          const active =
            t.href === "/admin/analytics/sports"
              ? pathname === "/admin/analytics" ||
                pathname.startsWith("/admin/analytics/sports")
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
